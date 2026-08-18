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

# Der alte Container läuft absichtlich weiter, während gebaut wird: Das
# neue Abbild entsteht daneben, unter demselben Namen. Erst ganz am Ende,
# unmittelbar vor dem Neuausrollen, wird gewechselt - so ist der Hub
# Sekunden weg statt Minuten. Und geht der Bau schief, läuft der alte
# Stand einfach weiter, statt dass das Haus ohne Steuerung dasteht.

echo "→ Hole den neuesten Code von ${REPO}@${BRANCH} …"
rm -rf "$WORKDIR"
git clone --depth 1 -b "$BRANCH" \
  "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORKDIR"

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

echo ""
echo "✓ Abbild '$IMAGE' ist aktuell."

if [ -n "${PORTAINER_WEBHOOK_URL:-}" ]; then
  # Jetzt erst den alten Container weichen lassen - das neue Abbild steht
  # schon bereit, die Lücke ist so kurz wie möglich.
  echo "→ Entferne den alten Container …"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
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
  if curl -fsS $INSECURE -X POST "$PORTAINER_WEBHOOK_URL"; then
    echo ""
    echo "✓ Fertig – der Stack rollt gerade mit dem frischen Abbild neu aus."
  else
    echo ""
    echo "✗ Der Portainer-Webhook hat nicht geantwortet. Das Abbild ist"
    echo "  gebaut, aber der Container läuft nicht - jetzt von Hand:"
    echo "  Portainer → Stacks → homepilot → Update the stack → Deploy."
    exit 1
  fi
else
  echo "  Jetzt in Portainer: Stacks → homepilot → Update the stack → Deploy."
  echo "  Der alte Container läuft bis dahin weiter."
fi
