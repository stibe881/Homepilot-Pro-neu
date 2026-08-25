# Arbeiten an HomePilot Pro

Diese Datei ist für jeden da, der hier Code ändert – Mensch oder Assistent.
Sie hält fest, was man sonst aus fünfzigtausend Zeilen erschliessen müsste.

Sie ist entstanden, nachdem zwei Sitzungen an einem Abend unabhängig
dieselben drei Dinge gebaut hatten. Das Zusammenführen kostete mehr als
jede einzelne Änderung.

## Was das hier ist

Ein selbstgebautes Zuhause-System für einen Haushalt in Zell LU. Zwei
Teile:

- **`hub/`** – Python 3.11, FastAPI. Spricht mit den Geräten (Homematic,
  Hue, Matter, MQTT, Tuya …), führt Abläufe aus, hält den Zustand. Läuft
  durchgehend auf einem Rechner im Haus.
- **`app/`** – React Native mit Expo. iPhone, iPad und Browser aus
  derselben Quelle. Redet mit dem Hub über HTTP und einen WebSocket.

Der Hub ist die Wahrheit; die App zeigt sie an und schickt Befehle.

## Bevor du anfängst

**Auf welchem Zweig?** Der Update-Knopf in der App baut, was in
`deploy/rebuild-hub.sh` unter `BRANCH` steht (überschreibbar mit
`HOMEPILOT_BRANCH`). Wer anderswo arbeitet, kann noch so oft bauen – im
Haus kommt nichts an. Das ist genau der Fehler, der zu dieser Datei
geführt hat.

**Schau nach, ob es das schon gibt.** Vor jeder neuen Funktion einmal
`git log --oneline -30` und ein `grep` nach dem Begriff. Das Repo ist
gross und gut kommentiert; die meisten Fragen sind irgendwo schon
beantwortet.

## Prüfen

Alles läuft ohne Netz und in unter einer Minute:

```bash
# Hub
cd hub && pip install -e ".[dev]"
pytest -q            # ~620 Tests
ruff check .         # muss sauber sein
mypy homepilot       # noch nicht bindend, aber lies, was es sagt

# App
cd app && npm ci
npx tsc --noEmit     # muss sauber sein
npx eslint .         # 0 Fehler; Warnungen dürfen nicht mehr werden
npx expo export --platform web --output-dir /tmp/webbau
```

Dieselben Schritte laufen in `.github/workflows/pruefung.yml`.

Der Web-Bau ist die einzige Prüfung, die den ganzen Baum durchzieht: Ein
kaputter Import in einer selten benutzten Datei fällt weder `tsc` noch
ESLint auf, dem Bündler aber sofort.

## Die App im Browser ansehen, ohne das Haus anzufassen

Für Layout-Fragen («sieht das auf dem iPad richtig aus?») braucht es
keinen echten Hub. Ein Demo-Hub, die Web-Fassung und ein Browser genügen –
und man kann dabei messen statt schauen:

```bash
# 1. Hub mit der Demo-Integration, auf einem eigenen Port
cat > /tmp/probe.yaml <<'YAML'
api: { host: 127.0.0.1, port: 8199, token: probe-token }
integrations: [{ integration: demo }]
rooms: { Wohnzimmer: [demo.light_livingroom], Flur: [demo.motion_hall] }
automations: []
YAML
cd hub && python -m homepilot --config /tmp/probe.yaml &

# 2. Web-Fassung bauen und ausliefern
cd app && npx expo export --platform web --output-dir /tmp/web
cd /tmp/web && python3 -m http.server 8188 &
```

Im Browser `http://127.0.0.1:8188` öffnen, das Fenster auf iPad-Grösse
stellen (1180 × 820 für ein 11-Zoll quer) und die Zugangsdaten setzen:

```js
localStorage.setItem('homepilot.settings', JSON.stringify({
  url: 'http://127.0.0.1:8199', token: 'probe-token', theme: 'dark',
}));
```

Ob etwas seitlich hinausragt, sagt die Konsole verlässlicher als das Auge:

```js
document.documentElement.scrollWidth > window.innerWidth   // seitlicher Überlauf?
[...document.querySelectorAll('div')]
  .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
```

So ist die leere 340-Punkte-Spalte auf der Startseite aufgefallen: Die
rechte Spalte beanspruchte ihre Breite auch dann, wenn weder Wetter noch
Musik noch eine Warnung darin lagen.

Was der Browser **nicht** beantwortet: alles, was nur nativ passiert –
Tastatur, Haptik, Widgets, Sicherheitsabstände. Dafür führt kein Weg am
Gerät vorbei.

## Wie hier geschrieben wird

Der bestehende Code ist der Massstab – lies eine Nachbardatei, bevor du
eine neue anlegst.

**Kommentare auf Deutsch, und sie sagen *warum*.** Nicht was der Code
tut, das steht schon da. Warum er so und nicht anders aussieht, welcher
Fall dahintersteckt, was jemand vorher falsch gemacht hat. Beispiel aus
`core/automation.py`:

