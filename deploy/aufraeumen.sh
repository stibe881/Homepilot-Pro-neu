#!/usr/bin/env bash
# Wöchentliches Aufräumen auf dem Docker-Host.
#
# Was hier passiert, ist bewusst das Langweilige: verwaiste
# Abbild-Schichten, BuildKits Zwischenspeicher und ein zu grosses Journal.
# Alles drei wächst von selbst und wird von niemandem sonst kleiner.
#
# ── Was hier absichtlich NICHT passiert ────────────────────────────────
#
#   docker system prune -a --volumes
#
# Beides wäre auf diesem Rechner schädlich:
#
#   --volumes löscht Datenträger, an denen gerade kein *laufender*
#   Container hängt. Darunter fällt die Datenbank von Nginx Proxy Manager
#   - mit ihr alle Proxy-Einträge und Zertifikate.
#
#   -a löscht auch Abbilder, deren Container nur gerade gestoppt sind.
#   Bei einem selbst gebauten Abbild ohne Registry heisst das: neu bauen.
#
# Container-Protokolle fasst dieses Skript ebenfalls nicht an. Sie sind
# das Erste, was man nach einer Störung braucht, und der richtige Ort für
# die Lösung ist ein Deckel (siehe README.md), nicht ein Wegwerfen.
#
# ── Einrichtung ────────────────────────────────────────────────────────
#
#   sudo cp deploy/aufraeumen.sh /opt/homepilot/
#   sudo chmod +x /opt/homepilot/aufraeumen.sh
#   sudo cp deploy/homepilot-aufraeumen.* /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now homepilot-aufraeumen.timer
#
# Nachsehen:
#   systemctl list-timers homepilot-aufraeumen
#   journalctl -u homepilot-aufraeumen -n 40

set -euo pipefail

# Wieviel BuildKit-Zwischenspeicher stehen bleiben darf. Nicht alles
# löschen: Andere Projekte auf diesem Rechner bauen auch, und ihr
# jüngster Cache spart ihnen Minuten.
KEEP_CACHE="${HOMEPILOT_KEEP_CACHE:-2GB}"
# Obergrenze fürs Journal des Systems.
KEEP_JOURNAL="${HOMEPILOT_KEEP_JOURNAL:-200M}"

# Wo Docker seine Daten hält. Nicht fest verdrahten: Auf einer
# Snap-Installation liegt alles unter /var/snap/docker/common/…, und
# /var/lib/docker ist ein fast leerer Rest. Wer dort nachsieht, misst am
# eigentlichen Verbrauch vorbei - genau das ist mir passiert.
docker_root() {
  docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker
}

frei() { df --output=avail -k / | tail -1 | tr -d ' '; }

VORHER=$(frei)
echo "→ Aufräumen beginnt, frei: $(numfmt --to=iec --from-unit=1024 "$VORHER")"

# Nur verwaiste Schichten - ohne -a, siehe oben.
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --keep-storage "$KEEP_CACHE" >/dev/null 2>&1 \
  || docker builder prune -f >/dev/null 2>&1 || true
# Netze ohne Container. Harmlos und kostet nichts.
docker network prune -f >/dev/null 2>&1 || true

if command -v journalctl >/dev/null 2>&1; then
  journalctl --vacuum-size="$KEEP_JOURNAL" >/dev/null 2>&1 || true
fi

NACHHER=$(frei)
GEWONNEN=$((NACHHER - VORHER))
echo "→ Fertig, frei: $(numfmt --to=iec --from-unit=1024 "$NACHHER")"
if [ "$GEWONNEN" -gt 0 ]; then
  echo "  gewonnen: $(numfmt --to=iec --from-unit=1024 "$GEWONNEN")"
fi

# Was jetzt noch belegt ist - damit im Journal steht, wohin der Platz
# geht, falls es trotzdem eng wird.
docker system df 2>/dev/null | sed 's/^/  /' || true

# Und der Fresser, den dieses Skript bewusst stehen lässt: Wenn hier
# etwas auftaucht, fehlt der Deckel in der compose-Datei bzw. in der
# daemon.json. Melden statt löschen.
DOCKER_ROOT="$(docker_root)"
if [ -d "$DOCKER_ROOT/containers" ]; then
  BIG=$(find "$DOCKER_ROOT/containers" -name '*-json.log' -size +100M 2>/dev/null || true)
  if [ -n "$BIG" ]; then
    echo "⚠ Container-Protokolle über 100 MB - Deckel fehlt (siehe README.md):"
    # shellcheck disable=SC2086
    du -h $BIG 2>/dev/null | sed 's/^/  /'
  fi
fi
