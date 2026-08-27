# HomePilot mit Portainer betreiben

Diese Anleitung bringt den Hub als Portainer-Stack auf deinen Docker-Host.
Portainer zieht das Repository selbst, baut das Abbild und hält den
Container am Laufen – Updates sind danach ein Klick.

## Voraussetzungen

- Ein Docker-Host im selben Netz wie deine Geräte (NAS, Mini-PC,
  Raspberry Pi), mit laufendem Portainer.
- SSH-Zugang auf den Host für die einmalige Vorbereitung (Schritt 1).
- Da das Repository privat ist: ein GitHub-Token zum Lesen
  (github.com → *Settings → Developer settings → Personal access tokens*,
  Berechtigung nur `repo` bzw. nur Lesezugriff auf dieses Repository).

## Schritt 1: Konfiguration auf dem Host anlegen (einmalig, per SSH)

```bash
sudo mkdir -p /opt/homepilot
sudo nano /opt/homepilot/config.yaml
```

Als Inhalt den kompletten [`hub/config.example.yaml`](../hub/config.example.yaml)
einfügen und anpassen:

- Unter `integrations:` die Geräte aktivieren, die du hast
  (Kommentarzeichen `#` entfernen, IP-Adressen eintragen).
- Unter `supabase:` die URL deines Projekts eintragen:

  ```yaml
  supabase:
    url: "https://jfvnfzdlqdppdaueorfz.supabase.co"
    service_key: "${SUPABASE_SERVICE_KEY}"
    history: true
  ```

Zum Schluss dem Hub das Schreibrecht geben – im Container läuft er als
Benutzer 1000 und legt hier App-Daten, Kopplungs-Dateien und Änderungen
aus dem Konfigurations-Editor ab:

```bash
sudo chown -R 1000:1000 /opt/homepilot
```

Der Ordner `/opt/homepilot` ist danach das Zuhause des Hubs: Neben der
`config.yaml` legt er dort `homepilot-data.json` an (in der App angelegte
Benutzer und Abläufe) sowie Kopplungs-Dateien (Android-TV-Zertifikate,
Ring-Token). **Diesen Ordner ins Backup aufnehmen.**

## Schritt 2: Stack in Portainer anlegen

1. Portainer öffnen → **Stacks** → **Add stack**.
2. Name: `homepilot`.
3. Build-Methode **Repository** wählen:
   - **Repository URL:** `https://github.com/stibe881/Homepilot-Pro-neu`
   - **Repository reference:** `refs/heads/claude/custom-home-automation-t9lvq3`
     (nach einem Merge auf den Hauptzweig: `refs/heads/main`)
   - **Compose path:** `docker-compose.portainer.yml`
   - **Authentication** einschalten: GitHub-Benutzername + das Token aus
     den Voraussetzungen.
4. Unter **Environment variables** hinzufügen:

   | Name | Wert |
   |---|---|
   | `HOMEPILOT_TOKEN` | ein langes Zufallstoken (`openssl rand -base64 32`) |
   | `TOKEN_STEFAN` | dein persönliches Benutzer-Token (ebenso erzeugt) |
   | `SUPABASE_SERVICE_KEY` | der service_role-Key aus dem Supabase-Dashboard |
   | `SUPABASE_ANON_KEY` | der anon-Key – für die Anmeldung mit E-Mail und Passwort |

   Dazu je nach aktivierten Integrationen: `MQTT_USER`, `MQTT_PASSWORD`,
   `UNIFI_USER`, `UNIFI_PASSWORD` (Protect), `UNIFI_NET_USER`,
   `UNIFI_NET_PASSWORD` (Network), `HUE_APP_KEY`, `HUE_SYNC_TOKEN`,
   `SPOTIFY_*`, `GOOGLE_*`, `ROBOROCK_EMAIL`, `ROBOROCK_PASSWORD`,
   `NUKI_TOKEN`, `VZUG_USER`, `VZUG_PASSWORD`, `OVERKIZ_TOKEN`
   (die vollständige Liste steht in `docker-compose.portainer.yml`).

   > **Eine Variable hier einzutragen genügt nicht.** Portainer setzt sie
   > beim Deployen nur in die compose-Datei ein. In den Container kommt sie
   > erst durch eine Zeile in deren `environment:`-Liste – also
   > `- SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}`. Alle Variablen aus der
   > `config.example.yaml` stehen dort bereits; wer eine *neue* erfindet,
   > trägt sie an beiden Orten ein. Sonst kommt beim Speichern der
   > Konfiguration «Umgebungsvariable … ist nicht gesetzt», obwohl sie im
   > Stack sichtbar ist.

