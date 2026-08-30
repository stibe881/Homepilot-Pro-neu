"""Gäste-WLAN: einen Gutschein ziehen, statt einen Zettel weiterzureichen.

Besuch fragt nach dem WLAN. Bisher gab es dafür zwei halbe Antworten:
den QR-Code aus der ``config.yaml`` (der ins offene Gästenetz führt,
mehr nicht) und den Gutschein-Spender in der App - den aber nur bedienen
kann, wer selbst ein Konto hat. Der Gast steht daneben und wartet, bis
jemand ihm einen Code vorliest.

Hier steht der dritte Weg: ein **Aufkleber mit einem QR-Code**, den der
Gast mit der ganz normalen Kamera scannt. Er landet auf einer Seite des
Hubs, drückt einen Knopf und bekommt seinen eigenen Gutschein - gültig
für zwölf Stunden, einmal einlösbar.

**Warum ein Link und nicht der Code selbst im QR.** Ein Gutschein im
Aufkleber wäre *ein* Gutschein: Der Erste löst ihn ein, und weil er
einmalig ist (UniFi ``quota: 1``), steht der Zweite vor einer toten
Karte. Der Aufkleber trägt deshalb nur die Adresse; gezogen wird bei
jedem Besuch neu.

**Warum der Knopf und nicht schon beim Aufrufen.** Dieselbe Falle wie
beim Einmal-Link für die Türe (core/guestpass.py): Wer eine Adresse
teilt, dessen Vorschau bauen Messenger, Mailserver und Virenscanner,
indem sie sie abrufen. Ein GET, der einen Gutschein zieht, verbrennt
also Gutscheine, bevor ein Mensch die Seite gesehen hat. Also: GET
zeigt, POST zieht.

**Warum zwölf Stunden ab dem Ziehen und nicht ab der Anmeldung.** Der
Controller kann von sich aus nur das Zweite: Die Uhr startet, wenn sich
jemand anmeldet. Ein gezogener, nie benutzter Code läge dann für immer
herum - und der abfotografierte Aufkleber von letztem Sommer wäre eine
Dauerkarte. Deshalb führt der Hub Buch und räumt selbst auf (siehe
watchdog._check_wlanscheine).
"""

from __future__ import annotations

import secrets
import time
from typing import Any

from ..qr import svg as qr_svg

#: So lange gilt ein gezogener Gutschein - ab dem Ziehen.
GUELTIG_STUNDEN = 12

#: So viele dürfen gleichzeitig offen sein. Die Grenze ist keine
#: Sparmassnahme, sondern die Bremse für den Fall, dass jemand den
#: Aufkleber abfotografiert und die Seite hundertmal aufruft: Der
#: Controller füllte sich sonst mit Karteileichen.
HOECHSTENS_OFFEN = 25


def token_neu() -> str:
    """Das Geheimnis im Aufkleber.

    Lang genug, dass Durchprobieren aussichtslos ist - die Seite steht
    ohne Anmeldung im Netz, und die Adresse *ist* der Schutz. Wer den
    Aufkleber wechselt, zieht damit alle alten aus dem Verkehr.
    """
    return secrets.token_urlsafe(18)


def ablauf(schein: Any) -> float:
    """Wann dieser Gutschein verfällt (rein, testbar)."""
    if not isinstance(schein, dict):
        return 0.0
    try:
        gezogen = float(schein.get("drawn") or 0)
    except (TypeError, ValueError):
        return 0.0
    return gezogen + GUELTIG_STUNDEN * 3600


def abgelaufen(schein: Any, jetzt: float) -> bool:
    """Ist er über die zwölf Stunden hinaus? (rein, testbar)

    Ein Eintrag ohne brauchbaren Zeitpunkt gilt als abgelaufen: Was der
    Hub nicht datieren kann, kann er auch nicht verantworten - und ein
    Gutschein, der ewig gilt, weil sein Zeitstempel kaputt ist, ist
    genau das Gegenteil dessen, was hier gewollt ist.
    """
    return ablauf(schein) <= jetzt


def aufteilen(scheine: list[Any], jetzt: float) -> tuple[list[Any], list[Any]]:
    """(gültig, abgelaufen) - in dieser Reihenfolge (rein, testbar)."""
    gueltig = [s for s in scheine or [] if not abgelaufen(s, jetzt)]
    weg = [s for s in scheine or [] if abgelaufen(s, jetzt)]
    return gueltig, weg


def zu_viele(scheine: list[Any], jetzt: float, grenze: int = HOECHSTENS_OFFEN) -> bool:
    """Sind gerade zu viele offen? (rein, testbar)"""
    return len(aufteilen(scheine, jetzt)[0]) >= grenze


def eintragen(
    scheine: list[Any], voucher: dict[str, Any], jetzt: float, woher: str = ""
) -> list[dict[str, Any]]:
    """Einen frisch gezogenen Gutschein ins Buch schreiben (rein, testbar).

    Abgelaufene fliegen bei der Gelegenheit gleich raus - so bleibt die
    Liste auch dann kurz, wenn der Wächter einmal nicht dazu kam.
    """
    gueltig, _ = aufteilen(scheine, jetzt)
    neu = {
        "id": str(voucher.get("id") or ""),
        "code": str(voucher.get("code") or ""),
        "drawn": jetzt,
        # Nur zum Nachsehen, wer wie oft gezogen hat - eine Adresse ist
        # keine Person, und mehr als das steht hier bewusst nicht.
        "from": woher[:45],
    }
    return [neu, *gueltig]


