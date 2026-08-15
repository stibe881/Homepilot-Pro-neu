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
# Ist die Variable gesetzt, ruft dieses Skript sie am Ende automatisch auf.

set -euo pipefail

BRANCH="${HOMEPILOT_BRANCH:-claude/custom-home-automation-t9lvq3}"
REPO="stibe881/Homepilot-Pro-neu"
WORKDIR="/tmp/homepilot-build"
CREDENTIALS_FILE="/opt/homepilot/github-credentials.env"
CONTAINER="homepilot-hub"
IMAGE="homepilot-hub"

if [ -f "$CREDENTIALS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CREDENTIALS_FILE"
fi
: "${GITHUB_USER:?GITHUB_USER fehlt – siehe Kopf dieses Skripts}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN fehlt – siehe Kopf dieses Skripts}"

echo "→ Stoppe und entferne den laufenden Container (falls vorhanden) …"
docker stop "$CONTAINER" >/dev/null 2>&1 || true
docker rm "$CONTAINER" >/dev/null 2>&1 || true

echo "→ Entferne das alte Abbild (falls vorhanden) …"
docker image rm "$IMAGE" >/dev/null 2>&1 || true

echo "→ Hole den neuesten Code von ${REPO}@${BRANCH} …"
rm -rf "$WORKDIR"
git clone --depth 1 -b "$BRANCH" \
  "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORKDIR"

echo "→ Baue das Abbild neu (ohne Cache) …"
docker build --no-cache -t "$IMAGE" "$WORKDIR/hub"

rm -rf "$WORKDIR"

echo ""
echo "✓ Abbild '$IMAGE' ist aktuell."

if [ -n "${PORTAINER_WEBHOOK_URL:-}" ]; then
  echo "→ Löse den Portainer-Webhook aus …"
  curl -fsS -X POST "$PORTAINER_WEBHOOK_URL"
  echo ""
  echo "✓ Fertig – der Stack rollt gerade mit dem frischen Abbild neu aus."
else
  echo "  Jetzt in Portainer: Stacks → homepilot → Update the stack → Deploy."
fi
