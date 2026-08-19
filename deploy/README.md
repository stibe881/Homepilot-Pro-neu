# Den Hub dauerhaft betreiben

Der Hub ist das Programm, das mit deinen Geräten spricht. Er muss auf einem
Rechner laufen, der **durchgehend an ist und im selben Netz steht wie deine
Geräte** – Hue-Bridge, CCU, MQTT-Broker und UniFi sind nur lokal erreichbar.
Ein Raspberry Pi reicht völlig; ebenso ein Mini-PC, ein NAS mit Docker oder
ein alter Rechner.

Nicht geeignet ist das iPhone: Automationen wie „Licht bei Bewegung“ müssen
auch dann laufen, wenn dein Telefon aus ist oder du unterwegs bist.

Zwei Wege stehen zur Wahl. **Docker** ist der bequemere, **systemd** der
schlankere. Wer **Portainer** benutzt, folgt am besten der eigenen
Anleitung in [`deploy/portainer.md`](portainer.md).

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

## «403: Nicht erlaubt» beim Update-Knopf

Der Listener kennt für 403 genau einen Grund: Das Geheimnis passt nicht.
Es steht an **zwei** Orten und muss dort Zeichen für Zeichen gleich sein:

| Wo | Was |
|---|---|
| Portainer-Stack | `UPDATE_SECRET` – landet über `${UPDATE_SECRET}` in `update.token` der `config.yaml` |
| Docker-Host | `UPDATE_SECRET=` in `/opt/homepilot/github-credentials.env` |

Wer eines davon dreht, muss das andere mitziehen. Neu setzen:

```bash
NEU=$(openssl rand -base64 32)
echo "$NEU"                                    # in den Portainer-Stack kopieren
sudo sed -i '/^UPDATE_SECRET=/d' /opt/homepilot/github-credentials.env
echo "UPDATE_SECRET=$NEU" | sudo tee -a /opt/homepilot/github-credentials.env
sudo systemctl restart homepilot-update
```

Danach den Stack neu deployen, damit der Hub den neuen Wert bekommt.
Was der Listener sieht, steht in `journalctl -u homepilot-update -f`.

## Damit der Platz nicht mehr knapp wird

Drei Schritte, danach ist Ruhe. Der erste ist der wichtige.

### 1. Deckel auf die Container-Protokolle (einmalig)

Der grösste stille Fresser. Docker schreibt die Ausgabe jedes Containers
ohne Obergrenze, und kein `prune` fasst sie an.

Für Hub und mediamtx steht der Deckel bereits in der compose-Datei
(`logging: max-size 10m, max-file 3` → höchstens 30 MB je Container).
Er greift beim **nächsten Ausrollen des Stacks**. Bewusst dort und nicht
in der `daemon.json`: So braucht es keinen Neustart des Docker-Dienstes,
der jeden anderen Container auf dem Rechner mitreissen würde.

