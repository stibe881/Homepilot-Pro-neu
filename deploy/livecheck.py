"""Prüft die Live-Bild-Kette von innen und meldet jeden Schritt einzeln.

Aufruf auf dem Docker-Host:
    docker exec -i homepilot-hub python - < livecheck.py

Läuft im Container, spricht den Hub über 127.0.0.1 an und nimmt das Token
aus der Umgebung. Gibt aus, an welchem Glied es hakt – vom Kamerastrom
über mediamtx bis zu den Adressen, die der Player tatsächlich abruft.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

HUB = "http://127.0.0.1:8123"
MTX_API = "http://127.0.0.1:9997"
MTX_HLS = "http://127.0.0.1:8888"
BROWSER_UA = "Mozilla/5.0 hls.js"
APPLE_UA = "AppleCoreMedia/1.0.0 (iPhone; U; CPU OS 18_0 like Mac OS X)"


def get(url, ua=BROWSER_UA, timeout=25):
    """(Status, Inhalt) – Fehler werden zu Status 0 mit Text."""
    request = urllib.request.Request(url, headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:  # Verbindungsfehler, Zeitüberschreitung
        return 0, str(err).encode()


def short(data, limit=160):
    return data[:limit].decode("utf-8", "replace").replace("\n", " ⏎ ")


def first_url(playlist):
    """Erste Adresse aus einer Wiedergabeliste (Zeile oder URI="…")."""
    for line in playlist.decode("utf-8", "replace").splitlines():
        if line.startswith("#"):
            match = re.search(r'URI="([^"]+)"', line)
            if match:
                return match.group(1)
        elif line.strip():
            return line.strip()
    return None


token = os.environ.get("TOKEN_STEFAN") or os.environ.get("HOMEPILOT_TOKEN") or ""
if not token:
    raise SystemExit("Kein Token in der Umgebung (TOKEN_STEFAN/HOMEPILOT_TOKEN)")
quoted = urllib.parse.quote(token, safe="")
print(f"Token: {len(token)} Zeichen, Sonderzeichen: "
      f"{'ja' if quoted != token else 'nein'}")

# ── 1. mediamtx erreichbar? ──────────────────────────────────────────────
status, body = get(f"{MTX_API}/v3/config/global/get", timeout=5)
print(f"\n1) mediamtx-API      : {status} {'OK' if status == 200 else short(body)}")

# ── 2. Kameras des Hubs ──────────────────────────────────────────────────
status, body = get(f"{HUB}/api/entities?token={quoted}")
if status != 200:
    raise SystemExit(f"2) Hub-Entitäten     : {status} {short(body)}")
cameras = [e for e in json.loads(body) if e.get("kind") == "camera"]
print(f"2) Kameras           : {len(cameras)} gefunden")
for camera in cameras:
    print(f"   - {camera['id']}  live={camera['state'].get('stream')} "
          f"zustand={camera['state'].get('state')}")

targets = [c for c in cameras if c["state"].get("stream")]
if not targets:
    raise SystemExit("Keine Kamera mit RTSP – in Protect je Kamera einschalten.")

for camera in targets:
    entity = camera["id"]
    base = f"{HUB}/api/entities/{urllib.parse.quote(entity)}"
    print(f"\n=== {entity} ({camera['name']}) ===")

    # ── 3. Master-Playlist ───────────────────────────────────────────────
    status, master = get(f"{base}/stream.m3u8?token={quoted}")
    print(f"3) Master-Playlist   : {status}")
    if status != 200:
        print(f"   → {short(master, 300)}")
        continue
    print(f"   {short(master, 300)}")

    variant = first_url(master)
    if not variant:
        print("   → keine Unterliste in der Master-Playlist")
        continue
    print(f"   Unterliste: {variant}")
    encoded = any(mark in variant for mark in ("%2F", "%2B", "%3D"))
    print(f"   Token kodiert: {'ja' if encoded else 'nicht nötig/nein'}")
    print(f"   Token doppelt: {'JA – Fehler' if variant.count('token=') > 1 else 'nein'}")

    # ── 4. Unterliste (so wie der Player sie abruft) ─────────────────────
    status, media = get(f"{base}/{variant}")
    print(f"4) Unterliste        : {status}")
    if status != 200:
        print(f"   → {short(media, 300)}")
        continue

    # ── 5. Erstes Häppchen ───────────────────────────────────────────────
    piece = first_url(media)
    print(f"   erstes Stück: {piece}")
    if piece:
        status, data = get(f"{base}/stream/{piece}")
        print(f"5) Häppchen          : {status} ({len(data)} Bytes)")
        if status != 200:
            print(f"   → {short(data, 300)}")

    # ── 6. Was Apple bekommt ─────────────────────────────────────────────
    status, apple_master = get(f"{base}/stream.m3u8?token={quoted}", ua=APPLE_UA)
    apple_variant = first_url(apple_master) if status == 200 else None
    if apple_variant:
        status, apple_media = get(f"{base}/{apple_variant}", ua=APPLE_UA)
        text = apple_media.decode("utf-8", "replace")
        parts = text.count("#EXT-X-PART:")
        verdict = "(gut)" if parts == 0 else "(alter Hub-Code – neu bauen!)"
        print(f"6) Apple-Fassung     : {status}, PART-Zeilen: {parts} {verdict}")
        piece = first_url(apple_media)
        if piece:
            status, data = get(f"{base}/stream/{piece}", ua=APPLE_UA)
            print(f"   Apple-Häppchen    : {status} ({len(data)} Bytes)")

print("\nFertig. Alles 200 = die Kette liefert; die App müsste spielen.")