```python
# Wandtaster melden bei jedem Druck denselben Wert – «kurz gedrückt» bleibt
# «kurz gedrückt». Damit der zweite Druck nicht als «nichts geändert»
# durchfällt, tragen solche Entitäten den Zeitpunkt des Drucks mit.
```

**Bezeichner auf Englisch, Text auf Deutsch.** Funktionen und Variablen
heissen `switch_channel`, nicht `schaltKanal`. Was der Benutzer liest, ist
Deutsch – Schweizer Deutsch, also «ss» statt «ß».

**Reine Funktionen herauslösen und `(rein, testbar)` in den Docstring.**
Wo Logik entscheidbar ist – welcher Gang, welcher Kanal, welcher
Vorschlag – gehört sie in eine Funktion ohne Seiteneffekte. Im Hub steht
sie in `core/`, in der App möglichst in `src/lib/`.

**Jede Verhaltensänderung bekommt einen Test.** Der Test beschreibt den
Fall in seinem Namen: `test_motion_light_stays_on_while_there_is_movement`,
nicht `test_mode_2`.

## Wo was liegt

| Wenn du … | dann in |
| --- | --- |
| ein neues Gerät anbinden willst | `hub/homepilot/integrations/` – Anleitung in `hub/docs/neue-integration.md` |
| an Abläufen arbeitest | `hub/homepilot/core/automation.py` + `app/src/screens/AutomationsScreen.tsx` |
| eine Route brauchst | `hub/homepilot/api/server.py` |
| etwas dauerhaft speichern willst | `hub.data` (`core/persistence.py`) – **nie** Geheimnisse ins Repo |
| an der Startseite arbeitest | `app/src/screens/DashboardScreen.tsx`, `components/TopStrip.tsx`, `SidePanel.tsx` |
| eine Gerätekachel änderst | `app/src/components/EntityCard.tsx` |

## Was nie ins Repository gehört

`hub/homepilot-data.json` enthält im Betrieb Benutzer **samt Tokens**,
Sitzungen und das Zugriffsprotokoll. Ebenso die Token-Dateien der
Integrationen (`*-token.json`), `hub/config.yaml`, `hub/secrets.env` und
`hub/matter/`. Alles steht in der `.gitignore` – prüf vor einem
`git add -A` trotzdem mit `git status`, was du wirklich mitnimmst.

## Ausliefern

Über den Update-Knopf in der App (System → Update). Er ruft
`deploy/rebuild-hub.sh` auf, das frisch klont, den Hub baut, die
Web-Fassung erzeugt und auf Wunsch den iOS-Build bei EAS anstösst.

Zwei Dinge, die dabei überraschen:

- Das Skript **frischt sich selbst auf** – Änderungen daran greifen erst
  beim übernächsten Lauf.
- Die App-Version in `app/app.json` (derzeit `0.8.2`) bestimmt die
  `runtimeVersion`. Solange sie sich nicht ändert, passt jede je
  veröffentlichte OTA-Fassung auf jeden neuen Build. **Bei einer
  Auslieferung die Version hochzählen.**
- Damit das auch ankommt, steht in `app/eas.json` `appVersionSource` auf
  `local`. Vorher stand dort `remote`: Dann führt EAS die Version auf
  seinem Server und ignoriert die `app.json` – die dortige `0.7.0` ging
  ins Leere, gebaut wurde weiter `0.1.0`. TestFlight bot das nie an, weil
  eine kleinere Version kein Update ist, und meldete auch nichts: Der
  Build lag einfach unbeachtet da. `local` heisst: Es gilt, was im Repo
  steht.
- `autoIncrement` ist **aus**, und das mit Absicht. Es zählte die
  `buildNumber` in der `app.json` hoch – also in einer Datei, die hier
  aus einem frischen Klon stammt und nach dem Lauf weggeworfen wird. Die
  Erhöhung überlebte den Lauf nie: Jeder Build war wieder Nummer 2, und
  Apple wies ihn ab («The bundle version must be higher than the
  previously uploaded version: 2»).
- Stattdessen setzt `rebuild-hub.sh` die Nummer selbst, aus der **Anzahl
  Commits** (`git rev-list --count HEAD`) – monoton steigend, ohne dass
  sich jemand etwas merken muss, und aus dem Repo ablesbar statt in ihm
  gespeichert. Von Hand geht dasselbe mit
  `node scripts/set-build-number.mjs [zahl]` im Ordner `app/`;
  `npm run release:ios` ruft es von sich aus auf.
- Die `buildNumber` in der `app.json` ist damit nur noch ein Startwert.
  Sie mit einzuchecken ist nicht mehr nötig.

Unter *System* zeigt die App, welchen Stand sie ausführt und ob er
mitgeliefert oder nachgeladen ist.

## Was als Nächstes ansteht

Eine durchnummerierte Liste offener Verbesserungen liegt als
Werkbank-Seite vor (100 Punkte, aus dem Code gelesen). Punkte, auf die im
Code verwiesen wird, tragen dort dieselbe Nummer.
