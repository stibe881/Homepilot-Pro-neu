#!/usr/bin/env bash
# Baut das Hub-Abbild frisch aus dem Repository und räumt das alte weg -
# der ganze manuelle Dreisatz (stop/rm/clone/build) in einem Befehl, für
# den Fall, dass "Update the stack" in Portainer den neuesten Commit nicht
# selbst zieht.
#
# ── Einmalige Einrichtung auf dem Docker-Host ──────────────────────────
#
#   sudo mkdir -p /opt/homepilot
#   sudo nano /opt/homepilot/github-credentials.env
#
# Dort rein (GitHub-Benutzername + ein Personal Access Token mit
# Lesezugriff auf dieses private Repository):
#
#   GITHUB_USER=dein-github-benutzername
#   GITHUB_TOKEN=dein-personal-access-token
#
#   sudo chmod 600 /opt/homepilot/github-credentials.env
#
# Dieses Skript selbst nach /opt/homepilot/rebuild-hub.sh kopieren
# (Inhalt aus dem Repository oder direkt von hier) und ausführbar machen:
#
#   sudo chmod +x /opt/homepilot/rebuild-hub.sh
#
# ── Ab dann bei jedem Update ────────────────────────────────────────────
#
#   sudo /opt/homepilot/rebuild-hub.sh
#
# ...und danach in Portainer einmal Stacks → homepilot → "Update the
# stack" → Deploy klicken, damit der Container das frische Abbild nutzt.
#
# ── Optional: auch den letzten Klick automatisieren ─────────────────────
#
# Dieses Skript startet den Container absichtlich nicht selbst - deine
# Tokens (HOMEPILOT_TOKEN, TOKEN_STEFAN, SUPABASE_SERVICE_KEY, ...) liegen
# ausschliesslich in Portainers Stack-Konfiguration, und das soll auch so
# bleiben, statt sie zusätzlich in eine Datei auf der Platte zu duplizieren.
#
# Wer trotzdem einen einzigen Befehl will: In Portainer unter Stacks →
# homepilot → "Webhook" einen Stack-Webhook aktivieren (löst bei einem
# POST-Aufruf automatisch "Update the stack" aus, ohne dass Portainer
# dafür Tokens preisgibt) und die angezeigte URL in
# github-credentials.env eintragen:
#
#   PORTAINER_WEBHOOK_URL=https://portainer.example.com/api/stacks/webhooks/xxxxxxxx
#
# Laeuft Portainer auf Port 9443 mit seinem selbst ausgestellten
# Zertifikat, kommt eine Zeile dazu - sonst bricht curl mit einem
# Zertifikatsfehler ab, mitten im sonst fertigen Update:
#
#   PORTAINER_INSECURE=1
#
# Ist die Variable gesetzt, ruft dieses Skript sie am Ende automatisch auf.
#
# ── Optional: die Web-Fassung der App gleich mit ──────────────────────
#
# Existiert der Zielordner der Web-Fassung (siehe docs/app-ohne-vpn.md)
# schon, baut dieses Skript sie bei jedem Lauf gleich mit - in einem
# Wegwerf-Container, ohne dass Node auf dem Host installiert sein muss.
# Ein eigener Ordner dafür ist der einzige Schalter; ohne ihn passiert
# hier nichts Neues.

set -euo pipefail

BRANCH="${HOMEPILOT_BRANCH:-claude/custom-home-automation-t9lvq3}"
REPO="stibe881/Homepilot-Pro-neu"
WORKDIR="/tmp/homepilot-build"
CREDENTIALS_FILE="/opt/homepilot/github-credentials.env"
CONTAINER="homepilot-hub"
IMAGE="homepilot-hub"
WEB_ROOT="${HOMEPILOT_WEB_ROOT:-/opt/homepilot/web}"

