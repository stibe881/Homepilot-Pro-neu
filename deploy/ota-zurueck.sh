#!/usr/bin/env bash
# Die nachgeladene App-Fassung zurücknehmen – Punkt 231 der Werkbank.
#
# Der Hub kann zurück: rebuild-hub.sh hebt das alte Abbild als :prev auf
# und fällt bei misslungenem Start selbst darauf zurück. Die per EAS
# Update nachgeladene App-Fassung konnte das bisher nicht – eine
# misslungene Fassung blieb auf dem Kanal «production», bis jemand einen
# neuen Stand veröffentlichte. Dieses Skript veröffentlicht die
# VORLETZTE Fassung desselben Kanals erneut (eas update:republish). Für
# die Telefone ist das eine gewöhnliche neue Fassung: Sie holen sie beim
# nächsten Öffnen der App und wenden sie beim übernächsten Start an.
#
#   cd app && bash ../deploy/ota-zurueck.sh --zeigen   # nur sagen, was es täte
#   cd app && bash ../deploy/ota-zurueck.sh            # wirklich zurück
#
# Voraussetzungen wie bei ota-aufraeumen.sh: eas-cli (npx reicht),
# EXPO_TOKEN in der Umgebung oder eine interaktive Anmeldung; laufen
# lassen aus app/ (dort liegt app.json).
#
# Woher die Kennungen kommen: Massgeblich ist «eas update:list» – was
# EAS über den Kanal weiss, ist die Wahrheit, und geraten wird nicht.
# Die Datei, in die rebuild-hub.sh nach jedem Veröffentlichen die
# Gruppen-Kennung schreibt (/opt/homepilot/ota-verlauf.log,
# überschreibbar mit OTA_VERLAUF), dient als Gegenprobe: Steht dort
# zuoberst eine andere Gruppe, als EAS als neueste kennt, hat jemand am
# Update-Knopf vorbei veröffentlicht – das gehört gemeldet, bevor man
# blind zurückgeht.
#
# Und wohlgemerkt: Der Kanal kennt nur «vorletzte», nicht «gut». Ein
# ZWEITER Aufruf direkt nach dem ersten ginge wieder vorwärts auf genau
# die Fassung, die eben zurückgenommen wurde – das Skript sagt das am
# Ende noch einmal dazu.
set -euo pipefail

ZEIGEN=0
for ARG in "$@"; do
  case "$ARG" in
    --zeigen) ZEIGEN=1 ;;
    *)
      echo "Unbekannte Option: $ARG (erlaubt: --zeigen)" >&2
      exit 2
      ;;
  esac
done

if [ ! -f app.json ]; then
  echo "Bitte aus dem Ordner app/ starten (dort liegt app.json)." >&2
  exit 1
fi

# Die runtimeVersion, nicht die version: Nur sie entscheidet, welche
# Builds eine Fassung überhaupt annehmen (CLAUDE.md, «Ausliefern»).
# Eine Fassung mit fremder Laufzeit erneut zu veröffentlichen, erreichte
# kein einziges aktuelles Telefon – sähe aber nach einem gelungenen
# Rückzug aus.
LAUFZEIT=$(python3 -c "import json; print(json.load(open('app.json'))['expo'].get('runtimeVersion', '?'))")
KANAL="production"
export OTA_VERLAUF="${OTA_VERLAUF:-/opt/homepilot/ota-verlauf.log}"
export OTA_LAUFZEIT="$LAUFZEIT"

echo "Kanal «$KANAL», Laufzeit $LAUFZEIT – frage EAS nach den letzten Fassungen …"