5. **Deploy the stack.** Portainer klont das Repository und baut das
   Abbild – der erste Start dauert ein bis zwei Minuten.

## Schritt 3: Prüfen

- In Portainer: **Containers → homepilot-hub → Logs**. Dort erscheint beim
  Start `Hub bereit: … Integrationen, … Entitäten` – und pro Integration,
  ob sie geladen wurde oder woran sie scheitert.
- Vom Host aus: `curl http://localhost:8123/api/health` → `{"ok": true, …}`.

## Schritt 4: App verbinden

In der App eintragen:

- **Hub-URL:** `http://<ip-des-docker-hosts>:8123`
  (nicht `localhost` – das zeigt vom iPhone aus auf das iPhone).
- **Token:** der Wert von `TOKEN_STEFAN`.

Dem Docker-Host im Router eine feste IP geben (UniFi: *Client → Fixed IP*),
damit sich die Adresse nie ändert.

## Updates einspielen

Stack in Portainer öffnen → **Pull and redeploy** (bei Repository-Stacks
auch als „Update the stack“ mit *Re-pull image and redeploy* beschriftet).
Portainer holt den neuesten Stand aus dem Repository und baut neu.

## Wenn Portainer beim Bauen streikt

Manche Portainer-Versionen (oder -Einstellungen) ziehen bei „Update the
stack“ nicht zuverlässig den neuesten Commit – der Container läuft dann
scheinbar aktuell, hat aber noch alten Code. Erkennbar z.B. daran, dass eine
gerade erst hinzugefügte Bibliothek im Container fehlt.

Für diesen Fall liegt [`deploy/rebuild-hub.sh`](rebuild-hub.sh) bereit – es
erledigt den kompletten Dreisatz (alten Container/Abbild entfernen, frisch
klonen, ohne Cache neu bauen) in einem Aufruf, statt die Einzelbefehle jedes
Mal von Hand zu tippen.

**Einmalige Einrichtung** auf dem Docker-Host:

```bash
sudo mkdir -p /opt/homepilot
sudo nano /opt/homepilot/github-credentials.env
```

Dort rein (GitHub-Benutzername + ein Personal Access Token mit Lesezugriff
auf dieses private Repository – github.com → Settings → Developer settings
→ Personal access tokens):

```
GITHUB_USER=dein-github-benutzername
GITHUB_TOKEN=dein-personal-access-token
```

```bash
sudo chmod 600 /opt/homepilot/github-credentials.env
```

Das Skript selbst nach `/opt/homepilot/rebuild-hub.sh` kopieren (Inhalt aus
[`deploy/rebuild-hub.sh`](rebuild-hub.sh) im Repository) und ausführbar
machen:

```bash
sudo chmod +x /opt/homepilot/rebuild-hub.sh
```

**Ab dann bei jedem Update** nur noch:

```bash
sudo /opt/homepilot/rebuild-hub.sh
```

...und danach einmal in Portainer **Update the stack** → **Deploy**, damit
der Container das frische Abbild übernimmt.

Das Skript startet den Container absichtlich nicht selbst – deine Tokens
liegen ausschliesslich in Portainers Stack-Konfiguration, nicht zusätzlich
auf der Platte. Wer auch den letzten Klick loswerden will: In Portainer
unter **Stacks → homepilot → Webhook** einen Stack-Webhook aktivieren und
die angezeigte URL als `PORTAINER_WEBHOOK_URL` in
`/opt/homepilot/github-credentials.env` eintragen – das Skript ruft ihn
dann am Ende automatisch auf, und `sudo /opt/homepilot/rebuild-hub.sh`
ist der einzige nötige Befehl.

