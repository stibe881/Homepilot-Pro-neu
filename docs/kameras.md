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

## 4. Live-Bild einschalten

Standbilder gibt es sofort. Für Bewegtbild muss in Protect je Kamera RTSP
freigegeben werden – ohne das liefert der Controller keinen Videostrom:

1. Protect öffnen → Kamera wählen → **Einstellungen → Erweitert → RTSP**
2. Mindestens einen Kanal einschalten (**Medium** ist der gute Mittelweg:
   scharf genug fürs iPad, sparsam genug fürs WLAN).
3. Für alle Kameras wiederholen, die live laufen sollen.

Welchen Kanal der Hub nimmt, steuert `stream_quality` (`high`, `medium`,
`low`; Standard `medium`). Ist die gewünschte Stufe nicht freigegeben,
nimmt der Hub die nächstbeste statt gar keine.

Umgewandelt wird ohne Neucodierung, das kostet also kaum Rechenzeit – und
nur, solange jemand zuschaut. Dafür gibt es zwei Wege:

- **mediamtx** (empfohlen): liefert Low-Latency-HLS – Bruchstücke von 200
  Millisekunden statt ganzer Sekunden-Häppchen. Rückstand: **unter einer
  Sekunde**. Der Dienst steht als Container `homepilot-mediamtx` im Stack
  (docker-compose.portainer.yml) und startet beim nächsten
  **Update the stack → Deploy** automatisch mit; konfiguriert ist er über
  Umgebungsvariablen direkt im Compose-File – der Hub legt die Kamerapfade
  selbst über die Steuer-API an, anzupassen gibt es nichts.

  Das Live-Bild ist **ohne Ton**, und zwar mit Absicht: Die Tonspuren der
  Protect-Kameras (AAC und Opus) bringen die Part-Dauer des Low-Latency-HLS
  zum Schwanken – genau daran scheitern iPhone und iPad –, und Opus spielt
  Apples HLS ohnehin nicht. Der Hub lässt den Ton deshalb schon beim
  Anzapfen weg (ffmpeg im mediamtx-Container, Video wird nur kopiert).
- **ffmpeg** (Rückfall): läuft mediamtx nicht, packt der Hub selbst mit
  ffmpeg um – gleiches Bild, rund zwei Sekunden Rückstand.

Welcher Weg aktiv ist, steht beim ersten Antippen einer Kamera im Log:
`Live-Bild über mediamtx (Low-Latency-HLS)` oder `… über ffmpeg (HLS)`.

In der App: Menüpunkt **Kameras** → Kachel antippen. Unten steht „● Live",
wenn wirklich der Strom läuft. Beim Klingeln zeigt auch das Vollbild der
Türklingel live, sofern die Kamera es hergibt. Der Ton ist bewusst
stummgeschaltet – ein Wandpanel, das beim Antippen lospoltert, will niemand.

Kacheln zeigen weiterhin Standbilder (alle 15 Sekunden ein frisches): Vier
Livestreams nebeneinander wären für Hub und WLAN unnötig teuer.

**Im Browser** funktioniert das Live-Bild ebenfalls: Safari spielt HLS von
Haus aus, in Chrome und Firefox übernimmt hls.js. Nach dem Aktualisieren der
App-Abhängigkeiten (`npm install`) einmal neu laden – bleibt es beim
Standbild, das alle drei Sekunden wechselt, lief noch die alte Fassung.

## 5. Prüfen

```bash
docker logs homepilot-hub 2>&1 | grep -i protect
```

Erwartet: `Integration unifi_protect geladen` und
`Mit dem Protect-Ereignisstrom verbunden`. Danach erscheint in der App der
Menüpunkt **Kameras** – er bleibt ausgeblendet, solange keine Kamera da ist.

Häufige Meldungen:

| Meldung | Ursache |
|---|---|
| `Protect-Anmeldung abgelehnt (401)` | Passwort falsch, oder der Benutzer hat keine Protect-Berechtigung |
| `Protect verlangt Zwei-Faktor-Authentifizierung (499)` | Der Benutzer braucht einen zweiten Faktor – siehe unten |
| `Protect nicht erreichbar` | falsche `host`-Adresse, oder der Controller ist in einem anderen VLAN |
| Kameras da, aber kein Bild | Der Benutzer hat keine Protect-Berechtigung (nur *View Only* genügt) |
| `kein Live-Bild – RTSP ist nicht eingeschaltet` | Schritt 4: RTSP je Kamera freigeben |
| `Weder mediamtx noch ffmpeg vorhanden` | Stack neu deployen (mediamtx-Container) oder Hub neu bauen |
| `mediamtx antwortet mit 404/500` | Kamera liefert gerade kein Bild – RTSP-Kanal und Erreichbarkeit prüfen |
| Live läuft, aber mit ~2 s Rückstand | Es läuft der ffmpeg-Rückfall – mediamtx-Container prüfen (`docker logs homepilot-mediamtx`) |

### Live-Bild prüfen (ein Befehl)

Wenn die App «Live-Bild nicht verfügbar» zeigt, misst dieses Skript die
ganze Kette von innen durch und nennt das hakende Glied:

```bash
docker exec -i homepilot-hub python - < deploy/livecheck.py
```

Es prüft der Reihe nach: mediamtx erreichbar, welche Kameras RTSP haben,
Master-Playlist, Unterliste, erstes Video-Häppchen – und zusätzlich, was
Apple-Geräte bekommen. Steht überall 200, liefert der Hub sauber und die
Ursache liegt in der App (dann dort `git pull` + `npm install` und mit
`npx expo start --clear` neu starten).

### Fehler 499: Zwei-Faktor

Das ist der häufigste Stolperstein und hat nichts mit dem Passwort zu tun –
UniFi verlangt für dieses Konto einen zweiten Faktor, den der Hub nicht
liefern kann. Abhilfe der Reihe nach:

1. **Ist es wirklich ein lokaler Benutzer?** In *Settings → Admins & Users*
   den Benutzer öffnen: Steht dort eine E-Mail-Adresse, ist es ein
   Ubiquiti-Cloud-Konto – dafür erzwingt Ubiquiti 2FA immer. Neuen Benutzer
   mit **Local Access Only** anlegen (nur Benutzername + Passwort, keine
   E-Mail).
2. **2FA beim Benutzer abschalten.** Beim lokalen Benutzer darf unter
   *Two-Factor Authentication* nichts eingerichtet sein.
3. **Erzwingt die Konsole 2FA für alle?** In neueren UniFi-OS-Versionen
   unter *Settings → System → Advanced* bzw. beim Besitzerkonto:
   „Require Two-Factor Authentication" für Admins. Solange das an ist,
   scheitert jede Anmeldung ohne Code – entweder abschalten, oder den
   Hub-Benutzer als reinen Local-Access-Benutzer davon ausnehmen.

Nach der Änderung den Hub neu starten (Portainer → Container → Restart);
die Anmeldung wird nur beim Start und bei abgelaufener Sitzung versucht.

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
