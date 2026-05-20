#!/usr/bin/env python3
"""
Replace vintage WP card images with clean Unlimited scans sourced from
TCGPlayer's catalog images.

Background. The previous pass (replace-vintage-card-images.py) sourced
from Pokellector, which (a) bakes in a "Pokellector" watermark and (b)
inconsistently serves 1st-Edition-stamped scans for the Wizards-era
sets even when the WP listing is Unlimited. TCGPlayer's product CDN
returns images up to 1500x1500 with no watermark. For Base Set and
Base Set 2 their catalog image is Unlimited (no stamp). For Jungle /
Fossil / Team Rocket / Gym Heroes / Gym Challenge the catalog image
carries the EDITION 1 stamp on the left border — we strip it
programmatically with a yellow-fill patch (`mask_edition_stamp`).

For the 3 preserved 1st-Edition cards (Drowzee, Koffing, Mankey from
Team Rocket) the TCGPlayer image happens to be 1st Edition, which is
what the WP title says — so we keep the stamp and skip masking.

Pipeline per card:
  1. Look up TCGPlayer productId by (set, number) using the cached
     per-set listing (one paginated search per set).
  2. Download fit-in/1500x1500/{productId}.jpg.
  3. If not preserved, mask the EDITION 1 stamp.
  4. Upload to WP /wp-json/wp/v2/media and POST featured_media on
     /card/{id}.

Modes:
  --apply         actually do WP writes (default is dry-run preview)
  --limit=N       process only the first N cards
  --card-id=N     process only the single card with this WP post id
  --set=NAME      process only one set ("Base Set", "Jungle", etc.)
  --skip-mask     skip stamp masking (debug)

Env (required when --apply is passed):
  WP_REMEDIATE_USER          WP admin username
  WP_REMEDIATE_APP_PASSWORD  WP Application Password
  WP_BASE_URL                defaults to https://vincentragosta.io

Outputs (under $VINTAGE_FIX_DIR/tcg/):
  set-index.json   cached per-set {number: productId} maps
  raw/             downloaded TCGPlayer images
  masked/          stamp-removed images (or raw copies for preserves)
  results.json     per-card outcome
"""

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from base64 import b64encode
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Need Pillow. Install with: pip3 install Pillow")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
THROTTLE_SEC = 0.4

TCG_SEARCH = "https://mp-search-api.tcgplayer.com/v1/search/request?q=%20&isList=true&mpfev=2042"
TCG_IMAGE = "https://product-images.tcgplayer.com/fit-in/1500x1500/{}.jpg"

# WP set name -> TCGPlayer setName
TCG_SET_NAMES = {
    "Base Set": "Base Set",
    "Jungle": "Jungle",
    "Fossil": "Fossil",
    "Base Set 2": "Base Set 2",
    "Team Rocket": "Team Rocket",
    "Gym Heroes": "Gym Heroes",
    "Gym Challenge": "Gym Challenge",
}

# Manual product ID overrides for cards that don't appear in the
# standard set listing on TCGPlayer. Format: (set, number) -> productId.
MANUAL_OVERRIDES = {
    # Machamp Base Set 8/102 was only ever printed as 1st Edition
    # Shadowless (Starter Deck exclusive — no Unlimited version exists).
    # TCGPlayer catalogs it under "Deck Exclusives" rather than "Base Set".
    ("Base Set", "8"): 107004,
}

# Cards that should NEVER have the stamp masked because the title's
# print variant is inherently stamped (only stamped variants exist).
# Format: (set, number).
ALWAYS_STAMPED = {
    ("Base Set", "8"),  # Machamp 1st Ed Shadowless — no Unlimited exists
}

OUT_DIR = Path(os.environ.get(
    "VINTAGE_FIX_DIR",
    str(Path.home() / "Projects/vinnyrags/websites/tmp/vintage-fix"),
))
TCG_DIR = OUT_DIR / "tcg"
RAW_DIR = TCG_DIR / "raw"
MASKED_DIR = TCG_DIR / "masked"
INDEX_PATH = TCG_DIR / "set-index.json"


def http(url, *, method="GET", data=None, headers=None, timeout=30):
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, method=method, headers=h, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return s.strip("-")[:80]