# --json für maschinenlesbare Ausgabe; --non-interactive verhindert
# Rückfragen. Limit 50 wie in ota-aufraeumen.sh: genug Geschichte, um
# auch nach einem Schwung fremder Laufzeiten noch zwei passende Gruppen
# zu finden.
PLAN=$(npx eas-cli@latest update:list --branch "$KANAL" --limit 50 --json --non-interactive \
  | python3 -c "
import json, os, sys

laufzeit = os.environ['OTA_LAUFZEIT']
daten = json.load(sys.stdin)
# Dieselbe nachsichtige Form wie in ota-aufraeumen.sh: Je nach
# eas-cli-Fassung heisst die Seite currentPage, updates - oder die
# Antwort ist selbst schon die Liste.
zeilen = daten if isinstance(daten, list) else (daten.get('currentPage') or daten.get('updates') or [])

# update:list liefert je Plattform eine Zeile; iOS und Android derselben
# Veröffentlichung teilen sich die Gruppen-Kennung. Hier zählt die
# Gruppe, und die Reihenfolge (neueste zuerst) bleibt erhalten.
gruppen, gesehen = [], set()
for eintrag in zeilen:
    kennung = eintrag.get('group') or eintrag.get('id') or ''
    if not kennung or kennung in gesehen:
        continue
    gesehen.add(kennung)
    gruppen.append({
        'gruppe': kennung,
        'laufzeit': str(eintrag.get('runtimeVersion') or '?'),
        'nachricht': (eintrag.get('message') or '')[:60],
        'datum': str(eintrag.get('createdAt') or '')[:19],
    })

passend = [g for g in gruppen if g['laufzeit'] == laufzeit]
if len(passend) < 2:
    print(f'Auf dem Kanal liegen nur {len(passend)} Fassung(en) mit Laufzeit {laufzeit} -')
    print('es gibt keine vorletzte, auf die sich zurückgehen liesse.')
    if gruppen and not passend:
        print('Was da ist, trägt andere Laufzeiten (alte Builds?):')
        for g in gruppen[:5]:
            print(f'  {g[\"gruppe\"]}  Laufzeit {g[\"laufzeit\"]}  {g[\"nachricht\"]}')
    sys.exit(3)

aktuell, zurueck = passend[0], passend[1]
print(f'Aktuell auf dem Kanal : {aktuell[\"gruppe\"]}')
print(f'                        {aktuell[\"datum\"]}  «{aktuell[\"nachricht\"]}»')
print(f'Zurück auf (vorletzte): {zurueck[\"gruppe\"]}')
print(f'                        {zurueck[\"datum\"]}  «{zurueck[\"nachricht\"]}»')

# Gegenprobe gegen das Gedächtnis von rebuild-hub.sh: Kennt es die
# neueste Gruppe nicht, kam die letzte Fassung nicht vom Update-Knopf.
verlauf = os.environ.get('OTA_VERLAUF', '')
try:
    zeilen_datei = open(verlauf, encoding='utf-8').read().split()
except OSError:
    zeilen_datei = []
if zeilen_datei and aktuell['gruppe'] not in zeilen_datei:
    print()
    print(f'⚠ Die neueste Gruppe steht nicht in {verlauf} -')
    print('  die letzte Veröffentlichung lief am Update-Knopf vorbei.')
    print('  Prüfen, ob die vorletzte oben wirklich die gewünschte ist.')

# Die Maschinen-Zeile für die Shell - bewusst zuletzt.
print('ZURUECK=' + zurueck['gruppe'])
") || { echo "✗ «eas update:list» ist fehlgeschlagen oder fand keine vorletzte Fassung."; echo "$PLAN" | sed '/^ZURUECK=/d'; exit 1; }

echo "$PLAN" | sed '/^ZURUECK=/d'
ZURUECK=$(echo "$PLAN" | sed -n 's/^ZURUECK=//p')
if [ -z "$ZURUECK" ]; then
  echo "✗ Keine Gruppen-Kennung gefunden - nichts veröffentlicht." >&2
  exit 1
fi

echo
if [ "$ZEIGEN" = "1" ]; then
  echo "Trockenlauf (--zeigen) - es würde laufen:"
  echo "  npx eas-cli@latest update:republish --group $ZURUECK --non-interactive"
  exit 0
fi

echo "→ Veröffentliche die vorletzte Fassung erneut …"
# republish legt eine NEUE Gruppe mit dem alten Inhalt an - der Kanal
# geht also vorwärts auf einen alten Stand, nichts wird gelöscht. Die
# missratene Fassung bleibt liegen (und lässt sich mit
# deploy/ota-aufraeumen.sh ansehen).
REPUBLISH_LOG=$(mktemp)
if npx eas-cli@latest update:republish --group "$ZURUECK" --non-interactive 2>&1 \
    | tee "$REPUBLISH_LOG"
  [ "${PIPESTATUS[0]}" = "0" ]; then
  echo
  echo "✓ Zurückgenommen: Die Telefone holen die vorige Fassung beim"
  echo "  nächsten Öffnen der App und wenden sie beim übernächsten Start an."
  echo "  Achtung: Ein erneuter Aufruf dieses Skripts ginge jetzt wieder"
  echo "  VORWÄRTS auf die eben zurückgenommene Fassung."
  # Auch der Rückzug wandert ins Gedächtnis - die Gegenprobe oben soll
  # ihn beim nächsten Mal wiedererkennen. Nur wo die Datei schreibbar
  # ist (auf dem Hub-Host); anderswo ist das kein Fehler.
  NEUE_GRUPPE=$(grep -ioE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$REPUBLISH_LOG" | tail -1 || true)
  if [ -n "$NEUE_GRUPPE" ] && { [ -w "$OTA_VERLAUF" ] || { [ ! -e "$OTA_VERLAUF" ] && [ -w "$(dirname "$OTA_VERLAUF")" ]; }; }; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $NEUE_GRUPPE runtime=$LAUFZEIT branch=$KANAL zurueck-von=$ZURUECK" >> "$OTA_VERLAUF"
  fi
else
  echo
  echo "✗ «eas update:republish» ist fehlgeschlagen - auf dem Kanal hat sich"
  echo "  nichts geändert. Die entscheidenden Zeilen:"
  grep -iE "error|failed|cannot|missing|denied|invalid|not found" "$REPUBLISH_LOG" \
    | tail -3 | sed 's/^/  /'
  rm -f "$REPUBLISH_LOG"
  exit 1
fi
rm -f "$REPUBLISH_LOG"
