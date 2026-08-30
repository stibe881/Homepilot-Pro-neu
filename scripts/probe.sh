#!/usr/bin/env bash
#
# Die Browser-Probe in einem Aufruf.
#
# Startet einen Demo-Hub auf einem eigenen Port, liefert die Web-Fassung
# aus, misst mit einem echten Browser und räumt danach alles wieder weg.
# Das Haus wird dabei nicht angefasst: eigener Port, eigene Datendatei,
# nur die Demo-Integration.
#
# Warum als Skript und nicht als Anleitung: Es stand eine Seite lang in
# der CLAUDE.md, und jede Sitzung baute es von Hand nach - samt einer
# Wegwerf-Integration, die danach wieder gelöscht wurde. Ein Werkzeug,
# das man vor jedem Gebrauch zusammenbaut, benutzt man zu selten.
#
#   scripts/probe.sh              # bauen, messen, aufräumen
#   scripts/probe.sh --ohne-bau   # den letzten Web-Bau wiederverwenden
#
# Einmalig vorher:  npm --prefix scripts install && npm --prefix scripts run browser

set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARBEIT="${PROBE_ARBEIT:-/tmp/homepilot-probe}"
HUB_PORT="${PROBE_HUB_PORT:-8199}"
WEB_PORT="${PROBE_WEB_PORT:-8188}"
TOKEN="${PROBE_TOKEN:-probe-token}"

OHNE_BAU=0
[ "${1:-}" = "--ohne-bau" ] && OHNE_BAU=1

mkdir -p "$ARBEIT"
HUB_PID=""
WEB_PID=""

aufraeumen() {
  [ -n "$HUB_PID" ] && kill "$HUB_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
}
trap aufraeumen EXIT

# ── Demo-Hub ──────────────────────────────────────────────────────────
#
# Die Demo-Integration bringt alles mit, was die Probe braucht: Licht,
# Bewegung, Storen, eine Musikbox und einen Fernseher mit Steuerkreuz.
# Früher legte jede Sitzung dafür eine eigene Wegwerf-Integration an.
# Der Gremlin liefert dazu den zappeligen Fernseher: einen, der nach
# jedem Tastendruck seinen Zustand neu meldet, wie ein echter Android TV.
# Am zahmen Demo-Fernseher wäre die Messung «bleibt das Blatt stehen?»
# wertlos - dort bleibt es immer stehen.
cat > "$ARBEIT/config.yaml" <<YAML
api: { host: 127.0.0.1, port: $HUB_PORT, token: $TOKEN }
integrations:
  - { integration: demo }
  - { integration: gremlin, pace: 3600, seed: 7 }
rooms:
  Wohnzimmer:
    [demo.light_livingroom, demo.tv_livingroom, demo.cover_livingroom, gremlin.tv_zappelig]
  Flur: [demo.motion_hall]
automations: []
YAML

# Frische Datendatei: Ein Rest von gestern bringt Benutzer und Sitzungen
# mit, und dann misst man an einem Zustand, den niemand kennt.
rm -f "$ARBEIT/homepilot-data.json"

echo "→ Demo-Hub auf Port $HUB_PORT …"
(
  cd "$WURZEL/hub" &&
    HOMEPILOT_DATA="$ARBEIT/homepilot-data.json" \
      python3 -m homepilot --config "$ARBEIT/config.yaml" > "$ARBEIT/hub.log" 2>&1
) &
HUB_PID=$!

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$HUB_PORT/api/health"; then break; fi
  sleep 1
done
if ! curl -sf -o /dev/null "http://127.0.0.1:$HUB_PORT/api/health"; then
  echo "✗ Der Demo-Hub kam nicht hoch. Log: $ARBEIT/hub.log"
  exit 1
fi

# ── Web-Fassung ───────────────────────────────────────────────────────
if [ "$OHNE_BAU" = "0" ] || [ ! -d "$ARBEIT/web" ]; then
  echo "→ Web-Fassung bauen …"
  (cd "$WURZEL/app" && npx expo export --platform web --output-dir "$ARBEIT/web" > "$ARBEIT/bau.log" 2>&1) ||
    { echo "✗ Der Web-Bau ging nicht durch. Log: $ARBEIT/bau.log"; exit 1; }
fi

echo "→ Web-Fassung ausliefern auf Port $WEB_PORT …"
(cd "$ARBEIT/web" && python3 -m http.server "$WEB_PORT" > "$ARBEIT/web.log" 2>&1) &
WEB_PID=$!
sleep 2

# ── Messen ────────────────────────────────────────────────────────────
PROBE_WEB="http://127.0.0.1:$WEB_PORT" \
  PROBE_HUB="http://127.0.0.1:$HUB_PORT" \
  PROBE_TOKEN="$TOKEN" \
  node "$WURZEL/scripts/probe.mjs"
