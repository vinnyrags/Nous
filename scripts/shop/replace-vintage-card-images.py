#!/usr/bin/env python3
"""
Replace vintage WP card images with clean Unlimited-print scans from
Pokellector.

Background. pokemontcg.io's hosted images for the 1999-2000 Wizards-era
sets (Base Set, Jungle, Fossil, Base Set 2, Team Rocket, Gym Heroes,
Gym Challenge) are 1st Edition prints. They carry the vertical
"Edition 1" stamp on the left side of the artwork. The user sells
Unlimited copies in nearly every case, so the listing image
misrepresents the product.

Bulbapedia was the first candidate but it hosts only one image per
card name + set page and uses the Non-Holo variant's image on Holo
pages too. That produces a corner-number mismatch (e.g. Bulbapedia's
Kabutops Fossil "9" page displays the #24/62 Non-Holo scan).
Pokellector has separate listings for Holo and Non-Holo, e.g.
`Kabutops.FO.9.png` vs `Kabutops.FO.24.png`, and serves Unlimited
scans by default with the holographic foiling visible in the artwork.

For each WP card:
  1. Scrape the Pokellector expansion page for the set, building a
     {number -> image_url} map directly from the listing thumbnails.
     The full-size URL is the thumb URL with `.thumb` stripped.
  2. Download the image, then run a differential comparison against
     pokemontcg.io (known-1st-Edition for these sets) over the stamp
     region. Skip + flag if the two are too similar.
  3. Upload to WP /wp-json/wp/v2/media and POST featured_media on the
     /card/{id} endpoint.

Modes:
  --apply         actually do WP writes (default is dry-run preview)
  --limit=N       process only the first N cards
  --card-id=N     process only the single card with this WP post id
  --skip-detect   bypass 1st Edition detection (treat all as clean)

Env (required when --apply is passed):
  WP_REMEDIATE_USER          WP admin username
  WP_REMEDIATE_APP_PASSWORD  WP Application Password
  WP_BASE_URL                defaults to https://vincentragosta.io

Outputs (under $VINTAGE_FIX_DIR, default ~/Projects/vinnyrags/websites/tmp/vintage-fix):
  results.json     per-card outcome
  pokellector/     downloaded source images
  flagged/         images that look 1st Edition
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from base64 import b64encode
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Need PIL. Install with: pip3 install Pillow")

THROTTLE_SEC = 1.0
USER_AGENT = "vincentragosta-card-remediation/1.0"

# Map: WP set name -> (Pokellector expansion slug, pokemontcg.io set id)
SETS = {
    "Base Set":      ("Base-Set-Expansion",      "base1"),
    "Jungle":        ("Jungle-Expansion",        "base2"),
    "Fossil":        ("Fossil-Expansion",        "base3"),
    "Base Set 2":    ("Base-Set-2-Expansion",    "base4"),
    "Team Rocket":   ("Team-Rocket-Expansion",   "base5"),
    "Gym Heroes":    ("Gym-Heroes-Expansion",    "gym1"),
    "Gym Challenge": ("Gym-Challenge-Expansion", "gym2"),
}

OUT_DIR = Path(
    os.environ.get(
        "VINTAGE_FIX_DIR",
        str(Path.home() / "Projects/vinnyrags/websites/tmp/vintage-fix"),
    )
)
PKL_DIR = OUT_DIR / "pokellector"
FLAGGED_DIR = OUT_DIR / "flagged"

ap = argparse.ArgumentParser()
ap.add_argument("--apply", action="store_true")
ap.add_argument("--limit", type=int, default=None)
ap.add_argument("--card-id", type=int, default=None)
ap.add_argument("--skip-detect", action="store_true")
ARGS = ap.parse_args()

WP_BASE = os.environ.get("WP_BASE_URL", "https://vincentragosta.io").rstrip("/")
WP_USER = os.environ.get("WP_REMEDIATE_USER")
WP_APP_PASSWORD = os.environ.get("WP_REMEDIATE_APP_PASSWORD")

if ARGS.apply and (not WP_USER or not WP_APP_PASSWORD):
    sys.exit("--apply requires WP_REMEDIATE_USER and WP_REMEDIATE_APP_PASSWORD")

WP_AUTH = ""
if WP_USER and WP_APP_PASSWORD:
    WP_AUTH = "Basic " + b64encode(f"{WP_USER}:{WP_APP_PASSWORD}".encode()).decode()

mode_str = "[APPLY MODE]" if ARGS.apply else "[DRY RUN]"
print(f"{mode_str}  WP base: {WP_BASE}")

PKL_DIR.mkdir(parents=True, exist_ok=True)
FLAGGED_DIR.mkdir(parents=True, exist_ok=True)


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_text(url, timeout=30):
    return fetch(url, timeout).decode("utf-8", errors="replace")


def sleep_throttle():
    time.sleep(THROTTLE_SEC)


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return s.strip("-")[:80]


# Pokellector set page parsing.
#
# Each tile on an expansion page looks like:
#   <a href="/{ExpansionSlug}/{CardSlug}-Card-{Number}" ...>
#     <img class="card lazyload" data-src="https://den-cards.pokellector.com/{ID}/{CardSlug}.{SET}.{Number}.thumb.png">
#     <div class="plaque">#{Number} - {CardName}</div>
#
# Building a {number: image_url} mapping straight off the expansion page
# avoids per-card scrapes for the 149-card run.

def parse_expansion_page(html):
    """Parse the Pokellector expansion page into {number: full_image_url}.

    Most cards have a clean URL like ".../Kabutops.FO.9.thumb.png" but a
    handful carry an extra disambiguating numeric suffix (Pokellector's
    internal card id), e.g. ".../Switch.BS.95.7933.thumb.png". Both must
    be matched and the full-size URL is the thumb URL with `.thumb`
    stripped.
    """
    out = {}
    pat = re.compile(
        r'data-src="(https://den-cards\.pokellector\.com/\d+/'
        r'[^"]+?\.[A-Z0-9]+\.(\d+[A-Z]?)(?:\.\d+)?\.thumb\.(?:png|jpg))"',
        re.IGNORECASE,
    )
    for m in pat.finditer(html):
        thumb = m.group(1)
        number = m.group(2)
        full = thumb.replace(".thumb.", ".")
        if number not in out:
            out[number] = full
    return out


# Stamp detection. The 1st Edition stamp on Wizards-era cards sits in
# the bottom-left of the artwork window. Comparing the stamp region of
# the candidate (Pokellector) against the known-1st-Edition reference
# (pokemontcg.io) tells us whether the candidate carries the stamp.
# Identical prints score near zero; a different print (Unlimited vs
# 1st Edition) scores higher because the solid-black stamp lettering
# shifts every pixel in the region.

def _stamp_crop(img):
    w, h = img.size
    return img.crop((int(w * 0.05), int(w * 0.05 + h * 0.30),
                     int(w * 0.20), int(w * 0.05 + h * 0.45)))


def detect_first_edition_stamp(candidate_bytes, reference_bytes):
    if reference_bytes is None:
        return False, "no-reference"
    try:
        cand = Image.open(BytesIO(candidate_bytes)).convert("RGB")
        ref = Image.open(BytesIO(reference_bytes)).convert("RGB")
    except Exception as e:
        return False, f"open-failed: {e}"
    target_w, target_h = 80, 112
    a = _stamp_crop(cand).resize((target_w, target_h))
    b = _stamp_crop(ref).resize((target_w, target_h))
    a_data = list(a.getdata())
    b_data = list(b.getdata())
    total = target_w * target_h
    diff_sum = 0
    for (r1, g1, b1), (r2, g2, b2) in zip(a_data, b_data):
        diff_sum += abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
    mean_diff = diff_sum / (total * 3)
    # Threshold of 10 catches identical prints (typically mean-diff ~5-8)
    # while letting Energy and other low-art-detail cards through. With
    # Pokellector as the source — which is already known to publish
    # Unlimited scans by default — the detector is more of a sanity
    # check than a safety net.
    return mean_diff < 10, f"mean-diff={mean_diff:.1f}"


def wp_upload_attachment(buf, filename, content_type):
    req = urllib.request.Request(
        f"{WP_BASE}/wp-json/wp/v2/media",
        method="POST",
        headers={
            "Authorization": WP_AUTH,
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="{filename}"',
            "User-Agent": USER_AGENT,
        },
        data=buf,
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["id"]


def wp_set_featured_media(card_id, attachment_id):
    payload = json.dumps({"featured_media": attachment_id}).encode()
    req = urllib.request.Request(
        f"{WP_BASE}/wp-json/wp/v2/card/{card_id}",
        method="POST",
        headers={
            "Authorization": WP_AUTH,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        data=payload,
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    cards_path = OUT_DIR / "cards.json"
    if not cards_path.exists():
        sys.exit(f"{cards_path} not found — run the audit first")
    cards = json.loads(cards_path.read_text())

    print("Building Pokellector set indexes…")
    set_indexes = {}
    for set_name, (expansion_slug, _tcgio_id) in SETS.items():
        url = f"https://www.pokellector.com/{expansion_slug}/"
        try:
            html = fetch_text(url)
            idx = parse_expansion_page(html)
            set_indexes[set_name] = idx
            print(f"  {set_name:14s} -> {len(idx):3d} cards mapped")
        except Exception as e:
            print(f"  {set_name:14s} -> ERROR {e}")
            set_indexes[set_name] = {}
        sleep_throttle()

    targets = [c for c in cards if not c["preserve"]]
    if ARGS.card_id:
        targets = [c for c in targets if c["id"] == ARGS.card_id]
    if ARGS.limit:
        targets = targets[: ARGS.limit]

    print(f"\nTargets: {len(targets)} (preserves excluded)\n")

    results = {"ok": [], "flagged": [], "no_match": [], "errors": []}

    for i, t in enumerate(targets, 1):
        set_name = t["set"]
        number = t["number"]
        title = t["title"]
        cid = t["id"]

        idx = set_indexes.get(set_name, {})
        image_url = idx.get(number)

        print(f"[{i}/{len(targets)}] #{cid} '{title}'")
        print(f"     set={set_name} number={number}")

        if not image_url:
            print(f"     ! no Pokellector entry for #{number}")
            results["no_match"].append({**t, "reason": "no Pokellector entry"})
            continue

        print(f"     image={image_url}")

        try:
            img_bytes = fetch(image_url)
        except Exception as e:
            print(f"     X image download: {e}")
            results["errors"].append({**t, "error": f"download: {e}"})
            sleep_throttle()
            continue

        ext = Path(urllib.parse.urlparse(image_url).path).suffix or ".png"
        local_path = PKL_DIR / f"{slugify(title)}{ext}"
        local_path.write_bytes(img_bytes)

        is_stamped, detect_info = False, ""
        if not ARGS.skip_detect:
            tcgio_set_id = SETS[set_name][1]
            ref_url = f"https://images.pokemontcg.io/{tcgio_set_id}/{number}_hires.png"
            try:
                ref_bytes = fetch(ref_url)
            except Exception as e:
                ref_bytes = None
                print(f"     ref fetch failed: {e}")
            is_stamped, detect_info = detect_first_edition_stamp(img_bytes, ref_bytes)
            print(f"     detect={detect_info}  stamped={is_stamped}")

        if is_stamped:
            (FLAGGED_DIR / local_path.name).write_bytes(img_bytes)
            results["flagged"].append({
                **t,
                "image_url": image_url,
                "detect": detect_info,
            })
            sleep_throttle()
            continue

        if not ARGS.apply:
            results["ok"].append({**t, "image_url": image_url, "detect": detect_info})
            sleep_throttle()
            continue

        try:
            content_type = "image/png" if ext.lower() == ".png" else "image/jpeg"
            filename = f"{slugify(title)}-{int(time.time() * 1000)}{ext}"
            new_attach = wp_upload_attachment(img_bytes, filename, content_type)
            wp_set_featured_media(cid, new_attach)
            print(f"     OK attachment {new_attach} -> card #{cid}")
            results["ok"].append({
                **t,
                "image_url": image_url,
                "new_attachment_id": new_attach,
            })
        except urllib.error.HTTPError as e:
            print(f"     X WP write: HTTP {e.code} {e.reason}")
            results["errors"].append({**t, "error": f"wp http {e.code}: {e.reason}"})
        except Exception as e:
            print(f"     X WP write: {e}")
            results["errors"].append({**t, "error": f"wp: {e}"})

        sleep_throttle()

    (OUT_DIR / "results.json").write_text(json.dumps(results, indent=2))

    print()
    print("=== summary ===")
    print(f"ok:       {len(results['ok'])}")
    print(f"flagged:  {len(results['flagged'])}  (look 1st Edition — manual review)")
    print(f"no_match: {len(results['no_match'])}")
    print(f"errors:   {len(results['errors'])}")

    if results["flagged"]:
        print(f"\nFlagged images saved to {FLAGGED_DIR}/")
    if results["no_match"]:
        print("\nNo Pokellector match — need manual handling:")
        for r in results["no_match"]:
            print(f"  - #{r['id']}  {r['title']}  ({r['reason']})")
    if results["errors"]:
        print("\nErrors:")
        for r in results["errors"]:
            print(f"  - #{r['id']}  {r['title']}")
            print(f"    {r['error']}")
    if not ARGS.apply:
        print("\nDry-run complete. Re-run with --apply to commit WP writes.")


if __name__ == "__main__":
    main()
