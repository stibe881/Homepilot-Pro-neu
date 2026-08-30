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

**Auf welchem Zweig?** `main` – der ist der Stand, der im Haus läuft.
Der Update-Knopf in der App baut, was in `deploy/rebuild-hub.sh` unter
`BRANCH` steht (überschreibbar mit `HOMEPILOT_BRANCH`), und dort steht
`main`. Wer anderswo arbeitet, kann noch so oft bauen – im Haus kommt
nichts an. Das ist genau der Fehler, der zu dieser Datei geführt hat.

Arbeiten darf man trotzdem, wo man will: Der Bau nimmt alle übrigen
Zweige des Repos zusätzlich herein (nur lokal, `HOMEPILOT_MERGE_ALL`).
Das ist ein Netz, kein Ersatz – was auf `main` liegt, ist gebaut; alles
andere hängt daran, dass es sich konfliktfrei hineinnehmen lässt.

Wer auf mehreren Zweigen gleichzeitig arbeitet, fragt nicht von Auge,
sondern:

```bash
python3 deploy/zweige.py pruefen    # nur nachsehen
python3 deploy/zweige.py stossen    # zusammenführen und pushen
```

Der teure Fehler ist nicht der abgelehnte Push – den sieht man. Teuer
ist der Zweig, der still zurückfällt: eingecheckt, geprüft, grün, nur
eben nicht dort, wo gebaut wird. Von aussen sieht das aus wie
erledigt.

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
| eine Push-Nachricht anlegst | `hub/homepilot/core/pushziel.py` – jede Kategorie braucht ein Ziel, ein Test hält das fest |
| eine Einstellung der Oberfläche anlegst | `app/src/hooks/usePrefs.ts` (ganze Bildschirme) oder `app/src/lib/persoenlich.ts` (einzelne Schlüssel tief in einer Kachel) – **nie** in den Speicher der App: Übersicht in `docs/einstellungen.md` |
| an der Startseite arbeitest | `app/src/screens/DashboardScreen.tsx`, `components/TopStrip.tsx`, `SidePanel.tsx` – die Vollbilder (Klingel, Kamera, Erinnerung) und die Stiltafel liegen in `screens/dashboard/` |
| einen Punkt in den Einstellungen anlegst | die Liste in `app/src/screens/DashboardScreen.tsx` **und** eine Gruppe in `app/src/lib/einstellungsgruppen.ts` – sonst steht er auf dem Telefon unter «Weitere» |
| an der Familienseite arbeitest | `app/src/screens/FamilyScreen.tsx` – Zwischenspeicher und Warteschlange in `screens/family/ablage.ts`, der Babysitter-Abend in `screens/family/babysitter.ts` |
| eine Gerätekachel änderst | `app/src/components/EntityCard.tsx` |
| an den Raumkacheln arbeitest | `app/src/components/RoomCard.tsx` + `lib/raumkarte.ts`; die Fotos liegen im Hub unter `core/raumbilder.py` und `api/routes/raeume.py` |
| Zigbee-Geräte anbindest | `hub/homepilot/integrations/zigbee2mqtt.py` – Übersicht in `docs/zigbee.md` |
| am Gäste-WLAN arbeitest | `hub/homepilot/core/wlanschein.py` + `api/routes/haus.py` + `app/src/lib/wlanaufkleber.ts` – Übersicht in `docs/gaeste-wlan.md` |
| an der Musik arbeitest | `hub/homepilot/core/ton.py` + `core/musik.py` + `app/src/components/Musikzentrale.tsx` – Übersicht in `docs/musik.md` |

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
- **`version` und `runtimeVersion` sind entkoppelt – und das ist der
  wichtigste Punkt hier.** Früher stand in `app/app.json`
  `runtimeVersion: {policy: appVersion}`: Die Laufzeit war die
  App-Version. Zusammen mit der Regel «bei jeder Auslieferung die
  Version hochzählen» hiess das, dass **jede** Auslieferung den
  OTA-Kanal kappte – eine nachgeladene Fassung erreicht nur Builds mit
  *derselben* `runtimeVersion`. Die Telefone blieben also nach jeder
  Lieferung stehen, bis jemand einen TestFlight-Build installierte, und
  die hochgezählte Versionsnummer täuschte dabei Aktualität vor. So
  gingen mehrere Lieferungen am Haus vorbei, ohne dass es auffiel: Der
  Hub war neu, die App nicht.
- Deshalb steht dort jetzt eine feste `runtimeVersion` (zurzeit `"3"`).
  Sie gehört zur **nativen** Hülle, nicht zur Auslieferung:
  - **`version` bei jeder Auslieferung hochzählen** – wie bisher. Sie
    ist die Nummer, die im App Store und in TestFlight steht, und sie
    beeinflusst OTA nicht mehr.
  - **`runtimeVersion` nur hochzählen, wenn sich nativ etwas ändert** –
    ein neues Expo-Modul, eine neue Berechtigung, ein neues
    Zweitsymbol. Und dann gehört ein TestFlight-Build dazu, sonst
    erreicht die neue OTA-Fassung niemanden.
  - Von `"2"` auf `"3"` ging es, als `expo-quick-actions` und
    `expo-audio` (Mikrofon für gesprochene Durchsagen) dazukamen. Wer
    ein natives Modul hinzufügt, ohne die Nummer zu erhöhen, liefert
    OTA eine Fassung aus, deren Modul in der Hülle auf dem Telefon gar
    nicht steckt – das fällt erst auf, wenn jemand die Stelle antippt.
    Zwei native Module in einer Runde kosten dagegen nur *einen*
    TestFlight-Build; wer ohnehin einen braucht, nimmt anderes gleich
    mit.
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
- Stattdessen setzt `rebuild-hub.sh` die Nummer selbst, aus den
  **Minuten seit 1970**. Zuerst war es die Anzahl Commits – aber aus dem
  flachen Klon des Skripts (`--depth 50`) ist die keine feste Grösse:
  Wie viele Commits die 50 Schritte erreichen, hängt von der
  Verzweigungs-Topologie ab, und so folgte auf Build 928 ein Build 168,
  den TestFlight nie anbot, weil eine kleinere Nummer kein Update ist.
  Die Uhr kann nur vorwärts und bleibt noch Jahrzehnte unter Apples
  Obergrenze (2^31). Von Hand geht dasselbe mit
  `node scripts/set-build-number.mjs [zahl]` im Ordner `app/`;
  `npm run release:ios` ruft es von sich aus auf.
- Die `buildNumber` in der `app.json` ist damit nur noch ein Startwert.
  Sie mit einzuchecken ist nicht mehr nötig.

Unter *System* zeigt die App, welchen Stand sie ausführt und ob er
mitgeliefert oder nachgeladen ist.

## Was als Nächstes ansteht

Die durchnummerierte Werkbank-Liste steht in `docs/werkbank.md`
(221 Punkte, aus dem Code gelesen). Ein Kommentar «Punkt NNN der
Werkbank» im Code meint genau diese Nummer – deshalb wird dort nie
umnummeriert; Neues bekommt die nächste freie Nummer.