def fetch_set_listing(set_name):
    """Paginate TCGPlayer search for one setName, return {number: productId}."""
    out = {}
    page_from = 0
    page_size = 50
    while True:
        body = json.dumps({
            "algorithm": "sales_dec",
            "from": page_from,
            "size": page_size,
            "filters": {
                "term": {
                    "productLineName": ["pokemon"],
                    "setName": [set_name],
                },
                "range": {},
                "match": {},
            },
            "context": {"shippingCountry": "US"},
        }).encode()
        try:
            raw = http(TCG_SEARCH, method="POST", data=body,
                       headers={"Content-Type": "application/json",
                                "Accept": "application/json"})
        except urllib.error.HTTPError as e:
            if e.code == 400:
                # TCGPlayer rejects pagination past some internal cap.
                # Treat as end-of-results.
                break
            raise
        d = json.loads(raw)
        results = d.get("results", [])
        if not results:
            break
        cards = results[0].get("results", [])
        total = results[0].get("totalResults", 0)
        for c in cards:
            number = (c.get("customAttributes", {}) or {}).get("number")
            pid = c.get("productId")
            if not number or pid is None:
                continue
            # Strip leading zeros for matching (WP stores "1", TCGPlayer "001")
            short = number.lstrip("0") or "0"
            if "/" in number:
                short = number.split("/")[0].lstrip("0") or "0"
            if short not in out:
                out[short] = int(pid)
            # Also store full as-is form
            if number not in out:
                out[number] = int(pid)
        page_from += page_size
        if page_from >= total:
            break
        time.sleep(THROTTLE_SEC)
    return out


def build_set_indexes(force=False):
    """Build/load {setName: {number: productId}}."""
    if INDEX_PATH.exists() and not force:
        return json.loads(INDEX_PATH.read_text())
    print("Building TCGPlayer set indexes (one paginated search per set)...")
    indexes = {}
    for wp_name, tcg_name in TCG_SET_NAMES.items():
        print(f"  fetching {tcg_name}...", end="", flush=True)
        idx = fetch_set_listing(tcg_name)
        print(f" {len(idx)} entries")
        indexes[wp_name] = idx
        time.sleep(THROTTLE_SEC)
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(indexes, indent=2))
    return indexes


def _border_yellow(im):
    """Median yellow of the card border, sampled from text-free regions."""
    w, h = im.size
    samples = []
    for region in [
        (int(w * 0.92), int(w * 0.985), int(h * 0.008), int(h * 0.030)),
        (int(w * 0.92), int(w * 0.985), int(h * 0.20),  int(h * 0.40)),
        (int(w * 0.92), int(w * 0.985), int(h * 0.97),  int(h * 0.99)),
    ]:
        for y in range(region[2], region[3], 2):
            for x in range(region[0], region[1], 2):
                samples.append(im.getpixel((x, y)))
    yellows = [c for c in samples if c[0] > 200 and c[1] > 170 and c[2] < 150]
    if not yellows:
        yellows = samples
    rs = sorted(c[0] for c in yellows)
    gs = sorted(c[1] for c in yellows)
    bs = sorted(c[2] for c in yellows)
    mid = len(yellows) // 2
    return (rs[mid], gs[mid], bs[mid])


def _local_color(im, x0, x1, y0, y1):
    """Median color in a region — used for header-tinted stamps (Energy cards)."""
    samples = []
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            samples.append(im.getpixel((x, y)))
    rs = sorted(c[0] for c in samples)
    gs = sorted(c[1] for c in samples)
    bs = sorted(c[2] for c in samples)
    mid = len(samples) // 2
    return (rs[mid], gs[mid], bs[mid])


def _paste_fill(im, fill, x0, y0, x1, y1, feather=3):
    mw, mh = x1 - x0, y1 - y0
    patch = Image.new("RGB", (mw, mh), fill)
    mask = Image.new("L", (mw, mh), 255).filter(ImageFilter.GaussianBlur(radius=feather))
    im.paste(patch, (x0, y0), mask)


