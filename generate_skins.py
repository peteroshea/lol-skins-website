#!/usr/bin/env python3
"""
generate_skins.py — Auto-build skins-data.js from Data Dragon + Community Dragon + Meraki.

Usage:
    python3 generate_skins.py

Output:
    skins-data.js (overwrites existing file in the same directory as this script)

Data sources:
    - Data Dragon 16.4.1  : champion list, skin names, splash indices
    - Community Dragon     : rarity (→ tier), isLegacy (→ availability), skin lines, lore
    - Meraki Analytics     : release dates, actual RP costs
"""

import json
import urllib.request
import urllib.error
import time
import os
import sys

# ── Config ────────────────────────────────────────────────────────────────────
DDV         = "16.4.1"
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "skins-data.js")
DELAY       = 0.05   # seconds between Data Dragon per-champion requests

CDN_BASE    = f"https://ddragon.leagueoflegends.com/cdn/{DDV}/data/en_US"
CDN_CHAMPS  = f"{CDN_BASE}/champion.json"
CDN_CHAMP   = f"{CDN_BASE}/champion/{{key}}.json"
CD_SKINS    = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skins.json"
CD_LINES    = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skinlines.json"
MERAKI_URL  = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json"

# ── Tier / RP mappings ────────────────────────────────────────────────────────
RARITY_TIER = {
    "kUltimate":  "Ultimate",
    "kMythic":    "Mythic",
    "kLegendary": "Legendary",
    "kEpic":      "Epic",
    "kRare":      "Rare",
    "kNoRarity":  "Standard",   # refined to Budget below for old cheap skins
}
TIER_RP = {
    "Ultimate":  3250,
    "Mythic":    0,
    "Legendary": 1820,
    "Epic":      1350,
    "Standard":  975,
    "Budget":    520,
    "Rare":      0,
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def fetch(url, label=""):
    req = urllib.request.Request(url, headers={"User-Agent": "lol-skins-generator/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  WARN: could not fetch {label or url}: {e}", file=sys.stderr)
        return None

def esc(s):
    """Escape a string for JS double-quoted context."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", "")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # 1. Community Dragon: skin lines
    print("Fetching skin line names from Community Dragon...")
    lines_raw = fetch(CD_LINES, "skinlines.json") or []
    skinline_map = {sl["id"]: sl["name"] for sl in lines_raw}
    print(f"  {len(skinline_map)} skin lines loaded")

    # 2. Community Dragon: full skin metadata
    print("Fetching skin metadata from Community Dragon (large file, may take a moment)...")
    cd_raw = fetch(CD_SKINS, "skins.json") or {}
    # The file is a dict keyed by skin ID string
    cd_skins = {}
    for val in cd_raw.values():
        if isinstance(val, dict) and "id" in val:
            cd_skins[str(val["id"])] = val
    print(f"  {len(cd_skins)} skin entries loaded")

    # 3. Meraki Analytics: release dates + actual RP costs
    print("Fetching release dates and costs from Meraki Analytics...")
    meraki_raw = fetch(MERAKI_URL, "meraki champions.json") or {}
    meraki_map = {}   # skin_id (str) → {"release": "YYYY-MM-DD", "cost": int}
    for champ_data in meraki_raw.values():
        for s in champ_data.get("skins", []):
            sid  = str(s.get("id", ""))
            cost = s.get("cost")
            release = s.get("release", "")
            if sid:
                meraki_map[sid] = {
                    "release": release or "",
                    "cost":    cost if isinstance(cost, int) else None,
                }
    print(f"  {len(meraki_map)} skin records loaded from Meraki")

    # 4. Data Dragon: champion list
    print("Fetching champion list from Data Dragon...")
    champ_list = fetch(CDN_CHAMPS, "champion.json")
    if not champ_list:
        sys.exit("ERROR: could not fetch champion list.")
    champions = champ_list["data"]   # dict key → basic info
    print(f"  {len(champions)} champions found")

    # 5. Per-champion skin data
    all_skins = []
    skin_id   = 1

    for i, (champ_key, _) in enumerate(sorted(champions.items()), 1):
        print(f"  [{i}/{len(champions)}] {champ_key}")
        champ_data = fetch(CDN_CHAMP.format(key=champ_key), champ_key)
        if not champ_data:
            continue
        champ_info  = champ_data["data"][champ_key]

        for skin in champ_info.get("skins", []):
            if skin["num"] == 0:
                continue   # skip default skin

            cd_id   = str(skin["id"])     # e.g. "266001"
            cd_skin = cd_skins.get(cd_id, {})

            # Meraki data for this skin
            meraki = meraki_map.get(cd_id, {})

            # Tier (from Community Dragon rarity)
            rarity = cd_skin.get("rarity", "kNoRarity")
            tier   = RARITY_TIER.get(rarity, "Standard")

            # RP: prefer Meraki actual cost, fall back to tier default
            meraki_cost = meraki.get("cost")
            if meraki_cost is not None:
                rp = meraki_cost
                # Refine tier for kNoRarity based on actual price
                if rarity == "kNoRarity" and tier == "Standard":
                    if rp <= 520:
                        tier = "Budget"
            else:
                rp = TIER_RP[tier]

            # Release date from Meraki
            release_date = meraki.get("release", "")

            # Skin line
            sl_ids   = cd_skin.get("skinLines") or []
            if sl_ids and isinstance(sl_ids[0], dict):
                sl_name = skinline_map.get(sl_ids[0].get("id"), "")
            else:
                sl_name = ""
            if not sl_name:
                # Fall back: strip champion name from skin name
                sl_name = skin["name"].replace(champ_info.get("name", champ_key), "").strip(" -")
                if not sl_name:
                    sl_name = skin["name"]

            # Availability
            if cd_skin.get("isLegacy"):
                availability = "Legacy"
            elif rarity == "kRare":
                availability = "Rare"
            elif cd_skin.get("skinType") == "Prestige" or "Prestige" in skin["name"]:
                availability = "Limited"
            else:
                availability = "Available"

            # Lore
            lore = (cd_skin.get("description") or "").strip()
            lore = lore[:220]

            all_skins.append({
                "id":           skin_id,
                "name":         skin["name"],
                "champion":     champ_key,
                "tier":         tier,
                "rp":           rp,
                "releaseDate":  release_date,
                "skinLine":     sl_name,
                "availability": availability,
                "features":     [],
                "lore":         lore,
                "splashIndex":  skin["num"],
            })
            skin_id += 1

        time.sleep(DELAY)

    print(f"\nTotal skins collected: {len(all_skins)}")

    # 5. Write output
    out = [
        "// Auto-generated by generate_skins.py\n",
        f"// Data Dragon {DDV} + Community Dragon (latest) + Meraki Analytics\n",
        "// Re-run generate_skins.py to refresh after patches.\n",
        "\n",
        "window.SKINS = [\n",
    ]
    for s in all_skins:
        features_js = "[]"
        line = (
            f'  {{ id:{s["id"]}, name:"{esc(s["name"])}", champion:"{esc(s["champion"])}", '
            f'tier:"{s["tier"]}", rp:{s["rp"]}, releaseDate:"{s["releaseDate"]}", '
            f'skinLine:"{esc(s["skinLine"])}", availability:"{s["availability"]}", '
            f'features:{features_js}, lore:"{esc(s["lore"])}", splashIndex:{s["splashIndex"]} }},\n'
        )
        out.append(line)
    out.append("];\n")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.writelines(out)

    print(f"Written → {OUTPUT_PATH}")
    print("Done.")

if __name__ == "__main__":
    main()
