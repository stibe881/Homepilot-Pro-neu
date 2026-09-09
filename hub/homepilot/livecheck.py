"""Prüft die Live-Bild-Kette von innen – jeden Schritt einzeln, mit Zeit.

Aufruf auf dem Docker-Host:
    docker exec homepilot-hub python -m homepilot.livecheck
    docker exec homepilot-hub python -m homepilot.livecheck --kalt

Spricht den Hub über 127.0.0.1 an und nimmt das Token aus der Umgebung.
Gibt aus, an welchem Glied es hakt – vom Kamerastrom über mediamtx bis zu
den Adressen, die der Player tatsächlich abruft. Meldet Python «No module
named homepilot.livecheck», läuft noch ein altes Abbild – dann zuerst
deploy/rebuild-hub.sh und in Portainer neu deployen.

**Und wie lange jeder Schritt braucht.** Gemeldet als «bis der Livestrom
kommt, dauert es lange» – und darauf antwortete diese Prüfung bisher
nicht: Sie sagte, *ob* jedes Glied liefert, nicht *wie lange* es dazu
braucht. Die Vermutung (die Kamera schickt im Smart Codec nur alle 4-8
Sekunden ein vollständiges Bild) liess sich damit nicht belegen.

Der Unterschied, auf den es dabei ankommt, ist warm gegen kalt: Läuft
der Strom schon, ist die Wiedergabeliste in Millisekunden da. Deshalb
sagt die Prüfung je Kamera, in welchem Zustand sie sie angetroffen hat –
und mit ``--kalt`` wartet sie, bis mediamtx den Strom losgelassen hat,
und misst den Start, den ein Mensch am Telefon erlebt.
"""

import functools
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from .core.streams import path_name

# docker exec ohne Terminal puffert stdout blockweise – dann sähe man
# minutenlang nichts. Jede Zeile sofort raus.
print = functools.partial(print, flush=True)

HUB = "http://127.0.0.1:8123"
MTX_API = "http://127.0.0.1:9997"
MTX_HLS = "http://127.0.0.1:8888"
BROWSER_UA = "Mozilla/5.0 hls.js"
APPLE_UA = "AppleCoreMedia/1.0.0 (iPhone; U; CPU OS 18_0 like Mac OS X)"


#: Wie lange auf einen kalten Start gewartet wird, bis mediamtx den
#: Strom losgelassen hat (ON_DEMAND_CLOSE ist 20 s) plus Reserve.
KALT_WARTEN = 30


def get(url, ua=BROWSER_UA, timeout=25):
    """(Status, Inhalt) – Fehler werden zu Status 0 mit Text.

    Die gebrauchte Zeit steht danach in ``get.dauer``: So bleiben alle
    Aufrufe unverändert lesbar, und trotzdem lässt sich jede Zeile mit
    ihrer Dauer ausgeben.
    """
    request = urllib.request.Request(url, headers={"User-Agent": ua})
    beginn = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:  # Verbindungsfehler, Zeitüberschreitung
        return 0, str(err).encode()
    finally:
        get.dauer = time.monotonic() - beginn


get.dauer = 0.0


def zeit():
    """Die Dauer des letzten Abrufs, als Zusatz für eine Zeile."""
    return f"{get.dauer:5.2f}s"


def pfade_bereit():
    """Welche mediamtx-Pfade gerade einen laufenden Strom haben.

    ``ready`` heisst: Die Kamera wird gerade angezapft. Genau das
    entscheidet, ob ein Abruf warm oder kalt ist - und ohne diese
    Auskunft misst man beim zweiten Aufruf etwas ganz anderes als beim
    ersten.
    """
    status, body = get(f"{MTX_API}/v3/paths/list", timeout=5)
    if status != 200:
        return {}
    try:
        eintraege = json.loads(body).get("items") or []
    except ValueError:
        return {}
    return {str(e.get("name")): bool(e.get("ready")) for e in eintraege}