def mask_edition_stamp(img_path, out_path):
    """Detect and cover the EDITION 1 stamp.

    Wizards-era stamps appear in three positions depending on card type:
      A. Pokemon — left yellow border, vertically around mid-card (~55% y).
      B. Trainer — bottom of card between description box and footer
         (~92% y, ~17% x).
      C. Energy — top header, right of the type name (~5% y, ~73% x),
         tinted to the card's element color (red for Fire, etc).

    Scans a narrow detection strip in each region; whichever has a dark
    cluster gets a fill patch sampled from a clean nearby area.
    Returns the number of regions masked.
    """
    im = Image.open(img_path).convert("RGB")
    w, h = im.size
    masked_regions = 0

    def find_dark_ys(det_x0, det_x1, det_y0, det_y1):
        ys = []
        for y in range(det_y0, det_y1):
            for x in range(det_x0, det_x1):
                r, g, b = im.getpixel((x, y))
                if (r + g + b) / 3 < 80:
                    ys.append(y)
                    break
        return ys

    def find_dark_xs(det_x0, det_x1, det_y0, det_y1):
        xs = []
        for x in range(det_x0, det_x1):
            for y in range(det_y0, det_y1):
                r, g, b = im.getpixel((x, y))
                if (r + g + b) / 3 < 80:
                    xs.append(x)
                    break
        return xs

    # Region A: Pokemon left-border stamp.
    a_ys = find_dark_ys(int(w * 0.045), int(w * 0.075), int(h * 0.45), int(h * 0.62))
    if a_ys:
        yellow = _border_yellow(im)
        _paste_fill(
            im, yellow,
            int(w * 0.030), max(0, min(a_ys) - 6),
            int(w * 0.140), min(h, max(a_ys) + 7),
        )
        masked_regions += 1

    # Region B: Trainer bottom-of-card stamp. Pokemon cards have flavor
    # text in this same y-range that would false-trigger this detector,
    # so confirm the dark cluster is *isolated* — flavor text extends
    # across most of the card width, the stamp doesn't.
    b_ys = find_dark_ys(int(w * 0.155), int(w * 0.215), int(h * 0.890), int(h * 0.955))
    if b_ys:
        # If dark pixels also appear in the mid-card region at this
        # height, it's Pokemon flavor text — skip.
        flavor_xs = find_dark_xs(int(w * 0.30), int(w * 0.60),
                                  int(h * 0.890), int(h * 0.955))
        if len(flavor_xs) < 30:
            yellow = _border_yellow(im)
            _paste_fill(
                im, yellow,
                int(w * 0.110), max(0, min(b_ys) - 5),
                int(w * 0.260), min(h, max(b_ys) + 6),
            )
            masked_regions += 1

    # Region C: Energy top-right stamp. Pokemon and Trainer cards both
    # have light/yellow headers; Energy cards have a saturated colored
    # header (red Fire, blue Water, etc). Only run this detector when
    # the header is saturated — otherwise we'd false-trigger on the HP
    # value text or type-symbol on a Pokemon card.
    header_color = _local_color(im, int(w * 0.30), int(w * 0.55),
                                int(h * 0.035), int(h * 0.065))
    r, g, b = header_color
    is_saturated_header = (max(r, g, b) - min(r, g, b)) > 60 and min(r, g, b) < 200
    if is_saturated_header:
        c_xs = find_dark_xs(int(w * 0.700), int(w * 0.780),
                            int(h * 0.025), int(h * 0.080))
        if c_xs:
            c_ys = find_dark_ys(int(w * 0.700), int(w * 0.780),
                                int(h * 0.020), int(h * 0.090))
            local = _local_color(im, int(w * 0.55), int(w * 0.66),
                                 int(h * 0.035), int(h * 0.065))
            mx0 = max(0, min(c_xs) - 6)
            mx1 = min(w, max(c_xs) + 7)
            my0 = max(0, min(c_ys) - 6) if c_ys else int(h * 0.025)
            my1 = min(h, max(c_ys) + 7) if c_ys else int(h * 0.080)
            _paste_fill(im, local, mx0, my0, mx1, my1, feather=4)
            masked_regions += 1

    im.save(out_path, quality=95)
    return masked_regions


# ---- WP API ----

