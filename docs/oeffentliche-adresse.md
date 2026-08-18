# Öffentliche Adresse für den Hub (Subdomain, Reverse Proxy)

Für die App brauchst du das **nicht** – dafür ist [VPN](fernzugriff.md) der
richtige Weg. Eine öffentliche Adresse braucht genau eine Sache: das
**Kamerabild in der Push-Nachricht**. Das Telefon zeigt die Meldung an,
lange bevor die App läuft; es holt das Bild also selbst, ohne VPN und ohne
Token.

## Der Hub bleibt zuhause

Er spricht per XML-RPC mit der CCU (samt Rückruf ins LAN), holt RTSP von den
Kameras, erreicht die Hue-Bridge lokal und findet Cast-Boxen per mDNS. Auf
einem Server im Rechenzentrum hätte er eine Oberfläche und kein einziges
Gerät dahinter. Der Server draussen ist nur die Eingangstür.

## Nur ein Pfad gehört nach draussen

Ohne Anmeldung erreichbar sind am Hub genau zwei Stellen:

| Pfad | Was dahinter steckt |
|---|---|
| `/api/health` | Ein Lebenszeichen, sonst nichts |
| `/api/push/image/{token}` | Ein einzelnes Standbild bzw. der Alarm-Mitschnitt, unter einer zufälligen Adresse aus 32 Bytes, zehn Minuten gültig |

Alles andere – Geräte schalten, Kameras live, Konfiguration, Benutzer –
verlangt ein Token. Trotzdem: **Gib nur `/api/push/image/` frei.** Ein
Türöffner hinter einem Passwort im offenen Internet ist etwas anderes als
ein Türöffner, den man von aussen gar nicht sieht. Der Rest läuft über VPN.

## Variante A: Dein Anschluss ist von aussen erreichbar

Wenn zuhause schon andere Seiten über den Nginx Proxy Manager laufen, hast
du Portweiterleitung und Zertifikate bereits – dann ist der Hetzner-Server
nur nötig, wenn du deine Heim-IP nicht preisgeben willst (siehe Variante B).

1. **DNS in der Hetzner-Konsole** (DNS → Zone der Domain → *Record
   hinzufügen*):

   | Feld | Wert |
   |---|---|
   | Type | `CNAME` |
   | Name | `homepilot` |
   | Value | der Name, auf den deine anderen Heim-Seiten schon zeigen |
   | TTL | `300` |

   **CNAME statt A-Record**, wenn deine anderen Seiten über einen
   DynDNS-Namen laufen: Dann pflegt der bestehende Updater die Adresse
   weiter, und dieser Eintrag stimmt für immer. Nur wenn du eine feste
   IPv4 hast, nimm einen `A`-Record mit dieser Adresse – bei einer
   wechselnden IP zeigt ein fester A-Record irgendwann ins Leere, und zwar
   still.
2. **UniFi**: Portweiterleitung 80 und 443 auf den Nginx Proxy Manager –
   die steht für die anderen Seiten schon.
3. **Nginx Proxy Manager** → *Proxy Hosts* → *Add Proxy Host*:
   - Domain: `homepilot.deinedomain.ch`
   - Scheme `http`, Forward Hostname: die **LAN-IP des Hubs**, Port `8123`
   - *Block Common Exploits* an, *Websockets* aus (die braucht nur die App,
     und die kommt über VPN)
   - Reiter *SSL*: Let's-Encrypt-Zertifikat anfordern, *Force SSL* an
4. Reiter **Advanced**, und das hier hinein:

   ```nginx
   # Alles ausser dem Bild zur Push-Nachricht gibt es hier nicht.
   # Eine Regex-Location sticht die von NPM erzeugte Prefix-Location –
   # der Bildpfad fällt durch und wird ganz normal weitergereicht.
   location ~ ^/(?!api/push/image/) {
       return 404;
   }
   ```

   Speichern. Meldet NPM einen Fehler, stimmt etwas an der Syntax – dann
   zuerst ohne diesen Block speichern und ihn danach ergänzen.

## Variante B: CGNAT, wechselnde IP, oder die Heim-IP soll geheim bleiben

Dann wird der Hetzner-Server die Eingangstür und ein WireGuard-Tunnel führt
nach Hause.

1. **WireGuard** zwischen Hetzner und dem Docker-Host zuhause – oder
   einfacher: [Tailscale](fernzugriff.md) auf beiden, dann hat der
   Hetzner-Server eine `100.x`-Adresse für den Hub.
2. **DNS**: Subdomain auf die Hetzner-IP.
3. **Nginx auf dem Hetzner-Server**, mit demselben Grundsatz:

   ```nginx
   server {
       listen 443 ssl http2;
       server_name homepilot.deinedomain.ch;

       # Zertifikate von certbot.
       ssl_certificate     /etc/letsencrypt/live/homepilot.deinedomain.ch/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/homepilot.deinedomain.ch/privkey.pem;

       # Nur das Bild zur Push-Nachricht. Der Rest existiert hier nicht.
       location /api/push/image/ {
           # Adresse des Hubs im Tunnel:
           proxy_pass http://100.101.102.103:8123;
           proxy_set_header Host $host;
           # Ein Alarm-Mitschnitt sind ein paar hundert Kilobyte.
           proxy_read_timeout 30s;
       }

       location / {
           return 404;
       }
   }
   ```

## Wenn Port 80 zu bleiben soll

Let's Encrypt prüft normalerweise über Port 80. Ist der bei dir zu (oder
willst du ihn zulassen), kann der Nginx Proxy Manager stattdessen über die
**DNS-API von Hetzner** prüfen – dann muss von aussen gar nichts erreichbar
sein, um an ein Zertifikat zu kommen:

1. Hetzner DNS → *API-Tokens* → Token erzeugen.
2. Im NPM beim Zertifikat **Use a DNS Challenge** → Provider `Hetzner` →
   Token einsetzen.

Für Variante A brauchst du das meist nicht – deine anderen Seiten holen
ihre Zertifikate ja schon über Port 80.

## Danach im Hub eintragen

In `/opt/homepilot/config.yaml`:

```yaml
push:
  public_url: https://homepilot.deinedomain.ch
```

Neu bauen und ausrollen. Ab dann bringt die Alarm-Meldung das Kamerabild
mit (auf Android sofort, auf iOS mit dem eigenen App-Build – siehe
[eigener-app-build.md](eigener-app-build.md)).

## Prüfen

Vom Handy **im Mobilfunknetz**, nicht im WLAN:

```
https://homepilot.deinedomain.ch/api/entities   → 404 (richtig so)
https://homepilot.deinedomain.ch/api/push/image/irgendwas → 404
```

Das zweite 404 heisst „die Kennung gibt es nicht" und ist genau das, was
auch eine abgelaufene Adresse liefert – von aussen ist beides nicht zu
unterscheiden, und das ist Absicht.

Ein echter Test geht nur über einen echten Alarm: auslösen, und die Meldung
muss das Bild zeigen.

## Was du weiterhin nicht tun solltest

- Port 8123 im Router freigeben.
- Die ganze API über die Subdomain freigeben, „weil ja ein Token nötig ist".
- Die Hub-Adresse in der App auf die Subdomain stellen – die App braucht den
  vollen Zugriff, und der gehört ins VPN.
