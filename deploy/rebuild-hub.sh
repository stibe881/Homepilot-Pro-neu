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
  # Container ist schon weg, und jemand muss erfahren, wie es weitergeht.
  # shellcheck disable=SC2086
  if ! curl -fsS $INSECURE -X POST "$PORTAINER_WEBHOOK_URL"; then
    echo ""
    echo "✗ Der Portainer-Webhook hat nicht geantwortet. Das Abbild ist"
    echo "  gebaut, aber der Container läuft nicht - jetzt von Hand:"
    echo "  Portainer → Stacks → homepilot → Update the stack → Deploy."
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