def restsatz(schein: Any, jetzt: float) -> str:
    """«Noch 11 Std. 40 Min.» (rein, testbar).

    Die Restzeit und nicht die Uhrzeit des Verfalls: Wer den Code gerade
    bekommen hat, will wissen, wie lange er reicht, und nicht rechnen.
    """
    rest = max(0, int(ablauf(schein) - jetzt))
    if rest <= 0:
        return "Abgelaufen"
    stunden, minuten = divmod(rest // 60, 60)
    if stunden and minuten:
        return f"Noch {stunden} Std. {minuten} Min."
    if stunden:
        return f"Noch {stunden} Std."
    return f"Noch {minuten} Min."


# ── Die Seite, die der Gast sieht ────────────────────────────────────────
#
# Eingebettet, ohne Javascript, ohne Schriften und Bilder von aussen -
# aus demselben Grund wie bei der Einladungsseite (api/invitepage.py):
# Sie steht auf einem fremden Telefon, das gerade noch gar nicht im Netz
# ist, und muss vollständig ankommen oder gar nicht.

_STIL = (
    "*{box-sizing:border-box}"
    "body{margin:0;min-height:100vh;display:flex;align-items:center;"
    "justify-content:center;padding:24px;font:17px/1.5 -apple-system,"
    "BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
    "background:#12141a;color:#eef1f6}"
    ".k{width:100%;max-width:26rem;text-align:center}"
    "h1{font-size:1.5rem;margin:0 0 .6em}"
    "p{color:#aab2c0;margin:0 0 1.4em}"
    ".code{font:700 2.1rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;"
    "letter-spacing:.06em;background:#1b1f28;border:1px solid #2b3140;"
    "border-radius:16px;padding:18px 10px;margin:0 0 .6em;"
    "-webkit-user-select:all;user-select:all}"
    ".rest{font-size:.95rem;color:#8b93a3;margin:0 0 1.6em}"
    ".qr{background:#fff;border-radius:16px;padding:12px;display:inline-block;"
    "line-height:0;margin:0 0 1em}"
    "ol{text-align:left;color:#aab2c0;margin:0 0 1.2em;padding-left:1.3em}"
    "li{margin:0 0 .5em}"
    "button{width:100%;padding:20px;font-size:1.15rem;font-weight:600;"
    "color:#fff;background:#5b6cff;border:0;border-radius:16px;cursor:pointer}"
    "button:active{opacity:.85}"
)


def _huelle(titel: str, inhalt: str) -> str:
    return (
        "<!doctype html><html lang=de><meta charset=utf-8>"
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        f"<title>{titel}</title><style>{_STIL}</style>"
        f"<div class=k>{inhalt}</div>"
    )


def _text(wert: str) -> str:
    """Fremder Text gehört entwertet, bevor er in die Seite geht."""
    return (
        str(wert)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def frageseite(ssid: str) -> str:
    """Was der Gast nach dem Scannen sieht - noch ohne Gutschein."""
    netz = f" «{_text(ssid)}»" if ssid else ""
    return _huelle(
        "WLAN für Gäste",
        f"<h1>WLAN für Gäste</h1>"
        f"<p>Der Knopf holt dir einen eigenen Zugangscode fürs Netz{netz}. "
        f"Er gilt {GUELTIG_STUNDEN} Stunden und lässt sich einmal einlösen.</p>"
        '<form method="post" action=""><button type="submit">'
        "Code holen</button></form>",
    )


def codeseite(code: str, rest: str, ssid: str, wlan_qr: str | None) -> str:
    """Der gezogene Gutschein, so gross wie möglich.

    Der Code steht oben und in Festbreitenschrift: Er wird abgetippt,
    und «0» gegen «O» zu halten ist genau dann wichtig. Der QR darunter
    verbindet nur mit dem Netz - eingeloggt wird man damit nicht, das
    macht erst die Anmeldeseite, die danach von selbst aufgeht.
    """
    bild = f'<div class=qr>{wlan_qr}</div>' if wlan_qr else ""
    netz = _text(ssid) if ssid else "das Gästenetz"
    return _huelle(
        "Dein WLAN-Code",
        f"<h1>Dein WLAN-Code</h1>"
        f"<p class=code>{_text(code)}</p>"
        f"<p class=rest>{_text(rest)} gültig · einmal einlösbar</p>"
        f"{bild}"
        "<ol>"
        f"<li>Mit dem WLAN <b>{netz}</b> verbinden{' – QR oben scannen' if wlan_qr else ''}.</li>"
        "<li>Die Anmeldeseite geht von selbst auf.</li>"
        "<li>Dort den Code oben eintippen.</li>"
        "</ol>"
        "<p>Diese Seite kannst du offen lassen, bis du drin bist.</p>",
    )


def fehlerseite(titel: str, satz: str) -> str:
    """Alles, was schiefgehen kann - in derselben Form."""
    return _huelle(titel, f"<h1>{_text(titel)}</h1><p>{_text(satz)}</p>")


def wlanbild(payload: str) -> str | None:
    """Der WLAN-QR fürs Verbinden - eingebettet, siehe qr.svg."""
    return qr_svg(payload, size=200) if payload else None


def sticker_url(basis: str, token: str) -> str:
    """Die Adresse, die in den Aufkleber gehört (rein, testbar)."""
    return f"{str(basis or '').rstrip('/')}/gast/wlan/{token}"


def jetzt() -> float:
    """Damit Tests die Uhr stellen können, ohne `time` zu flicken."""
    return time.time()
