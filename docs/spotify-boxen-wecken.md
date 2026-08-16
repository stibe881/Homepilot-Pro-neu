# Google-/Cast-Boxen aus dem Ruhezustand starten

Spotify Connect zeigt einen Lautsprecher nur, solange er sich gerade bei
Spotify gemeldet hat – darum tauchen Google-Boxen oft erst auf, wenn
irgendwo die Spotify-App offen ist. HomePilot kann eine schlafende Box beim
Playlist-Start selbst wecken: Es startet die Spotify-App auf der Box übers
Cast-Protokoll und meldet sie an deinem Konto an (dieselbe Mechanik wie
«Spotcast» in Home Assistant).

## Voraussetzungen

- **Spotify Premium** (Connect-Steuerung gibt es nicht mit Gratis-Konten).
- Die Box läuft als `google_cast`-Gerät im Hub (feste IP im `devices`-Block).
- Das Cookie **`sp_dc`** aus einer Spotify-Websitzung. Die Geräteanmeldung
  akzeptiert nur Tokens des offiziellen Web-Players, und die hängen an
  diesem Cookie.

## sp_dc-Cookie holen

Am einfachsten im Chrome (Firefox/Edge gehen analog):

1. [open.spotify.com](https://open.spotify.com) öffnen und **einloggen**.
2. **F12** → Reiter **Application** (ggf. unter »).
3. Links **Storage → Cookies → https://open.spotify.com**.
4. In der Liste die Zeile **`sp_dc`** suchen und ihren **Value** kopieren
   (ein langer Text). Nur diesen Wert, ohne `sp_dc=` davor.

Der Wert hält Monate. Meldest du dich in **diesem** Browser bei Spotify ab,
wird er ungültig – dann einfach neu holen (am besten ein Fenster nutzen, in
dem du eingeloggt bleibst, oder ein Inkognito-Fenster, das du danach
schliesst, ohne dich abzumelden).

## Eintragen

Der Anmelde-Helfer fragt das Cookie am Schluss von selbst ab:

```bash
docker exec -it homepilot-hub \
  python -m homepilot.integrations.spotify -c /config/config.yaml
```

Beim Schritt »3. (Optional) …« den Wert einfügen. Er landet neben dem
refresh_token in `spotify-token.json`.

Alternativ als Umgebungsvariable (Portainer-Stack) und in der Config:

```yaml
  - integration: spotify
    client_id: "${SPOTIFY_CLIENT_ID}"
    client_secret: "${SPOTIFY_CLIENT_SECRET}"
    sp_dc: "${SPOTIFY_SP_DC}"
```

Danach den Hub neu starten.

## Prüfen

In der App eine schlafende Box wählen und eine Playlist antippen – im
Display der Box erscheint kurz das Spotify-Logo, dann läuft die Musik. Im
Log steht bei Erfolg:

```
docker logs homepilot-hub 2>&1 | grep -i spotify
… <Box> bei Spotify angemeldet (geweckt)
```

Häufige Meldungen:

| Meldung | Ursache |
|---|---|
| `ohne sp_dc-Cookie lässt sie sich nicht wecken` | Cookie fehlt – siehe oben |
| `Web-Player-Token abgelehnt … sp_dc-Cookie abgelaufen?` | Neu einloggen und Cookie neu holen |
| `device-auth … abgelehnt (HTTP 403): RBAC: access denied` | Es lief noch der alte Weg ohne Web-Player-Token – Hub neu bauen |
| `meldet keine Geräteinfo` | Die Box hat die Spotify-App nicht sauber gestartet – Box kurz vom Strom nehmen |

## Hinweis zur Stabilität

Der Web-Player-Token nutzt eine **inoffizielle** Schnittstelle mit einem
zeitbasierten Code, dessen Geheimnis Spotify im Web-Player versteckt. Der
Hub lädt die jeweils aktuelle Fassung dieses Geheimnisses beim Start und
hat eine eingebaute als Rückfall. Ändert Spotify das Verfahren, klemmt nur
das **Wecken** – Playlisten anzeigen, steuern und die Wiedergabe auf bereits
wache Boxen umziehen läuft weiter über die offizielle Web-API.
