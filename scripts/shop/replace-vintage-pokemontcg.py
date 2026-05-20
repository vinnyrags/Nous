#!/usr/bin/env python3
"""
Replace vintage WP card images with pokemontcg.io scans, with a red
"cancel" icon composited over the 1st Edition stamp on cards whose
WP title doesn't claim 1st Edition.

Why this approach. pokemontcg.io's scans for the 1999-2000 Wizards-era
sets are Shadowless 1st Edition (the stamp is visible on the left
border of Pokemon cards, bottom of Trainer cards, top-right of Energy
cards). The user sells Unlimited copies in nearly every case; rather
than masking the stamp pixel-perfectly (a moving target across card
types and Holo backgrounds), we overlay a clearly-recognizable red
"prohibition" icon centered on the stamp. The icon visually negates
the stamp without trying to forge an Unlimited print.

Three stamp positions are detected automatically:
  Pokemon   left border, ~55% y      (cancel ~10% of card height)
  Trainer   bottom-left, ~92% y      (cancel ~10% of card height)
  Energy    top-right header, ~5% y  (cancel ~10% of card height)

Pipeline per card:
  1. Build pokemontcg.io URL from WP set + number.
  2. Download the _hires.png.
  3. Detect stamp position (scan each region for dark pixels).
  4. If not preserved, composite cancel-icon.png at the stamp center.
  5. Upload to WP /wp-json/wp/v2/media and POST featured_media on
     /card/{id}.

Modes:
  --apply        actually do WP writes (default is dry-run preview)
  --limit=N      first N cards only
  --card-id=N    one specific WP post id
  --set=NAME     one set only

Env (required with --apply):
  WP_REMEDIATE_USER          WP admin username
  WP_REMEDIATE_APP_PASSWORD  WP Application Password
  WP_BASE_URL                defaults to https://vincentragosta.io
"""

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from base64 import b64encode
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Need Pillow. Install with: pip3 install Pillow")

USER_AGENT = "vincentragosta-card-remediation/2.0"
THROTTLE_SEC = 0.3

# WP set name -> pokemontcg.io set id
PTCG_SET_IDS = {
    "Base Set": "base1",
    "Jungle": "base2",
    "Fossil": "base3",
    "Base Set 2": "base4",
    "Team Rocket": "base5",
    "Gym Heroes": "gym1",
    "Gym Challenge": "gym2",
}

# Sets that were never printed as 1st Edition — skip the cancel overlay
# because there's no stamp to cancel.
SETS_NEVER_STAMPED = {"Base Set 2"}

# Specific cards whose only existing print is stamped (no Unlimited
# variant exists). The stamp is canonically correct, so we skip the
# cancel overlay.
# Format: (set, number)
ALWAYS_STAMPED_CARDS = {
    ("Base Set", "8"),  # Machamp 1st Ed Shadowless (Starter Deck only)
}

OUT_DIR = Path(os.environ.get(
    "VINTAGE_FIX_DIR",
    str(Path.home() / "Projects/vinnyrags/websites/tmp/vintage-fix"),
))
PTCG_DIR = OUT_DIR / "ptcg"
RAW_DIR = PTCG_DIR / "raw"
OVERLAID_DIR = PTCG_DIR / "overlaid"

CANCEL_ICON_PATH = Path(__file__).parent / "assets" / "cancel-icon.png"


def http(url, *, method="GET", data=None, headers=None, timeout=60):
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, method=method, headers=h, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return s.strip("-")[:80]