## Hinweise

- Der Container läuft mit `network_mode: host` – Absicht: Der Hub muss
  Geräte im Netz direkt erreichen, und die Homematic-CCU schickt ihre
  Events aktiv an Port 9125 zurück. Deshalb gibt es in Portainer auch
  keine Port-Zuordnungen zu sehen; der Hub lauscht direkt auf 8123.
- **Den Hub nicht ins Internet freigeben.** Für unterwegs ist ein VPN der
  richtige Weg – UniFi bringt eines mit (WireGuard unter *Teleport/VPN*).
- Kopplungs-Helfer (Android TV, Ring, Matter) laufen im Container so:
  `docker exec -it homepilot-hub python -m homepilot.integrations.androidtv -c /config/config.yaml`


## Update-Knopf in der App

Der Hub kann sich nicht selbst neu bauen – er läuft in einem Container und
hat weder das Repository noch Docker zur Hand. Das ist Absicht: Ein Dienst
mit Zugriff auf den Docker-Socket ist faktisch root auf dem Host, und das
gehört nicht in eine Hausautomation, die nebenbei Webseiten aus dem
Internet abruft.

Das fehlende Stück ist ein kleiner Dienst *neben* dem Container, der genau
einen Aufruf entgegennimmt und `rebuild-hub.sh` startet. Dann macht der
Knopf in der App die ganze Kette: bauen **und** ausrollen.

### 1. Geheimnis anlegen

In `/opt/homepilot/github-credentials.env` ergänzen – dieselbe Datei, die
`rebuild-hub.sh` schon liest:

```
UPDATE_SECRET=hier-ein-langes-zufaelliges-geheimnis
```

Erzeugen mit `openssl rand -base64 32`.

### 2. Dienst einrichten

```bash
sudo cp deploy/update-listener.py /opt/homepilot/
sudo chmod +x /opt/homepilot/update-listener.py
sudo cp deploy/homepilot-update.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homepilot-update
```

Prüfen, ob er läuft – die Antwort nennt auch, was diese Fassung kann
(`ios` fehlt dort, solange eine ältere Fassung läuft):

```bash
curl http://172.17.0.1:9126/
journalctl -u homepilot-update -f
```

Von Hand auffrischen muss man ihn nicht: `rebuild-hub.sh` legt bei jedem
Update die neue Fassung nach `/opt/homepilot/` und merkt den Neustart des
Dienstes für gleich nach dem Lauf vor (über `systemd-run`, damit der
Neustart nicht den Bau abwürgt, der ihn ausgelöst hat).

Antwortet der Dienst mit einer alten Fähigkeitsliste, obwohl er neu
gestartet wurde, horcht auf dem Port vermutlich noch ein von Hand
gestarteter Prozess von früher – der Dienst kommt dann gar nicht ans
Netz (`Address already in use` im Journal):

```bash
sudo ss -lptn 'sport = :9126'
```

Der Dienst hört **nur** auf dem Docker-Bridge-Gateway. Aus den Containern
ist er erreichbar, aus dem Netz nicht – und aus dem Internet schon gar
nicht.

### 3. Dem Hub die Adresse geben

In der `config.yaml`:

```yaml
update:
  webhook_url: http://172.17.0.1:9126/update
  token: "dasselbe UPDATE_SECRET wie oben"
```

### 4. Portainer-Webhook eintragen

Damit nach dem Bau auch ausgerollt wird: In Portainer unter *Stacks →
homepilot → Webhook* einen Stack-Webhook aktivieren und die Adresse in
`/opt/homepilot/github-credentials.env` eintragen:

```
PORTAINER_WEBHOOK_URL=https://10.10.1.13:9443/api/stacks/webhooks/xxxxxxxx
PORTAINER_INSECURE=1
```

`rebuild-hub.sh` ruft sie am Ende von selbst auf.

