#!/usr/bin/env bash
# Den OTA-Kanal ausmisten – Punkt 13 der Werkbank-Liste.
#
# Auf dem EAS-Kanal «production» sammeln sich mit der Zeit Fassungen an.
# Gefährlich sind die, deren runtimeVersion NICHT mehr zur aktuellen
# App-Version passt: Sie können nur noch von alten Builds geladen werden
# und zeigen dort alten Code – das sieht dann aus, als wäre der neue Bau
# schuld (siehe Punkt 12).
#
# Dieses Skript ÄNDERT NICHTS. Es zeigt, was auf dem Kanal liegt, gruppiert
# nach runtimeVersion, markiert die fremden – und druckt die Befehle zum
# Löschen, die man dann bewusst selbst ausführt. Ein Skript, das ungefragt
# Fassungen löscht, wäre bei einem OTA-Kanal die falsche Sorte Hilfe.
#
# Voraussetzungen: eas-cli (npx reicht), EXPO_TOKEN in der Umgebung oder
# eine interaktive Anmeldung. Laufen lassen aus app/:
#
#   cd app && bash ../deploy/ota-aufraeumen.sh
set -euo pipefail

if [ ! -f app.json ]; then
  echo "Bitte aus dem Ordner app/ starten (dort liegt app.json)." >&2
  exit 1
fi

AKTUELL=$(python3 -c "import json; print(json.load(open('app.json'))['expo']['version'])")
echo "Aktuelle App-Version (= runtimeVersion neuer Builds): $AKTUELL"
echo
echo "Fassungen auf dem Kanal «production»:"
echo "───────────────────────────────────────"

# --json für maschinenlesbare Ausgabe; --non-interactive verhindert Rückfragen.
npx eas-cli@latest update:list --branch production --limit 50 --json --non-interactive \
  | python3 -c "
import json, sys

AKTUELL = '$AKTUELL'
daten = json.load(sys.stdin)
zeilen = daten.get('currentPage') or daten if isinstance(daten, list) else daten.get('updates', [])
if isinstance(daten, dict) and 'currentPage' in daten:
    zeilen = daten['currentPage']

gruppen = {}
for eintrag in zeilen:
    laufzeit = str(eintrag.get('runtimeVersion') or '?')
    gruppen.setdefault(laufzeit, []).append(eintrag)

loeschbar = []
for laufzeit in sorted(gruppen):
    passt = laufzeit == AKTUELL
    marke = 'passt zum aktuellen Build' if passt else 'NUR für alte Builds – kann weg'
    print(f'runtimeVersion {laufzeit} · {len(gruppen[laufzeit])} Fassung(en) · {marke}')
    for eintrag in gruppen[laufzeit]:
        gruppe = eintrag.get('group') or eintrag.get('id') or '?'
        nachricht = (eintrag.get('message') or '')[:60]
        print(f'  {gruppe}  {nachricht}')
        if not passt:
            loeschbar.append(gruppe)

print()
if loeschbar:
    print('Zum Aufräumen – jede Zeile bewusst selbst ausführen:')
    for gruppe in loeschbar:
        print(f'  npx eas-cli@latest update:delete {gruppe} --non-interactive')
else:
    print('Nichts aufzuräumen: Alles auf dem Kanal passt zum aktuellen Build.')
"