def detect_stamp_center(im):
    """Return (cx, cy) of the 1st Edition stamp, or None.

    Scans three regions where Wizards-era stamps appear:
      A) Pokemon left border
      B) Trainer bottom-left
      C) Energy top-right (only when the header is a saturated color,
         otherwise we'd false-trigger on a Pokemon card's HP value text).
    """
    rgb = im.convert("RGB")  # detection only needs r,g,b — strip alpha
    w, h = im.size

    def dark_bbox(x0, x1, y0, y1):
        xs, ys = [], []
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b = rgb.getpixel((x, y))
                if (r + g + b) / 3 < 80:
                    xs.append(x); ys.append(y)
        return (min(xs), min(ys), max(xs), max(ys)) if xs else None

    # Region A: Pokemon left border
    a = dark_bbox(int(w * 0.045), int(w * 0.075), int(h * 0.45), int(h * 0.62))
    if a:
        # Expand to the typical stamp x-range (0.03-0.14)
        return (int(w * 0.085), (a[1] + a[3]) // 2)

    # Region B: Trainer bottom — guard against Pokemon flavor text.
    b = dark_bbox(int(w * 0.155), int(w * 0.215), int(h * 0.890), int(h * 0.955))
    if b:
        # Confirm dark pixels are not extending into mid-card (= flavor text)
        flavor = dark_bbox(int(w * 0.30), int(w * 0.60), int(h * 0.890), int(h * 0.955))
        flavor_width = (flavor[2] - flavor[0]) if flavor else 0
        if flavor_width < int(w * 0.05):
            return ((b[0] + b[2]) // 2, (b[1] + b[3]) // 2)

    # Region C: Energy top-right — only when header is saturated.
    samples = []
    for y in range(int(h * 0.035), int(h * 0.065), 2):
        for x in range(int(w * 0.30), int(w * 0.55), 2):
            samples.append(rgb.getpixel((x, y)))
    if samples:
        rs = sorted(c[0] for c in samples); gs = sorted(c[1] for c in samples); bs = sorted(c[2] for c in samples)
        mid = len(samples) // 2
        r, g, b_, sat = rs[mid], gs[mid], bs[mid], 0
        sat = max(r, g, b_) - min(r, g, b_)
        if sat > 60 and min(r, g, b_) < 200:
            # Stamp on pokemontcg.io Energy cards sits just left of the
            # right yellow border, around x=82-93%. The text "ENERGY"
            # ends around x=80% so we start the scan past it to avoid
            # locking onto the "Y" character.
            c = dark_bbox(int(w * 0.820), int(w * 0.930), int(h * 0.020), int(h * 0.085))
            if c:
                return ((c[0] + c[2]) // 2, (c[1] + c[3]) // 2)
    return None


def overlay_cancel(img_path, out_path, cancel_icon):
    """Detect stamp + composite cancel icon at that position.

    Returns "pokemon"/"trainer"/"energy"/None depending on which region
    fired.
    """
    im = Image.open(img_path).convert("RGBA")
    w, h = im.size

    center = detect_stamp_center(im)
    if not center:
        im.convert("RGB").save(out_path, quality=95)
        return None

    cx, cy = center
    icon_h = int(h * 0.115)
    icon = cancel_icon.resize((icon_h, icon_h), Image.LANCZOS)
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    overlay.paste(icon, (cx - icon_h // 2, cy - icon_h // 2), icon)
    out = Image.alpha_composite(im, overlay).convert("RGB")
    out.save(out_path, quality=95)

    # Classify by region (rough — only for logging)
    if cy < h * 0.20:
        return "energy"
    if cy > h * 0.80:
        return "trainer"
    return "pokemon"


def make_wp_writer(base, user, app_password):
    auth = "Basic " + b64encode(f"{user}:{app_password}".encode()).decode()

    def upload(buf, filename):
        return json.loads(http(
            f"{base}/wp-json/wp/v2/media",
            method="POST", data=buf, timeout=60,
            headers={
                "Authorization": auth,
                "Content-Type": "image/jpeg",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
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
    args = ap.parse_args()

    base = os.environ.get("WP_BASE_URL", "https://vincentragosta.io").rstrip("/")
    user = os.environ.get("WP_REMEDIATE_USER")
    pw = os.environ.get("WP_REMEDIATE_APP_PASSWORD")
    if args.apply and (not user or not pw):
        sys.exit("--apply requires WP_REMEDIATE_USER and WP_REMEDIATE_APP_PASSWORD")

    print("[APPLY]" if args.apply else "[DRY RUN]", "WP base:", base)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    OVERLAID_DIR.mkdir(parents=True, exist_ok=True)

    cards = json.loads((OUT_DIR / "cards.json").read_text())
    if args.card_id:
        cards = [c for c in cards if c["id"] == args.card_id]
    if args.only_set:
        cards = [c for c in cards if c["set"] == args.only_set]
    if args.limit:
        cards = cards[:args.limit]
    print(f"Targets: {len(cards)}")

    cancel_icon = Image.open(CANCEL_ICON_PATH).convert("RGBA")
    upload = set_featured = None
    if args.apply:
        upload, set_featured = make_wp_writer(base, user, pw)

    results = {"ok": [], "no_stamp": [], "errors": []}

    for i, c in enumerate(cards, 1):
        cid = c["id"]
        title = html_lib.unescape(c["title"])
        set_name = c["set"]
        number = c["number"]
        preserved = c.get("preserve", False)

        ptcg_id = PTCG_SET_IDS.get(set_name)
        if not ptcg_id:
            print(f"[{i}/{len(cards)}] #{cid} unknown set: {set_name}")
            results["errors"].append({**c, "error": f"unknown set {set_name}"})
            continue

        src_url = f"https://images.pokemontcg.io/{ptcg_id}/{number.lstrip('0') or '0'}_hires.png"
        slug = slugify(title)
        raw_path = RAW_DIR / f"{slug}.png"

        print(f"[{i}/{len(cards)}] #{cid} {title}")
        print(f"     src={src_url}  preserved={preserved}")

        try:
            if not raw_path.exists():
                raw_path.write_bytes(http(src_url))
        except urllib.error.HTTPError as e:
            print(f"     X download HTTP {e.code}")
            results["errors"].append({**c, "error": f"download: HTTP {e.code}"})
            continue
        except Exception as e:
            print(f"     X download: {e}")
            results["errors"].append({**c, "error": f"download: {e}"})
            continue

        out_path = OVERLAID_DIR / f"{slug}.jpg"
        short = number.lstrip("0") or "0"
        skip_overlay = (
            preserved
            or set_name in SETS_NEVER_STAMPED
            or (set_name, short) in ALWAYS_STAMPED_CARDS
        )
        if skip_overlay:
            Image.open(raw_path).convert("RGB").save(out_path, quality=95)
            if preserved:
                stamp_type = "preserved"
            elif set_name in SETS_NEVER_STAMPED:
                stamp_type = "never-stamped"
            else:
                stamp_type = "always-stamped"
        else:
            stamp_type = overlay_cancel(raw_path, out_path, cancel_icon)
            if stamp_type is None:
                stamp_type = "no-stamp-detected"
                results["no_stamp"].append({**c})
        print(f"     stamp={stamp_type}  -> {out_path}")

        if not args.apply:
            results["ok"].append({**c, "ptcg_url": src_url,
                                  "stamp_type": stamp_type, "local": str(out_path)})
            time.sleep(THROTTLE_SEC)
            continue

        try:
            ts = int(time.time() * 1000)
            attach_id = upload(out_path.read_bytes(), f"{slug}-{ts}.jpg")
            set_featured(cid, attach_id)
            print(f"     OK attach={attach_id} -> card #{cid}")
            results["ok"].append({**c, "ptcg_url": src_url,
                                  "stamp_type": stamp_type,
                                  "new_attachment_id": attach_id})
        except urllib.error.HTTPError as e:
            print(f"     X WP HTTP {e.code}")
            results["errors"].append({**c, "error": f"wp http {e.code}"})
        except Exception as e:
            print(f"     X WP: {e}")
            results["errors"].append({**c, "error": f"wp: {e}"})
        time.sleep(THROTTLE_SEC)

    (PTCG_DIR / "results.json").write_text(json.dumps(results, indent=2))

    print()
    print("=== summary ===")
    print(f"ok:                  {len(results['ok'])}")
    print(f"no_stamp (skipped):  {len(results['no_stamp'])}")
    print(f"errors:              {len(results['errors'])}")
    if results["no_stamp"]:
        print("\nNo stamp detected (passes through unmodified):")
        for r in results["no_stamp"][:20]:
            print(f"  - #{r['id']}  {html_lib.unescape(r['title'])}")
    if results["errors"]:
        print("\nErrors:")
        for r in results["errors"]:
            print(f"  - #{r['id']}  {html_lib.unescape(r['title'])}: {r['error']}")
    if not args.apply:
        print("\nDry-run complete. Re-run with --apply to commit.")


if __name__ == "__main__":
    main()
