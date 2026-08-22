# Tuya: Sternenprojektor und andere Tuya-Geräte, lokal

Der Smart Star Projector läuft über Tuya – wie sehr viele günstige Lampen,
Steckdosen und LED-Bänder. HomePilot spricht sie **lokal** an: schnell,
ohne Internet, und Änderungen aus der Hersteller-App kommen trotzdem an.

Der Preis dafür ist ein einmaliger Umweg: Tuya verschlüsselt auch im
eigenen Netz, und den **lokalen Schlüssel** rückt der Hersteller nur über
ein (kostenloses) Entwicklerkonto heraus. Eine halbe Stunde, einmal –
danach braucht es weder Konto noch Cloud im Alltag.

## 1. Gerät in der Tuya-App (Smart Life) anlernen

Falls noch nicht geschehen: Das Gerät gehört in die App **Smart Life**
oder **Tuya Smart** – über die läuft es ja heute schon via Home Assistant.
Nichts löschen: Der lokale Schlüssel gehört zur Anlernung; wer das Gerät
neu anlernt, bekommt einen neuen Schlüssel und darf Schritt 3 wiederholen.

## 2. Entwicklerkonto anlegen (einmalig)

1. Auf [iot.tuya.com](https://iot.tuya.com) ein Konto erstellen.
2. **Cloud → Create Cloud Project.** Region **Central Europe**,
   die vorgeschlagenen APIs übernehmen (wichtig: *IoT Core* und
   *Authorization*).
3. Im Projekt: **Devices → Link Tuya App Account → Add App Account.**
   Den QR-Code mit der Smart-Life-App scannen (Ich → oben rechts
   Scan-Symbol). Danach stehen die eigenen Geräte im Projekt.
4. Unter **Overview** stehen **Access ID** und **Access Secret** – die
   braucht der nächste Schritt.

## 3. Lokale Schlüssel holen

Auf docker01:

```
docker exec -it homepilot-hub python -m homepilot.integrations.tuya --cloud
```

Region `eu`, dann Access ID und Access Secret eingeben. Der Aufruf listet
alle Geräte samt Schlüssel und druckt den fertigen Block für die
config.yaml. Die Zugangsdaten werden nur für diesen Aufruf gebraucht und
nirgends gespeichert.

### Der Aufruf listet gar keine Geräte

Kommt keine Fehlermeldung, aber auch kein Gerät, dann stimmen die
Zugangsdaten – nur sieht das Projekt keine Geräte. Der Reihe nach:

* **Verknüpfung fehlt.** Schritt 3 oben ist der übliche Grund: iot.tuya.com
  → Cloud → Projekt → **Devices → Link Tuya App Account → Add App Account**,
  QR-Code mit der Smart-Life-App scannen (*Ich* → Scan-Symbol oben rechts).
* **Falsches Konto verknüpft.** In der Smart-Life-App unter *Ich* steht,
  mit welchem Konto man angemeldet ist. Verknüpft sein muss genau das, in
  dem der Projektor liegt.
* **Falsche Region.** Ein Konto gehört zu einer Region, und ein Projekt
  sieht nur Konten seiner eigenen. Steht das Projekt auf *Central Europe*,
  ist die Antwort auf die Regionsfrage `eu`.
* **IoT Core fehlt oder ist abgelaufen.** Im Projekt unter *Service API*
  muss **IoT Core** stehen. Die Testphase läuft nach einigen Monaten aus
  und lässt sich dort kostenlos verlängern.

Wer mag, prüft vorher, was im Netz überhaupt antwortet:

```
docker exec -it homepilot-hub python -m homepilot.integrations.tuya --scan
```

## 4. In die config.yaml eintragen

```yaml
  - integration: tuya
    devices:
      - name: Sternenprojektor
        id: bf1234567890abcdefgh
        key: "${TUYA_KEY_PROJEKTOR}"
        version: 3.4        # steht in der Ausgabe von --cloud/--scan
```

Den Schlüssel nicht wörtlich in die Datei schreiben, sondern daneben in
die `secrets.env` – eine Zeile genügt:

```
TUYA_KEY_PROJEKTOR=9feb…
```

Die Datei liegt neben der config.yaml, gehört nicht ins Repository und
braucht sonst nichts. Hub neu starten, fertig: Der Projektor erscheint als
Licht mit Helligkeit und Farbreihe auf der Kachel.

(Der andere Weg – Umgebungsvariable im Portainer-Stack – funktioniert
weiterhin und geht sogar vor. Er verlangt aber zusätzlich eine Zeile in
der environment-Liste der docker-compose.yml, und die liegt im
Repository. Für ein neues Geheimnis heisst das jedes Mal: Commit,
ausrollen, hoffen.)

## 5. Was kann das Gerät wirklich? (bei Bedarf)

Tuya beschreibt Fähigkeiten als nummerierte Datenpunkte, und die Nummern
sind je nach Gerät anders. Die verbreitete Belegung für Lampen ist
voreingestellt; was der Projektor tatsächlich meldet, zeigt:

```
docker exec -it homepilot-hub python -m homepilot.integrations.tuya \
  -c /config/config.yaml --dps Sternenprojektor
```

Punkte mit Pfeil kennt der Hub schon. Ein zusätzlicher Ein/Aus-Punkt –
beim Sternenprojektor typischerweise Laser und Nebel getrennt – wird als
eigener Schalter eingetragen und ist damit sofort in Szenen und Abläufen
brauchbar:

```yaml
      - name: Sternenprojektor
        id: bf1234567890abcdefgh
        key: "${TUYA_KEY_PROJEKTOR}"
        switches:
          - name: Laserpunkte
            dp: 102
```

## «Schlüssel oder Protokollfassung passen nicht» (Fehler 914)

**Zuerst die Länge zählen.** Ein lokaler Tuya-Schlüssel hat **genau 16
Zeichen** – er ist ein AES-128-Schlüssel. Im Tuya-Portal stehen daneben
die Geräte-**UUID** und ein **Secret**, beide 32 Zeichen lang und beide
sehen aus, als gehörten sie hierher. Trägt man eines davon ein, weist
tinytuya es ab, *bevor* es das Gerät überhaupt anspricht – und meldet
dieselbe Nummer 914 wie bei einer falschen Protokollfassung. Man sucht
dann einen Abend lang an der Fassung.

Der Hub prüft das seit dieser Fassung beim Start und sagt es im
Klartext. Den richtigen Schlüssel zeigt `--cloud` im Feld `key`.

Stimmt die Länge und kommt trotzdem 914, sagt Tuya nicht, woran es
liegt. Statt zu raten:

```
docker exec -it homepilot-hub python -m homepilot.integrations.tuya \
  -c /config/config.yaml --probe Sternenprojektor
```

Das fragt das Gerät mit jeder Fassung einmal an. Antwortet eine mit
Datenpunkten, gehört sie in die config.yaml unter `version:`. Antwortet
keine, liegt es nicht an der Fassung – dann ist der lokale Schlüssel
veraltet (`--cloud` holt ihn frisch; er ändert sich, sobald das Gerät in
der Hersteller-App neu angelernt wurde).

Ein dritter Fall, den keine Nummer verrät: **Eine andere Steuerung hält
die Verbindung besetzt.** Tuya-Geräte lassen genau eine lokale Sitzung
zu. Läuft der Projektor in Home Assistant noch über LocalTuya oder
tuya-local (nicht über die Cloud-Integration), muss er dort deaktiviert
werden.

Weicht die Belegung ab (ältere Geräte zählen 1–6 statt 20–25), hilft
`legacy: true`; einzelne Nummern lassen sich unter `dps:` überschreiben.

## Home Assistant ablösen

Sobald der Projektor hier läuft, kann die Tuya-Integration in Home
Assistant weg – es gibt nichts zu übernehmen, beide lesen dasselbe Gerät.
Nur nicht das Gerät aus der Smart-Life-App löschen (siehe Schritt 1).
