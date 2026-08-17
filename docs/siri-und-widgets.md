# Siri-Kurzbefehle & Sperrbildschirm-Widget

Der Hub hat eine schlichte REST-Schnittstelle. Damit lässt sich – ganz ohne
Zusatz-App – über **Apple Kurzbefehle** per Siri, Sperrbildschirm-Widget oder
Tippen auf der Rückseite des iPhones eine Szene auslösen oder ein Gerät
schalten.

## Einmal vorbereiten

Ein eigenes Token für Siri anlegen (nicht das der App wiederverwenden), damit
man den Zugang einzeln zurückziehen kann. In der `config.yaml`:

```yaml
users:
  - name: Siri
    role: bewohner
    token: "${TOKEN_SIRI}"
```

Token erzeugen: `openssl rand -base64 32`, als Umgebungsvariable `TOKEN_SIRI`
setzen, Hub neu starten.

## Der schnelle Weg: fertige Angaben aus der App

In der App unter **Einstellungen → System → Siri-Kurzbefehle** stehen alle
Szenen und schaltbaren Geräte mit fertiger URL, Methode, Headern und
Anfragetext. Antippen teilt den Block – in der App «Kurzbefehle»
einsetzen, fertig.

Die geteilten Angaben enthalten dein Token. Wer sie hat, kann alles
schalten, was du darfst – also nicht in einen Gruppenchat schicken. Für
Siri lohnt sich der eigene Benutzer von oben, den man einzeln zurückziehen
kann.

Wer es lieber von Hand zusammensetzt, findet unten den ganzen Weg.

## Kurzbefehl „Szene auslösen"

1. App **Kurzbefehle** öffnen → **+** → **Aktion hinzufügen** → **Web** →
   **Inhalte von URL abrufen**.
2. URL: `http://<hub-ip>:8123/api/scenes/guten_abend/activate`
   (die Szenen-ID steht in der `config.yaml` unter `scenes:`).
3. Auf **Methode** tippen → **POST**.
4. Unter **Header** hinzufügen:
   - `Authorization` = `Bearer <TOKEN_SIRI>`
5. Dem Kurzbefehl einen Namen geben, z.B. „Guten Abend" – genau dieser Satz
   wird der Siri-Befehl („Hey Siri, Guten Abend").

## Kurzbefehl „Gerät schalten"

Gleich wie oben, aber:

- URL: `http://<hub-ip>:8123/api/entities/<entity-id>/command`
  z.B. `.../api/entities/overkiz.wohnzimmer_storen/command`
- Methode: **POST**
- Header: `Authorization: Bearer <TOKEN_SIRI>` **und**
  `Content-Type: application/json`
- **Anfragetext** → **JSON**:

  ```json
  { "command": "close" }
  ```

  Für Licht mit Helligkeit:

  ```json
  { "command": "turn_on", "data": { "brightness": 60 } }
  ```

## Aufs Sperrbildschirm-Widget legen

Sperrbildschirm bearbeiten → Widget **Kurzbefehle** hinzufügen → den eben
erstellten Kurzbefehl wählen. Ein Tipp löst ihn dann direkt aus.

## Hinweise

- Das iPhone muss im selben WLAN sein wie der Hub (lokale IP). Von unterwegs
  braucht es einen VPN-Zugang ins Heimnetz – kein Port nach aussen öffnen.
- Die Entitäts-IDs stehen in der App (Kachel → Anpassen) oder unter
  `GET /api/entities`.
- Antwortet der Hub mit `401`, stimmt das Token nicht; bei `404` die Szenen-
  oder Entitäts-ID prüfen.