if [ -f "$CREDENTIALS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CREDENTIALS_FILE"
fi
: "${GITHUB_USER:?GITHUB_USER fehlt – siehe Kopf dieses Skripts}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN fehlt – siehe Kopf dieses Skripts}"

# Der alte Container läuft absichtlich weiter, während gebaut wird: Das
# neue Abbild entsteht daneben, unter demselben Namen. Erst ganz am Ende,
# unmittelbar vor dem Neuausrollen, wird gewechselt - so ist der Hub
# Sekunden weg statt Minuten. Und geht der Bau schief, läuft der alte
# Stand einfach weiter, statt dass das Haus ohne Steuerung dasteht.

echo "→ Hole den neuesten Code von ${REPO}@${BRANCH} …"
rm -rf "$WORKDIR"
git clone --depth 1 -b "$BRANCH" \
  "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORKDIR"

# Sich selbst auffrischen - gilt ab dem NÄCHSTEN Lauf. mv ersetzt die Datei
# atomar über einen neuen Inode; die gerade laufende Instanz liest ungestört
# aus der alten weiter. Damit entfällt das ewige Von-Hand-Kopieren nach
# jeder Skript-Änderung.
if ! cmp -s "$WORKDIR/deploy/rebuild-hub.sh" "$0"; then
  cp "$WORKDIR/deploy/rebuild-hub.sh" "$0.neu"
  chmod +x "$0.neu"
  mv "$0.neu" "$0"
  echo "→ Skript selbst aktualisiert - der neue Stand gilt ab dem nächsten Lauf."
fi
# Den Update-Dienst nur hinlegen, nie hier neu starten: Ein Neustart würde
# genau den Bau abwürgen, den er gerade beaufsichtigt.
if [ -f /opt/homepilot/update-listener.py ] \
   && ! cmp -s "$WORKDIR/deploy/update-listener.py" /opt/homepilot/update-listener.py; then
  cp "$WORKDIR/deploy/update-listener.py" /opt/homepilot/update-listener.py
  echo "→ update-listener.py aktualisiert - danach einmal von Hand:"
  echo "  sudo systemctl restart homepilot-update   (nicht während eines Baus)"
fi

if [ -n "$WEB_ROOT" ] && [ "$WEB_ROOT" != "/" ] && [ -d "$WEB_ROOT" ]; then
  echo "→ Baue die Web-Fassung der App …"
  # node:20-bookworm-slim statt alpine: Metro/Expo bringen gelegentlich
  # Pakete mit, die eine echte glibc statt musl erwarten - das Abbild ist
  # etwas grösser, bleibt dafür aber Überraschungen erspart. Bleibt danach
  # im Docker-Cache liegen, kein erneuter Download bei jedem Lauf.
  if docker run --rm \
      -v "$WORKDIR/app:/app" -w /app \
      node:20-bookworm-slim \
      sh -c "npm ci --no-audit --no-fund && npm run build:web"; then
    # Den alten Stand erst jetzt wegräumen, nicht vorher - schlägt der Bau
    # fehl, bleibt die zuletzt funktionierende Fassung online.
    find "$WEB_ROOT" -mindepth 1 -delete
    cp -r "$WORKDIR/app/dist/." "$WEB_ROOT/"
    echo "✓ Web-Fassung aktualisiert."
  else
    echo "⚠ Web-Bau fehlgeschlagen - die bisherige Fassung bleibt online."
    echo "  Der Hub selbst wird trotzdem weitergebaut."
  fi
fi

echo "→ Baue das Abbild neu (ohne Cache) …"
# Commit und Bauzeit wandern ins Abbild. Ohne sie zeigt die App nur
# «läuft», und nach einem Update sieht man nicht, ob der Container
# wirklich der neue ist.
COMMIT="$(git -C "$WORKDIR" rev-parse --short HEAD)"
docker build --no-cache \
  --build-arg "GIT_COMMIT=$COMMIT" \
  --build-arg "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "$IMAGE" "$WORKDIR/hub"

rm -rf "$WORKDIR"

# Jeder Bauversuch läuft ohne Cache – jede Schicht entsteht neu, die vorige
# verliert nur ihre Markierung (dasselbe Tag zeigt jetzt aufs neue Abbild)
# und bleibt als "dangling" auf der Platte liegen. Der noch laufende
# Container hält sein Abbild weiter fest, das räumt Docker also nicht weg -
# ungenutzte Reste von zwei oder mehr Durchläufen zuvor aber schon. Ohne
# dieses Aufräumen füllt sich die Platte nach ein paar Updates von selbst,
# und dann schlägt nicht nur der nächste Bau fehl, sondern jedes Schreiben
# auf /config (Konfiguration speichern, Lautsprecher-Gruppen, Szenen …).
docker image prune -f >/dev/null
# Der zweite, grössere Fresser: BuildKits Bau-Zwischenspeicher. Bei einem
# --no-cache-Bau ist er nutzlos, wächst aber trotzdem um ~450 MB pro Lauf
# und wird von image prune nicht angefasst - auf docker01 war ER der
# Hauptteil der vollen Platte (4.8 GB). Auf 2 GB deckeln statt alles zu
# löschen, damit andere Projekte auf dem Host ihren jüngsten Cache
# behalten (ältere Docker-Fassungen kennen --keep-storage nicht - dann
# eben alles weg).
docker builder prune -f --keep-storage 2GB >/dev/null 2>&1 \
  || docker builder prune -f >/dev/null 2>&1 || true
echo "✓ Abbild '$IMAGE' ist aktuell, alte Schichten aufgeräumt."

if [ -n "${PORTAINER_WEBHOOK_URL:-}" ]; then
  # Der alte Container bleibt bewusst stehen: Den Tausch macht Portainer
  # beim Ausrollen selbst. Scheitert es dort (etwa am Re-pull eines lokal
  # gebauten Abbilds), läuft der alte Stand einfach weiter - ein
  # misslungenes Update ist dann ein Nicht-Ereignis, kein Ausfall.
  NEW_IMAGE_ID=$(docker image inspect "$IMAGE" -f '{{.Id}}')
  echo "→ Löse den Portainer-Webhook aus …"
  # Portainer stellt sein Zertifikat auf Port 9443 selbst aus. Prüfen lässt
  # es sich deshalb nicht - und ohne die folgende Zeile bricht curl mit
  # einem Zertifikatsfehler ab, mitten im sonst fertigen Update.
  #
  # Bewusst als eigene Variable und nicht fest eingebaut: Wer Portainer
  # hinter einem richtigen Zertifikat betreibt, soll die Prüfung behalten.
  # Vertretbar ist das Abschalten nur, weil der Aufruf im eigenen Netz
  # bleibt und nichts Geheimes überträgt - die Adresse selbst ist das
  # Geheimnis, und die kennt der Angreifer dann ohnehin schon.
  INSECURE=""
  if [ "${PORTAINER_INSECURE:-0}" = "1" ]; then
    INSECURE="--insecure"
  fi
  # Scheitert der Webhook, darf das Skript nicht einfach sterben - der
  # alte Container läuft ja weiter, und jemand muss erfahren, was fehlt.
  # curls Rückgabewert sagt ziemlich genau, woran es lag; das hier zu
  # übersetzen erspart die Suche im Netz.
  # shellcheck disable=SC2086
  if ! curl -fsS $INSECURE -X POST "$PORTAINER_WEBHOOK_URL"; then
    CURL_CODE=$?
    echo ""
    echo "✗ Der Portainer-Webhook hat nicht geantwortet (curl-Code $CURL_CODE)."
    echo "  Das neue Abbild ist gebaut, aber nicht ausgerollt - der Hub läuft"
    echo "  mit dem BISHERIGEN Stand weiter. Das Haus ist also nicht offline."
    case "$CURL_CODE" in
      60|35|51)
        echo "  Ursache: Zertifikatsfehler. Portainer stellt sein Zertifikat"
        echo "  auf 9443 selbst aus - in $CREDENTIALS_FILE gehört die Zeile:"
        echo "    PORTAINER_INSECURE=1"
        ;;
      7|28)
        echo "  Ursache: Portainer war nicht erreichbar. Läuft der Container?"
        echo "    docker ps --filter name=portainer"
        ;;
      22)
        echo "  Ursache: Portainer lehnt die Adresse ab (meist 404). Der"
        echo "  Webhook wurde vermutlich neu erzeugt - in Portainer unter"
        echo "  Stacks → homepilot → Webhook die Adresse ablesen und in"
        echo "  $CREDENTIALS_FILE als PORTAINER_WEBHOOK_URL eintragen."
        ;;
    esac
    echo "  Von Hand ausrollen: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
    exit 1
  fi

  # Der Webhook meldet nur «angenommen» - ob das Ausrollen gelingt,
  # entscheidet sich danach. Woran man den Erfolg erkennt: Der laufende
  # Container zeigt auf das frisch gebaute Abbild. Der Hub selbst kann
  # dabei kurz weg sein (der Tausch), deshalb zusätzlich auf /api/health
  # warten.
  echo "→ Warte auf den Wechsel …"
  for _ in $(seq 1 45); do
    sleep 2
    RUNNING_IMAGE_ID=$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "keiner")
    if [ "$RUNNING_IMAGE_ID" = "$NEW_IMAGE_ID" ] \
       && curl -fsS -m 3 "http://127.0.0.1:8123/api/health" >/dev/null 2>&1; then
      echo ""
      echo "✓ Fertig - der Hub läuft mit dem frischen Abbild."
      exit 0
    fi
  done
  echo ""
  if [ "$RUNNING_IMAGE_ID" = "keiner" ]; then
    echo "✗ Portainer hat den Container entfernt, aber keinen neuen"
    echo "  gestartet. Von Hand: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
  else
    echo "✗ Portainer hat den Container nicht gewechselt - der alte Stand"
    echo "  läuft weiter (das Haus ist also nicht offline). Meist scheitert"
    echo "  das Ausrollen am Re-pull des lokal gebauten Abbilds."
    echo "  Von Hand: Portainer → Stacks → homepilot →"
    echo "  Update the stack → Re-pull image AUS → Deploy."
  fi
  exit 1
else
  echo "  Jetzt in Portainer: Stacks → homepilot → Update the stack → Deploy."
  echo "  Der alte Container läuft bis dahin weiter."
fi