def make_wp_writer(base, user, app_password):
    auth = "Basic " + b64encode(f"{user}:{app_password}".encode()).decode()

    def upload(buf, filename):
        return json.loads(http(
            f"{base}/wp-json/wp/v2/media",
            method="POST",
            data=buf,
            headers={
                "Authorization": auth,
                "Content-Type": "image/jpeg",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
            timeout=60,
        ).decode())["id"]

    def set_featured(card_id, attach_id):
        return json.loads(http(
            f"{base}/wp-json/wp/v2/card/{card_id}",
            method="POST",
            data=json.dumps({"featured_media": attach_id}).encode(),
            headers={"Authorization": auth, "Content-Type": "application/json"},
            timeout=60,
        ).decode())

    return upload, set_featured


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--card-id", type=int)
    ap.add_argument("--set", dest="only_set")
    ap.add_argument("--skip-mask", action="store_true")
    ap.add_argument("--refresh-index", action="store_true")
    args = ap.parse_args()

    base = os.environ.get("WP_BASE_URL", "https://vincentragosta.io").rstrip("/")
    user = os.environ.get("WP_REMEDIATE_USER")
    pw = os.environ.get("WP_REMEDIATE_APP_PASSWORD")
    if args.apply and (not user or not pw):
        sys.exit("--apply requires WP_REMEDIATE_USER and WP_REMEDIATE_APP_PASSWORD")

    print("[APPLY]" if args.apply else "[DRY RUN]", "WP base:", base)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    MASKED_DIR.mkdir(parents=True, exist_ok=True)

    cards = json.loads((OUT_DIR / "cards.json").read_text())
    if args.card_id:
        cards = [c for c in cards if c["id"] == args.card_id]
    if args.only_set:
        cards = [c for c in cards if c["set"] == args.only_set]
    if args.limit:
        cards = cards[:args.limit]
    print(f"Targets: {len(cards)}")

    indexes = build_set_indexes(force=args.refresh_index)

    upload = set_featured = None
    if args.apply:
        upload, set_featured = make_wp_writer(base, user, pw)

    results = {"ok": [], "no_match": [], "errors": []}

    for i, c in enumerate(cards, 1):
        cid = c["id"]
        title = html_lib.unescape(c["title"])
        set_name = c["set"]
        number = c["number"]
        preserved = c.get("preserve", False)

        idx = indexes.get(set_name) or {}
        # Try both bare number and "X/Y" forms
        short = number.lstrip("0") or "0"
        pid = idx.get(short) or idx.get(number) or idx.get(f"{number}/{c.get('total','')}")
        # Manual overrides for cards TCGPlayer files under a non-standard
        # setName (e.g., Starter Deck exclusives).
        pid = MANUAL_OVERRIDES.get((set_name, short), pid)

        print(f"[{i}/{len(cards)}] #{cid} {title}")
        print(f"     set={set_name} num={number} preserved={preserved}")

        if not pid:
            print("     ! no TCGPlayer match")
            results["no_match"].append({**c, "reason": "no productId"})
            continue

        print(f"     pid={pid}  -> {TCG_IMAGE.format(pid)}")

        slug = slugify(title)
        raw_path = RAW_DIR / f"{slug}-{pid}.jpg"
        try:
            if not raw_path.exists():
                raw_path.write_bytes(http(TCG_IMAGE.format(pid)))
        except Exception as e:
            print(f"     X download: {e}")
            results["errors"].append({**c, "error": f"download: {e}"})
            continue

        masked_path = MASKED_DIR / f"{slug}-{pid}.jpg"
        always_stamped = (set_name, short) in ALWAYS_STAMPED
        if preserved or args.skip_mask or always_stamped:
            # Skip masking when the print variant is inherently stamped
            # (preserved 1st Eds in WP, or cards where the only existing
            # print is the stamped one — see ALWAYS_STAMPED).
            masked_path.write_bytes(raw_path.read_bytes())
            stamp_masked = 0
        else:
            stamp_masked = mask_edition_stamp(raw_path, masked_path)
        print(f"     masked_regions={stamp_masked}  -> {masked_path}")

        if not args.apply:
            results["ok"].append({
                **c,
                "tcg_pid": pid,
                "tcg_image": TCG_IMAGE.format(pid),
                "stamp_masked_regions": stamp_masked,
                "local": str(masked_path),
            })
            time.sleep(THROTTLE_SEC)
            continue

        try:
            ts = int(time.time() * 1000)
            attach_id = upload(masked_path.read_bytes(), f"{slug}-{ts}.jpg")
            set_featured(cid, attach_id)
            print(f"     OK attach={attach_id} -> card #{cid}")
            results["ok"].append({
                **c,
                "tcg_pid": pid,
                "tcg_image": TCG_IMAGE.format(pid),
                "stamp_masked_regions": stamp_masked,
                "new_attachment_id": attach_id,
            })
        except urllib.error.HTTPError as e:
            print(f"     X WP write: HTTP {e.code} {e.reason}")
            results["errors"].append({**c, "error": f"wp http {e.code}: {e.reason}"})
        except Exception as e:
            print(f"     X WP: {e}")
            results["errors"].append({**c, "error": f"wp: {e}"})

        time.sleep(THROTTLE_SEC)

    (TCG_DIR / "results.json").write_text(json.dumps(results, indent=2))

    print()
    print("=== summary ===")
    print(f"ok:       {len(results['ok'])}")
    print(f"no_match: {len(results['no_match'])}")
    print(f"errors:   {len(results['errors'])}")
    if results["no_match"]:
        print("\nNo match — needs manual handling:")
        for r in results["no_match"]:
            print(f"  - #{r['id']}  {html_lib.unescape(r['title'])}")
    if results["errors"]:
        print("\nErrors:")
        for r in results["errors"]:
            print(f"  - #{r['id']}  {html_lib.unescape(r['title'])}: {r['error']}")
    if not args.apply:
        print("\nDry-run complete. Re-run with --apply to commit WP writes.")


if __name__ == "__main__":
    main()