def warte_auf_kalt(name):
    """Warten, bis mediamtx den Strom losgelassen hat (für --kalt)."""
    if not name:
        return False
    ende = time.monotonic() + KALT_WARTEN
    while time.monotonic() < ende:
        if not pfade_bereit().get(name, False):
            return True
        rest = int(ende - time.monotonic())
        print(f"   … warte auf kalten Zustand ({rest}s)", end="\r")
        time.sleep(2)
    return False


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


KALT = "--kalt" in sys.argv

token = os.environ.get("TOKEN_STEFAN") or os.environ.get("HOMEPILOT_TOKEN") or ""
if not token:
    raise SystemExit("Kein Token in der Umgebung (TOKEN_STEFAN/HOMEPILOT_TOKEN)")
quoted = urllib.parse.quote(token, safe="")
print(f"Token: {len(token)} Zeichen, Sonderzeichen: "
      f"{'ja' if quoted != token else 'nein'}")

# ── 1. mediamtx erreichbar? ──────────────────────────────────────────────
status, body = get(f"{MTX_API}/v3/config/global/get", timeout=5)
print(f"\n1) mediamtx-API      : {status} {'OK' if status == 200 else short(body)}")
bereit = pfade_bereit()
if bereit:
    laufend = [name for name, ready in bereit.items() if ready] or ["keiner"]
    print(f"   laufende Ströme    : {', '.join(laufend)}")

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

    # Warm oder kalt? Ohne diese Angabe misst der zweite Aufruf etwas
    # ganz anderes als der erste - und die Frage «warum dauert es so
    # lange» beantwortet nur der kalte.
    # Denselben Namen wie der Hub bilden, nicht einen ähnlichen: Sonst
    # sucht die Prüfung einen Pfad, den es in mediamtx gar nicht gibt,
    # und hält jede Kamera für kalt.
    pfad = path_name(entity)
    warm = pfade_bereit().get(pfad, False)
    if KALT and warm:
        print("   Strom läuft noch - warte, bis mediamtx ihn loslässt …")
        warm = not warte_auf_kalt(pfad)
    print(f"   Zustand vorher     : {'warm (läuft schon)' if warm else 'kalt'}")

    # ── 3. Master-Playlist ───────────────────────────────────────────────
    beginn = time.monotonic()
    status, master = get(f"{base}/stream.m3u8?token={quoted}")
    liste_dauer = get.dauer
    print(f"3) Master-Playlist   : {status} · {zeit()}")
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
    print(f"4) Unterliste        : {status} · {zeit()}")
    if status != 200:
        print(f"   → {short(media, 300)}")
        continue

    # ── 5. Erstes Häppchen ───────────────────────────────────────────────
    piece = first_url(media)
    print(f"   erstes Stück: {piece}")
    if piece:
        status, data = get(f"{base}/stream/{piece}")
        print(f"5) Häppchen          : {status} ({len(data)} Bytes) · {zeit()}")
        if status != 200:
            print(f"   → {short(data, 300)}")
    # Das ist die Zahl, um die es geht: von «jemand tippt die Kamera an»
    # bis «das erste Stück Video liegt da». Der Löwenanteil steckt im
    # Warten auf ein vollständiges Bild der Kamera (Protect sendet im
    # Smart Codec nur alle 4-8 s eines) - deshalb steht daneben, ob der
    # Strom vorher schon lief.
    print(
        f"   bis zum ersten Bild: {time.monotonic() - beginn:5.2f}s "
        f"({'warm' if warm else 'kalt'}; davon Wiedergabeliste {liste_dauer:.2f}s)"
    )

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

print(
    "\nFertig. Alles 200 = die Kette liefert; die App müsste spielen."
    "\nKalt gemessen? Dann ist die Zeit «bis zum ersten Bild» die, die ein"
    "\nMensch am Telefon erlebt - plus zwei Sekunden Vorlauf, mit denen"
    "\nApple-Player einsteigen (streaming.start_offset)."
    "\nOhne --kalt lief der Strom womöglich schon; die Zeile «Zustand"
    "\nvorher» sagt es je Kamera."
)
