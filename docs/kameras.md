# Kameras (UniFi Protect)

Der Hub holt die Kameras direkt vom UniFi-Controller im eigenen Netz – ohne
Cloud-Konto und ohne Portfreigabe. In der App gibt es dafür den Menüpunkt
**Kameras**: je Kamera eine Kachel mit Standbild, Online-Zustand und dem
letzten Bewegungsereignis. Ein Tipp auf die Kachel macht das Bild gross und
frischt es alle drei Sekunden auf.

## 0. Welche Konsole ist gemeint?

Bei mehreren UniFi-Geräten im Netz zählt nur eines: das, auf dem die
**Protect-Anwendung läuft** – meist der Video Recorder (UNVR), sonst ein
Cloud Key Gen2+ oder eine UDM Pro. Nicht das Gerät, an dem die Kameras
hängen, und nicht der Router, wenn Protect anderswo läuft.

Das gilt auch für den Benutzer aus Schritt 1: UniFi-OS-Konten gehören zu
einer Konsole, ein auf dem Cloud Key angelegter Benutzer existiert auf dem
UNVR nicht.

Zum Prüfen die IP im Browser aufrufen – erscheint Protect mit den Kameras,
ist es die richtige. Oder vom Docker-Host aus:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://10.10.1.x/proxy/protect/api/bootstrap
```

`401` = Protect läuft hier (es fehlt nur die Anmeldung) → diese Adresse als
`host` eintragen. `404` oder ein Verbindungsfehler = falsches Gerät.

## 1. Eigenen Benutzer im UniFi-Controller anlegen

Nicht das eigene Admin-Konto verwenden: Der Hub soll nur lesen dürfen, und
ein eigener Benutzer lässt sich jederzeit sperren, ohne dass man selbst
ausgesperrt wird.

1. UniFi OS im Browser öffnen → **Settings → Admins & Users → Add User**
2. **Local Access Only** wählen (kein Ubiquiti-Konto, keine Cloud).
3. Benutzername z.B. `homepilot`, ein langes Passwort setzen.
4. Rolle: unter **Applications → Protect** die Berechtigung **View Only**
   geben. Für alles andere (Network, Access) keine Rechte vergeben.
5. Zwei-Faktor für diesen Benutzer **nicht** aktivieren – der Hub kann sich
   sonst nicht anmelden.

## 2. Zugangsdaten in Portainer hinterlegen

Portainer → Stack → **Environment variables**:

| Name | Wert |
|---|---|
| `UNIFI_USER` | `homepilot` |
| `UNIFI_PASSWORD` | das gesetzte Passwort |

Ohne Anführungszeichen. Danach **Update the stack → Deploy** – Umgebungs-
variablen werden nur beim Start des Containers gelesen.

Dieselben Zugangsdaten nutzt auch die `unifi`-Integration (Anwesenheit über
verbundene Geräte); ein Benutzer reicht für beide, dann braucht er
zusätzlich Leserecht auf **Network**.

## 3. Integration einschalten

In der `config.yaml` (App → Einstellungen → System → Konfiguration):

```yaml
  - integration: unifi_protect
    host: 10.10.1.1          # die Konsole aus Schritt 0 (UNVR/Cloud Key/UDM Pro)
    username: "${UNIFI_USER}"
    password: "${UNIFI_PASSWORD}"
    scan_interval: 120
```

`host` ist die Adresse der Protect-Konsole selbst, nicht die einer Kamera.
Das Zertifikat des Controllers ist selbstsigniert – das ist erwartet und
wird für diese eine Verbindung im lokalen Netz akzeptiert.

## 4. Prüfen

```bash
docker logs homepilot-hub 2>&1 | grep -i protect
```

Erwartet: `Integration unifi_protect geladen` und
`Mit dem Protect-Ereignisstrom verbunden`. Danach erscheint in der App der
Menüpunkt **Kameras** – er bleibt ausgeblendet, solange keine Kamera da ist.

Häufige Meldungen:

| Meldung | Ursache |
|---|---|
| `Protect-Anmeldung fehlgeschlagen (401)` | Passwort falsch, oder der Benutzer ist ein Cloud- statt Local-Access-Konto |
| `Protect-Anmeldung fehlgeschlagen (499)` | Zwei-Faktor beim Benutzer aktiv |
| `Protect nicht erreichbar` | falsche `host`-Adresse, oder der Controller ist in einem anderen VLAN |
| Kameras da, aber kein Bild | Der Benutzer hat keine Protect-Berechtigung (nur *View Only* genügt) |

## Bewegung und Klingeln

Bewegungen und Klingeln kommen über den Ereignisstrom des Controllers
sofort an, nicht erst beim nächsten Abfragen. Damit lassen sich Automationen
bauen:

```yaml
automations:
  - id: bewegung_abwesend
    alias: Bewegung während Abwesenheit
    trigger:
      - type: state
        entity_id: unifi_protect.eingang
        attribute: motion
        to: "on"
    condition:
      - type: state
        entity_id: helpers.abwesend
        equals: "on"
    action:
      - type: notify
        to: all
        title: Bewegung erkannt
        body: Die Kamera am Eingang hat Bewegung erkannt.
```

Klingelt eine Protect-Türklingel, zeigt die App wie bei Ring automatisch das
Vollbild mit dem Kamerabild.

## Gäste

Kameras sind für Gäste standardmässig unsichtbar. Wer sie sehen soll,
bekommt unter **Einstellungen → Benutzerverwaltung** den Bereich **Kameras**
freigeschaltet.
