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

   Dazu je nach aktivierten Integrationen: `MQTT_USER`, `MQTT_PASSWORD`,
   `UNIFI_USER`, `UNIFI_PASSWORD`, `HUE_APP_KEY`, `HUE_SYNC_TOKEN`,
   `SPOTIFY_*`, `GOOGLE_*`, `ROBOROCK_EMAIL`, `ROBOROCK_PASSWORD`
   (die vollständige Liste steht in `docker-compose.portainer.yml`).

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

Ältere Portainer-Versionen können Repository-Stacks nicht selbst bauen.
Dann einmalig per SSH:

```bash
git clone https://github.com/stibe881/Homepilot-Pro-neu /opt/homepilot-src
cd /opt/homepilot-src
docker compose -f docker-compose.portainer.yml build
```

Danach den Stack in Portainer normal anlegen – das gebaute Abbild wird
wiederverwendet. Alternativ funktioniert der klassische Weg über die
Kommandozeile wie in [`deploy/README.md`](README.md) beschrieben.

## Hinweise

- Der Container läuft mit `network_mode: host` – Absicht: Der Hub muss
  Geräte im Netz direkt erreichen, und die Homematic-CCU schickt ihre
  Events aktiv an Port 9125 zurück. Deshalb gibt es in Portainer auch
  keine Port-Zuordnungen zu sehen; der Hub lauscht direkt auf 8123.
- **Den Hub nicht ins Internet freigeben.** Für unterwegs ist ein VPN der
  richtige Weg – UniFi bringt eines mit (WireGuard unter *Teleport/VPN*).
- Kopplungs-Helfer (Android TV, Ring, Matter) laufen im Container so:
  `docker exec -it homepilot-hub python -m homepilot.integrations.androidtv -c /config/config.yaml`
