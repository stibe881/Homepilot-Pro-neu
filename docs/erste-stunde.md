# Die erste Stunde

Vom leeren Rechner bis zum ersten Licht, das auf einen Tipp im Telefon
angeht. In Schritten, mit dem, was dabei schiefgeht.

Wer den Hub dauerhaft betreiben will, findet das in
[`deploy/README.md`](../deploy/README.md). Hier geht es darum, dass er
überhaupt einmal läuft – ohne Docker, ohne Portainer, ohne dass etwas
kaputtgehen kann.

## Was du brauchst

- Einen Rechner im selben Netz wie deine Geräte. Ein Raspberry Pi reicht;
  zum Ausprobieren tut es auch dein Laptop.
- Python 3.11 oder neuer.
- Ein Gerät, das du steuern willst. Geht auch ohne – Schritt 2 zeigt eine
  Demo-Wohnung.

## 1. Holen und installieren (5 Minuten)

```bash
git clone https://github.com/stibe881/Homepilot-Pro-neu
cd Homepilot-Pro-neu/hub
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

**Wenn das scheitert:** Meist fehlt ein Compiler für eine der
Protokollbibliotheken. `pip install -e .` ohne Zusätze installiert nur
den Kern; die schweren kommen erst mit `.[matter]`, `.[cast]` und so
weiter dazu – siehe `pyproject.toml`.

## 2. Erst einmal ohne echte Geräte (2 Minuten)

Bevor du deine CCU suchst, sieh dir an, wie es aussehen soll:

```bash
cat > config.yaml <<'YAML'
api:
  host: 0.0.0.0
  port: 8123
  token: hier-ein-langes-zufaelliges-token
integrations:
  - integration: demo
rooms:
  Wohnzimmer: [demo.light_livingroom, demo.temp_livingroom]
  Küche: [demo.switch_coffee]
automations: []
YAML

python -m homepilot --config config.yaml
```

Ein Token erzeugst du mit `openssl rand -base64 32`.

Im Browser `http://<rechner>:8123/api/health` – kommt `{"ok": true, …}`,
läuft der Hub. Die Demo-Wohnung hat ein Licht, eine Steckdose, einen
Bewegungsmelder und einen Fühler; alles davon lässt sich schalten.

**Wenn nichts kommt:** `host: 0.0.0.0` steht da mit Absicht. Mit
`127.0.0.1` erreichst du den Hub nur vom Rechner selbst, nicht vom
Telefon.

## 3. Die App dazu (10 Minuten)

Am schnellsten geht die Web-Fassung:

```bash
cd ../app
npm ci
npx expo export --platform web --output-dir dist
cd dist && python3 -m http.server 8188
```

`http://<rechner>:8188` öffnen. Beim ersten Start fragt die App nach
Adresse und Token – dieselben wie oben. Jetzt solltest du die
Demo-Wohnung sehen und das Licht schalten können.

Für iPhone und iPad gibt es einen eigenen Weg:
[`eigener-app-build.md`](eigener-app-build.md).

## 4. Ein echtes Gerät (20 Minuten)

Jetzt das erste eigene. Nimm das einfachste, das du hast – eine Hue-Lampe
oder eine Homematic-Steckdose.

Alle Integrationen sind in [`hub/config.example.yaml`](../hub/config.example.yaml)
mit Beispiel beschrieben. Für Homematic etwa:

```yaml
integrations:
  - integration: demo          # lass die Demo ruhig stehen
  - integration: homematic
    host: 192.168.1.15         # die IP deiner CCU
    port: 2010                 # 2010 = Homematic IP, 2001 = Funk
    callback_port: 9125
    devices:
      - address: "0031A0C9A6F400:3"
        name: Bewegung Flur
        kind: binary_sensor
        datapoint: MOTION
```

**Die Adresse kennst du noch nicht?** Genau dafür schreibt der Hub beim
Start alle Kanäle ins Log – eine Zeile je Gerät:

```
CCU (Port 2010) meldet 84 Kanäle an 12 Geräten:
  0031A0C9A6F400: 0 MAINTENANCE, 1 KEY_TRANSCEIVER, 2 KEY_TRANSCEIVER,
                  3 MOTIONDETECTOR_TRANSCEIVER, ...
```

Da suchst du deins heraus. Hub neu starten, und das Gerät steht in der App.

**Wenn es nicht auftaucht:** Unter *System* steht je Integration, ob sie
läuft und woran es sonst liegt. Die häufigsten drei:

| Meldung | Ursache |
| --- | --- |
| «Diese Adressen kennt die CCU nicht» | Seriennummer vertippt oder falscher Port (2001 statt 2010) |
| «hat sich in 90 Sekunden nicht gemeldet» | Gerät oder Bridge antwortet nicht – der Hub versucht es weiter |
| Integration fehlt ganz | Bibliothek nicht installiert: `pip install -e ".[name]"` |

## 5. Der erste Ablauf (10 Minuten)

In der App unter *Abläufe → Neuer Ablauf*. Nimm die Vorlage «Licht bei
Bewegung, mit Nachlauf» – sie setzt Melder, Licht, vier Minuten Nachlauf
und «nur wenn dunkel» fertig zusammen.

Der Knopf «Testen» führt die Aktionen sofort aus, ohne auf den Auslöser
zu warten. Und wenn später einmal nichts passiert: Der Lauf-Verlauf unter
dem Ablauf sagt, ob der Auslöser überhaupt ankam.

Rezepte für weitere: [`automationen-rezepte.md`](../hub/docs/automationen-rezepte.md).

## 6. Damit es das nächste Mal von selbst läuft

Bis hierhin läuft der Hub in deinem Terminal und ist weg, sobald du es
schliesst. Für den Dauerbetrieb – Docker oder systemd, mit automatischem
Neustart – geht es in [`deploy/README.md`](../deploy/README.md) weiter.

**Bevor du das tust:** Leg die Zugangsdaten in eine eigene Datei. In der
`config.yaml` stehen dann nur Platzhalter der Form `${NAME}`:

```bash
cat > secrets.env <<'EOF'
HOMEPILOT_TOKEN=dein-token
HUE_APP_KEY=...
EOF
chmod 600 secrets.env
```

Und: `hub/config.yaml`, `hub/secrets.env` und `hub/homepilot-data.json`
gehören **nie** ins Repository. Sie stehen in der `.gitignore` – prüf vor
einem `git add -A` trotzdem mit `git status`.

## Was danach kommt

- [Aufbau](aufbau.md) – wie Hub, App und Integrationen zusammenhängen
- [Fernzugriff](fernzugriff.md) – von unterwegs, ohne den Hub ins offene
  Internet zu stellen
- [Benutzer und Rollen](anmeldung.md) – wer was darf
