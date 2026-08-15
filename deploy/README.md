# Den Hub dauerhaft betreiben

Der Hub ist das Programm, das mit deinen Geräten spricht. Er muss auf einem
Rechner laufen, der **durchgehend an ist und im selben Netz steht wie deine
Geräte** – Hue-Bridge, CCU, MQTT-Broker und UniFi sind nur lokal erreichbar.
Ein Raspberry Pi reicht völlig; ebenso ein Mini-PC, ein NAS mit Docker oder
ein alter Rechner.

Nicht geeignet ist das iPhone: Automationen wie „Licht bei Bewegung“ müssen
auch dann laufen, wenn dein Telefon aus ist oder du unterwegs bist.

Zwei Wege stehen zur Wahl. **Docker** ist der bequemere, **systemd** der
schlankere.

## Zugangsdaten vorbereiten (beide Wege)

Tokens und Keys gehören nicht in die `config.yaml`, sondern in eine eigene
Datei. In der Konfiguration stehen nur Platzhalter der Form `${NAME}`.

```bash
cat > .env <<'EOF'
HOMEPILOT_TOKEN=ein-langes-zufaelliges-token
SUPABASE_SERVICE_KEY=eyJ...
HUE_APP_KEY=...
EOF
chmod 600 .env
```

Ein brauchbares Token erzeugst du mit `openssl rand -base64 32`.

## Weg 1: Docker

```bash
git clone https://github.com/stibe881/Homepilot-Pro-neu
cd Homepilot-Pro-neu
cp hub/config.example.yaml hub/config.yaml   # Integrationen anpassen
# .env wie oben anlegen
docker compose up -d
```

Prüfen und mitlesen:

```bash
docker compose ps
docker compose logs -f hub
curl http://localhost:8123/api/health
```

Der Container läuft mit `network_mode: host`. Das ist Absicht: Der Hub muss
Geräte im Netz direkt erreichen, und die Homematic-CCU schickt ihre Events
aktiv an den Hub zurück – hinter einem Docker-Bridge-Netz käme sie nicht an.

Nach einem Update:

```bash
git pull && docker compose up -d --build
```

## Weg 2: systemd (z.B. Raspberry Pi OS, Debian, Ubuntu)

```bash
sudo useradd --system --create-home --home-dir /opt/homepilot homepilot
sudo git clone https://github.com/stibe881/Homepilot-Pro-neu /opt/homepilot
sudo chown -R homepilot:homepilot /opt/homepilot

sudo -u homepilot python3 -m venv /opt/homepilot/hub/.venv
sudo -u homepilot /opt/homepilot/hub/.venv/bin/pip install /opt/homepilot/hub

sudo mkdir -p /etc/homepilot
sudo cp /opt/homepilot/hub/config.example.yaml /etc/homepilot/config.yaml
sudo cp .env /etc/homepilot/homepilot.env
sudo chown -R root:homepilot /etc/homepilot
sudo chmod 640 /etc/homepilot/homepilot.env

sudo cp /opt/homepilot/deploy/homepilot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homepilot
```

Prüfen und mitlesen:

```bash
systemctl status homepilot
journalctl -u homepilot -f
```

Der Dienst startet nach einem Stromausfall von selbst wieder und versucht es
bei einem Absturz alle zehn Sekunden erneut.

## Danach: die App verbinden

In der App trägst du ein:

- **Hub-URL:** `http://<ip-des-rechners>:8123` – die IP findest du mit
  `hostname -I` auf dem Rechner selbst oder in deinem UniFi-Controller.
  Nicht `localhost` eintragen: das zeigt vom iPhone aus auf das iPhone.
- **Token:** derselbe Wert wie `HOMEPILOT_TOKEN` in der `.env`.

Damit sich die Adresse nicht ändert, gib dem Rechner in deinem Router eine
feste IP (im UniFi-Controller: *Client* → *Fixed IP*).

## Was gesichert werden sollte

Zwei Dateien enthalten alles, was nicht wiederherstellbar ist:

| Datei | Inhalt |
|---|---|
| `config.yaml` | Integrationen, Räume, Szenen, fest eingetragene Benutzer |
| `homepilot-data.json` | In der App angelegte Benutzer und Abläufe, samt Tokens |

Die zweite Datei legt der Hub neben der Konfiguration an und schreibt sie
über eine temporäre Datei – ein Stromausfall mitten im Speichern hinterlässt
also keine halbe Datei. Bei Docker liegen beide im hereingereichten Ordner,
bei systemd unter `/etc/homepilot`.

## Ports

| Port | Wofür | Wer spricht ihn an |
|---|---|---|
| 8123 | REST- und WebSocket-API | die App |
| 9125 | Callback der Homematic-CCU | die CCU (nur bei aktiver Homematic-Integration) |

Beide Ports müssen nur im lokalen Netz erreichbar sein. **Gib den Hub nicht
direkt ins Internet frei** – für den Zugriff von unterwegs ist ein VPN der
richtige Weg, und UniFi bringt eines mit (WireGuard unter *Teleport/VPN*).
