# Fernzugriff: HomePilot auch unterwegs

Die App spricht den Hub direkt über seine lokale Adresse an
(`http://<hub-ip>:8123`). Unterwegs erreichst du die nicht – und einen Port
nach aussen öffnen wäre die falsche Lösung: Der Hub steuert Türen.

Der richtige Weg ist ein **VPN ins Heimnetz**. Zwei bewährte Varianten:

## Variante A: Tailscale (am einfachsten, ~15 Minuten)

Tailscale baut ein privates WireGuard-Netz zwischen deinen Geräten – ohne
Portweiterleitung, funktioniert auch hinter CGNAT.

1. Konto auf [tailscale.com](https://tailscale.com) anlegen (kostenlos für
   den Privatgebrauch).
2. **Auf dem Docker-Server** installieren:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   Den angezeigten Link öffnen und den Server dem Konto zuordnen.
3. **Auf dem iPhone** die Tailscale-App laden, mit demselben Konto anmelden.
4. Tailscale-IP des Servers nachsehen (`tailscale ip -4`, z.B.
   `100.101.102.103`).
5. In der HomePilot-App unter **Einstellungen → Konto & Verbindung** die
   Hub-Adresse auf `http://100.101.102.103:8123` ändern.

Damit funktioniert die App **überall** – zuhause wie unterwegs läuft der
Verkehr verschlüsselt übers Tailscale-Netz. (Zuhause geht es damit auch,
die lokale IP braucht es dann gar nicht mehr.)

**Tipp Familie:** Jedes Familien-Handy einmal in dasselbe Tailscale-Konto
aufnehmen – fertig. Für Gäste besser kein Tailscale, die bleiben im WLAN.

## Variante B: WireGuard auf der UniFi-Konsole

Deine UniFi-Konsole kann selbst WireGuard-Server spielen:

1. UniFi Network → **Einstellungen → VPN → VPN-Server → WireGuard** →
   aktivieren.
2. **Client hinzufügen** → QR-Code wird angezeigt.
3. Auf dem iPhone die **WireGuard-App** laden → Tunnel aus QR-Code
   importieren.
4. Wichtig: In der WireGuard-App beim Tunnel **On-Demand** aktivieren
   („ausser im Heim-WLAN"), dann verbindet er sich automatisch, sobald du
   das Haus verlässt.
5. Hub-Adresse in der HomePilot-App bleibt die **lokale IP** – durch den
   Tunnel bist du ja „zuhause".

Voraussetzung: eine öffentliche IPv4 oder DynDNS auf dem Anschluss; bei
CGNAT (manche Glasfaser-Anbieter) nimm Variante A.

## Was du NICHT tun solltest

- Port 8123 im Router freigeben – der Hub wäre offen im Internet, mit
  Türöffner.
- HTTP über fremde Tunnel-Dienste ohne Authentisierung schleifen.