Die zweite Zeile braucht es, weil Portainer sein Zertifikat auf Port 9443
selbst ausstellt – ohne sie bricht der Aufruf mit einem Zertifikatsfehler
ab, mitten im sonst fertigen Update. Vertretbar ist das nur, weil der
Aufruf im eigenen Netz bleibt und nichts Geheimes überträgt: Die Adresse
selbst ist das Geheimnis. Wer Portainer hinter einem richtigen Zertifikat
betreibt, lässt die Zeile weg und behält die Prüfung.

### Ab dann

Ein Tipp auf **Update anstossen** in der App genügt: Der Dienst holt den
neuen Stand, baut das Abbild und lässt Portainer den Stack neu ausrollen.
Das dauert einige Minuten; der Knopf antwortet sofort, weil jede wartende
Verbindung in einen Timeout liefe. Was passiert, steht in
`journalctl -u homepilot-update -f`.

Wie der letzte Lauf ausging, steht danach in
`/opt/homepilot/update-status.json` – und die App zeigt es beim nächsten
Öffnen des System-Screens an. Das braucht es, weil der Fortschrittsbalken
nur lebt, solange dieser Bildschirm offen ist, und der Dienst sich nach
einem Update selbst neu startet: Wer auf Update drückt und die App
weglegt, sah sonst nie, dass der Lauf gescheitert war.

Läuft der Hub danach immer noch auf dem alten Stand, sagt das den Stand
im Container:

```bash
docker exec homepilot-hub printenv HOMEPILOT_COMMIT
```

Weicht er von dem ab, was das Skript gebaut hat, hat Portainer den
Container nicht gewechselt – die drei üblichen Gründe nennt das Skript
am Ende seiner Ausgabe.

### Warum «Stand unbekannt»?

Zeigt der System-Screen keinen Commit, wurde das Abbild ohne die
Build-Argumente gebaut. Meist ist die Kopie unter `/opt/homepilot/` älter
als die im Repository:

```bash
sudo cp deploy/rebuild-hub.sh /opt/homepilot/rebuild-hub.sh
sudo chmod +x /opt/homepilot/rebuild-hub.sh
```

Danach einmal bauen – ab dann steht der Stand dort, und man sieht nach
jedem Update, ob der Container wirklich der neue ist.

## Haustür-Live-Aktivität (iPhone-Sperrbildschirm)

Verlässt man das Haus, legt der Hub eine kleine Karte auf den
Sperrbildschirm («Unterwegs – Haustüre im Schnellzugriff»); ein Tipp
darauf führt in die App direkt zur Türe. Beim Heimkommen verschwindet
sie von selbst.

Starten kann so eine Karte nur Apple selbst («push-to-start», ab
iOS 17.2) – deshalb braucht der Hub dafür einen eigenen Schlüssel aus
dem Apple-Entwicklerkonto, zusätzlich zum normalen Push über Expo:

1. Unter <https://developer.apple.com/account/resources/authkeys/list>
   einen Schlüssel anlegen, **Apple Push Notifications service (APNs)**
   ankreuzen, die `.p8`-Datei herunterladen (gibt es nur einmal!) und
   die **Key ID** notieren. Die **Team ID** steht oben rechts im
   Entwicklerkonto.

2. Die Datei auf den Host legen:

   ```bash
   sudo cp AuthKey_ABC123.p8 /opt/homepilot/apns-key.p8
   sudo chmod 600 /opt/homepilot/apns-key.p8
   ```

3. In der `config.yaml` den Block ergänzen (auf oberster Ebene, wie
   `push:`):

   ```yaml
   apns:
     key_file: /config/apns-key.p8
     key_id: ABC123
     team_id: DEF456
     bundle_id: ch.stibe.homepilot
   ```

4. `docker restart homepilot-hub`. Ohne den Block (oder wenn etwas
   fehlt) bleibt die Funktion einfach aus – der Hub sagt es beim Start
   mit einer Zeile im Protokoll.

Auf dem iPhone braucht es einen Build, der die Live-Aktivität enthält
(TestFlight), iOS 17.2 oder neuer, und in den iOS-Einstellungen der App
müssen Live-Aktivitäten erlaubt sein. Die App meldet die nötigen
Apple-Tokens dann von selbst beim Hub an – zu sehen unter
`/api/liveactivity`.
