"""QR-Code für die Einrichtung der App.

IP-Adresse und Token von Hand abzutippen ist der unschönste Moment der
App – ausgerechnet der erste. Der Hub zeigt beim Start stattdessen einen
QR-Code im Terminal, den die App einscannt.

Bewusst ohne Zusatzpaket: Der Code wird selbst erzeugt und mit
Halbblock-Zeichen ausgegeben, damit er in einer üblichen Terminalhöhe
Platz hat.
"""

from __future__ import annotations

import json
import socket

from .core.users import Role, UserRegistry


def wifi_payload(
    ssid: str, password: str = "", hidden: bool = False, open_network: bool = False
) -> str:
    """Der Standard-WLAN-QR-Inhalt, den Telefonkameras verstehen (rein).

    Sonderzeichen werden nach Vorschrift entwertet - ein Passwort mit
    Semikolon ist sonst ein kaputter Code statt ein sicheres Passwort.

    ``open_network`` ist der Captive-Portal-Fall (z.B. UniFi-Hotspot):
    Das Netz selbst ist offen, der QR verbindet nur - das Passwort fragt
    danach die Anmeldeseite ab, nicht das WLAN.
    """
    def escape(text: str) -> str:
        for char in ("\\", ";", ",", ":", '"'):
            text = text.replace(char, "\\" + char)
        return text

    if open_network:
        parts = f"WIFI:T:nopass;S:{escape(ssid)};"
    else:
        parts = f"WIFI:T:WPA;S:{escape(ssid)};P:{escape(password)};"
    if hidden:
        parts += "H:true;"
    return parts + ";"


def local_ip() -> str:
    """Die Adresse, unter der andere Geräte im Netz den Hub erreichen."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            # Es wird nichts gesendet; das Ziel bestimmt nur die Route.
            sock.connect(("192.168.1.1", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def setup_payload(host: str, port: int, token: str, name: str) -> str:
    address = local_ip() if host in ("0.0.0.0", "::", "") else host
    return json.dumps(
        {"url": f"http://{address}:{port}", "token": token, "name": name},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def render(text: str) -> str | None:
    """Zeichnet den QR-Code; ohne das Paket ``qrcode`` gibt es None."""
    try:
        import qrcode
    except ImportError:
        return None

    code = qrcode.QRCode(border=1)
    code.add_data(text)
    code.make(fit=True)
    matrix = code.get_matrix()

    # Zwei Zeilen je Textzeile über Halbblöcke, sonst wird der Code doppelt
    # so hoch wie nötig und passt in kein Terminal.
    lines = []
    for top in range(0, len(matrix), 2):
        row = ""
        for column in range(len(matrix[top])):
            upper = matrix[top][column]
            lower = matrix[top + 1][column] if top + 1 < len(matrix) else False
            if upper and lower:
                row += "█"
            elif upper:
                row += "▀"
            elif lower:
                row += "▄"
            else:
                row += " "
        lines.append(row)
    return "\n".join(lines)


def svg(text: str, size: int = 240) -> str | None:
    """Denselben Code als eingebettetes SVG - für die Gästeseite.

    ``render`` oben zeichnet mit Halbblöcken fürs Terminal; im Browser
    braucht es ein Bild. Eingebettet und nicht als Datei: Die Seite, auf
    der es steht, muss auch dann vollständig sein, wenn vom Hub sonst
    nichts erreichbar ist (siehe api/invitepage.py).

    Ein Rechteck je dunkles Feld wäre die naheliegende Lösung und
    ergäbe ein paar hundert Elemente. Stattdessen wird je Zeile ein Pfad
    gezogen; das Ergebnis ist ein Bruchteil so gross und zeichnet
    schneller.
    """
    try:
        import qrcode
    except ImportError:  # pragma: no cover - qrcode ist Grundabhängigkeit
        return None

    code = qrcode.QRCode(border=2)
    code.add_data(text)
    code.make(fit=True)
    matrix = code.get_matrix()
    kanten = len(matrix)
    pfad = []
    for y, zeile in enumerate(matrix):
        x = 0
        while x < kanten:
            if not zeile[x]:
                x += 1
                continue
            start = x
            while x < kanten and zeile[x]:
                x += 1
            pfad.append(f"M{start} {y}h{x - start}v1h-{x - start}z")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {kanten} {kanten}" shape-rendering="crispEdges" '
        'role="img" aria-label="QR-Code">'
        f'<rect width="{kanten}" height="{kanten}" fill="#fff"/>'
        f'<path d="{"".join(pfad)}" fill="#000"/></svg>'
    )


def setup_hint(users: UserRegistry, host: str, port: int) -> str:
    """Text samt QR-Code, den der Hub beim Start ausgibt."""
    owner = next(
        (user for user in users.users if user.role == Role.OWNER), None
    )
    if owner is None:
        return (
            "Kein Benutzer konfiguriert – die API ist offen. Für die App: "
            f"http://{local_ip()}:{port} ohne Token."
        )

    payload = setup_payload(host, port, owner.token, owner.name)
    code = render(payload)
    address = local_ip() if host in ("0.0.0.0", "::", "") else host
    lines = [
        "",
        f"App einrichten – Hub-URL: http://{address}:{port}   Benutzer: {owner.name}",
    ]
    if code:
        lines += ["In der App auf „QR-Code scannen“ tippen:", "", code]
    else:
        lines.append("(Für den QR-Code: pip install qrcode)")
    lines.append("")
    return "\n".join(lines)
