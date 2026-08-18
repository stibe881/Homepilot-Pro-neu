# Die App über die Subdomain, ohne VPN

Der übliche Weg von unterwegs ist ein [VPN](fernzugriff.md). Wer das nicht
will, kann die Web-Fassung der App vom Hub selbst ausliefern lassen und
über die Subdomain aufrufen. Diese Anleitung beschreibt, wie – und was es
kostet.

## Was das bedeutet

**Deine ganze Steuerung hängt danach am offenen Internet.** Türöffner,
Alarmanlage, Kameras – erreichbar für jeden, der die Adresse kennt,
geschützt allein durch das Token.

Beim VPN-Weg braucht ein Angreifer zwei Dinge: Zugang ins Netz *und* ein
Token. Hier nur noch das Token. Das ist eine andere Grössenordnung, und man
sollte sie bewusst wählen und nicht nebenbei.

Wenn du damit einverstanden bist, mach wenigstens das hier:

- **Je Person ein eigenes Token** (Einstellungen → Benutzer). Kommt eines
  abhanden, ziehst du genau dieses zurück, statt alle neu zu verteilen.
- **Kein Token in Screenshots, Chats oder Notizen.** Die Kopplung läuft
  über den QR-Code, dafür ist er da.
- **Gastzugänge mit Ablaufdatum.** Gibt es in der Benutzerverwaltung.
- **Kein `bypassPermissions` auf dem Router**: Weitergeleitet werden 80 und
  443 zum Proxy, nichts sonst. Der Hub-Port 8123 bleibt zu.

## 1. Web-Fassung bauen

Im Ordner `app/`:

```bash
npm install
npm run build:web
```

Das legt den fertigen Stand in `app/dist/` ab – reine statische Dateien.

## 2. Auf den Docker-Host kopieren

Neben die Konfiguration, denn dieser Ordner ist bereits als `/config` in
den Container eingehängt:

```bash
scp -r app/dist/* root@docker01:/opt/homepilot/web/
```

## 3. Dem Hub sagen, wo sie liegt

In `/opt/homepilot/config.yaml`:

```yaml
web_root: /config/web
```

Neu bauen und ausrollen. Im Log steht dann:

```
Web-Fassung der App wird aus /config/web ausgeliefert
```

Der Hub liefert sie unter `/` aus – **hinter** allen Schnittstellen-Routen,
die also weiterhin Vorrang haben. App und Schnittstelle teilen sich damit
eine Adresse, und die Web-Fassung schlägt beim ersten Start die eigene
Adresse als Hub vor; abtippen muss man nichts.

## 4. Im Nginx Proxy Manager

- Die Sperre aus [oeffentliche-adresse.md](oeffentliche-adresse.md) **muss
  weg** – sie würde die App mit aussperren.
- **Websockets Support einschalten.** Ohne das lädt die Oberfläche zwar,
  bleibt aber tot: Die Live-Aktualisierung läuft über `/ws`.
- *Force SSL* und *HSTS* an.
- *Block Common Exploits* an.

## 5. Prüfen

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://homepilot.deinedomain.ch/
curl -s https://homepilot.deinedomain.ch/api/entities
```

Erwartet: `200` für die Oberfläche, `{"detail":"Ungültiges Token"}` für die
Schnittstelle ohne Anmeldung.

## Was der Hub dagegen selbst tut

**Bremse gegen Anmeldeversuche.** Nach zehn ungültigen Tokens innerhalb von
fünf Minuten ist die Adresse eine Viertelstunde draussen (HTTP 429). Gezählt
werden nur Fehlversuche – wer ein gültiges Token hat, darf so oft er will.

Hinter einem Reverse Proxy nimmt die Bremse die Adresse aus
`X-Forwarded-For`; sonst sperrte sie den Proxy aus und mit ihm das ganze
Haus. Der Nginx Proxy Manager setzt diesen Kopf von sich aus.

Das schützt nicht gegen jemanden, der ein Token *hat*. Es schützt gegen das
Durchprobieren und gegen Dauerbeschuss, der den Hub sonst beschäftigt hält.

## Was weiterhin gilt

- Das Token steht bei WebSocket-Verbindungen in der Adresse (`/ws?token=…`)
  und landet damit im Zugriffsprotokoll des Proxys. Browser können bei
  WebSockets keine Kopfzeilen setzen, deshalb geht es nicht anders. Wer das
  nicht will, dreht für diesen Host die Protokollierung ab.
- Ein Fehler im Hub, in FastAPI oder in einer Integration ist ab jetzt von
  aussen erreichbar. Beim VPN-Weg war er das nicht.