Für die übrigen Container (Portainer, Nginx Proxy Manager, …) gilt der
Deckel aus `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

```bash
sudo systemctl restart docker
```

**Achtung:** Dieser Neustart startet alle Container neu – also zu einem
Zeitpunkt, an dem ein kurzer Ausfall nichts ausmacht. Der Deckel gilt
danach für **neu erstellte** Container; die laufenden übernehmen ihn beim
nächsten Neuausrollen ihres Stacks.

Die vorhandenen, bereits grossen Dateien einmalig leeren (die Container
dürfen dabei laufen):

```bash
sudo du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail -5
sudo sh -c 'truncate -s 0 /var/lib/docker/containers/*/*-json.log'
```

Damit ist das bisherige Protokoll weg – also nur, wenn gerade nichts zu
untersuchen ist.

### 2. Wöchentliches Aufräumen (einmalig einrichten)

`aufraeumen.sh` räumt jede Woche weg, was von selbst wächst: verwaiste
Abbild-Schichten, BuildKits Zwischenspeicher (auf 2 GB gedeckelt), Netze
ohne Container und ein zu grosses Journal. Es fasst weder Datenträger noch
Protokolle an.

```bash
sudo cp deploy/aufraeumen.sh /opt/homepilot/
sudo chmod +x /opt/homepilot/aufraeumen.sh
sudo cp deploy/homepilot-aufraeumen.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homepilot-aufraeumen.timer
```

Nachsehen:

```bash
systemctl list-timers homepilot-aufraeumen
journalctl -u homepilot-aufraeumen -n 40
```

Im Journal steht nach jedem Lauf, wieviel frei wurde und was Docker noch
belegt – falls es doch wieder eng wird, muss niemand raten.

### 3. Die Warnung ernst nehmen

Der Hub meldet ab 85 % Belegung von selbst, im System-Screen und als
Push. Das ist das Netz für den Fall, dass etwas Neues wächst, an das hier
niemand gedacht hat.

## Wenn der Platz trotzdem weniger wird

`rebuild-hub.sh` räumt bei jedem Lauf auf, aber nur das, was vom Bauen
übrig bleibt: verwaiste Abbild-Schichten und BuildKits Zwischenspeicher
(auf 2 GB gedeckelt). Am Ende zeigt es, wieviel Platz noch frei ist und
was Docker belegt.

Drei Dinge wachsen ausserhalb davon.

### 1. Die Protokolle der Container

Der grösste stille Fresser. Docker schreibt die Ausgabe jedes Containers
in eine Datei, **ohne Obergrenze**. Bei einem gesprächigen Dienst sind das
Gigabytes im Jahr, und kein `prune` fasst sie an. Nachsehen:

```bash
sudo du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail -5
```

Die Lösung ist ein Deckel, nicht regelmässiges Löschen. In
`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

```bash
sudo systemctl restart docker
```

Das gilt für **neu erstellte** Container – die laufenden behalten ihre
alte Einstellung, bis der Stack einmal neu ausgerollt wird. Die
vorhandenen Dateien einmalig leeren (die Container dürfen dabei laufen):

```bash
sudo sh -c 'truncate -s 0 /var/lib/docker/containers/*/*-json.log'
```

Damit ist das bisherige Protokoll weg – also nur tun, wenn gerade nichts
zu untersuchen ist.

### 2. Das Journal des Systems

```bash
journalctl --disk-usage
sudo journalctl --vacuum-size=200M
```

Dauerhaft: `SystemMaxUse=200M` in `/etc/systemd/journald.conf`.

### 3. Gestoppte Container und alte Abbilder

`rebuild-hub.sh` löscht nur **verwaiste** Schichten. Abbilder, an denen
noch ein gestoppter Container hängt, bleiben absichtlich liegen.

## Was man dabei nicht tun sollte

**`docker system prune -a --volumes` ist gefährlich.** Zwei Dinge daran:

- `--volumes` löscht Datenträger, an denen gerade kein *laufender*
  Container hängt. Darunter fällt die Datenbank von Nginx Proxy Manager –
  mit ihr alle Proxy-Einträge und Zertifikate.
- `-a` löscht auch Abbilder, deren Container nur gerade gestoppt sind.
  Die müssen danach alle neu geladen werden, und bei einem selbst
  gebauten Abbild ohne Registry heisst das: neu bauen.

Aus demselben Grund steht im Skript `docker image prune -f` ohne `-a` und
`docker builder prune --keep-storage 2GB` statt `--all`. Wer wirklich
aufräumen will, macht es in dieser Reihenfolge und schaut zwischendurch
hin:

```bash
docker system df                    # erst messen
docker image prune -f               # nur verwaiste Schichten
docker builder prune -f --keep-storage 2GB
docker container prune              # fragt nach; gestoppte Container
```

Volumes bleiben aussen vor. Wer meint, einen loszuwerden, schaut ihn sich
vorher einzeln an:

```bash
docker volume ls
docker volume inspect <name>
```
