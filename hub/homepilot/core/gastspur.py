"""Was ein abgelaufener Gast hinterlässt - und wann es weggeht.

Punkt 498 der Werkbank. Ein Gastpass läuft ab (Punkt 246), und das tut
er zuverlässig: ``User.active()`` lässt ihn nicht mehr herein, und in
der Liste bleibt er sichtbar, statt spurlos zu verschwinden - sonst
rätselt man, wem man den Zugang gegeben hat. Das ist richtig so.

Was dabei *nicht* aufhört, ist alles daneben:

- **Die offene Sitzung.** Wer angemeldet war, bleibt es: Die Sitzung
  hängt am Token, nicht am Ablaufdatum des Benutzers. Der nächste Aufruf
  fällt zwar durch ``active()``, aber die Zeile liegt weiter da.
- **Der WLAN-Schein.** Er hat seine eigene Frist, und die hat mit dem
  Besuch nichts zu tun - ein Schein, der drei Wochen nach dem Gast noch
  gilt, ist ein offenes Netz für jemanden, der längst weg ist.
- **Das Zugriffsprotokoll.** Es soll bleiben; ein Protokoll, das sich
  selbst aufräumt, ist keines. Aber nach einem Jahr Gästen ist es die
  längste Liste im Haus, und die Namen darin gehören Leuten, die es
  nicht mehr gibt.

Hier steht nur das Rechnen: Welche Spuren gehören zu abgelaufenen
Gästen, und welche davon dürfen weg. Wer löscht, ist der Wächter.
"""

from __future__ import annotations

from typing import Any

#: So lange nach dem Ablauf bleibt alles liegen.
#:
#: Vierzehn Tage: lang genug, dass ein verlängerter Besuch nicht bei
#: null anfängt («doch noch eine Woche»), kurz genug, dass ein Schein
#: nicht den ganzen Sommer gilt. Die Zahl ist grosszügig, weil der
#: Fehler in die eine Richtung ärgerlich und in die andere ein offenes
#: Netz ist.
NACHFRIST_TAGE = 14


def abgelaufene_gaeste(users: Any, heute: str, nachfrist: int = NACHFRIST_TAGE) -> list[str]:
    """Die Namen der Gäste, deren Frist lange genug vorbei ist (rein).

    ``heute`` als «YYYY-MM-DD» - dieselbe Schreibweise wie ``expires``
    am Benutzer, damit der Vergleich ein Zeichenketten-Vergleich bleibt
    und keine Zeitzone braucht.

    Nur die Rolle «gast» und nur mit Frist: Ein Gast ohne Ablaufdatum ist
    einer, den jemand bewusst so angelegt hat - der verschwindet nicht,
    weil ein Aufräumer das für eine gute Idee hält.
    """
    raus: list[str] = []
    for user in users or []:
        if str(getattr(user, "role", "") or "") != "gast":
            continue
        frist = str(getattr(user, "expires", "") or "")
        if not frist:
            continue
        if _tage_seit(frist, heute) >= max(0, int(nachfrist)):
            name = str(getattr(user, "name", "") or "")
            if name:
                raus.append(name)
    return sorted(raus)


def _tage_seit(frist: str, heute: str) -> int:
    """Wie viele Tage seit der Frist vergangen sind - negativ, wenn sie
    noch läuft. Unlesbares zählt als «läuft noch»: Ein Tippfehler im
    Datum soll keinen Zugang löschen."""
    from datetime import date

    try:
        a = date.fromisoformat(frist[:10])
        b = date.fromisoformat(heute[:10])
    except ValueError:
        return -1
    return (b - a).days


def sitzungen_ohne(rows: Any, namen: list[str]) -> list[dict[str, Any]]:
    """Die Sitzungen ohne die dieser Personen (rein, testbar).

    Die Sitzung hängt am Token, nicht am Ablaufdatum des Benutzers - wer
    angemeldet war, blieb es, und die Zeile lag weiter da. Der nächste
    Aufruf wäre ohnehin durch ``active()`` gefallen; weg muss sie
    trotzdem, sonst wächst die Liste mit jedem Besuch.
    """
    weg = {str(name) for name in namen or []}
    return [
        row
        for row in rows or []
        if not (isinstance(row, dict) and str(row.get("user") or "") in weg)
    ]


def scheine_ohne(scheine: Any, namen: list[str]) -> list[dict[str, Any]]:
    """Die WLAN-Scheine ohne die dieser Personen (rein, testbar).

    Ein Schein, der drei Wochen nach dem Gast noch gilt, ist ein offenes
    Netz für jemanden, der längst weg ist - und niemand sieht ihm an, zu
    wem er gehörte.
    """
    weg = {str(name) for name in namen or []}
    return [
        schein
        for schein in scheine or []
        if not (isinstance(schein, dict) and str(schein.get("fuer") or "") in weg)
    ]


def bericht(namen: list[str], sitzungen: int, scheine: int) -> str | None:
    """Was im Protokoll steht, wenn aufgeräumt wurde (rein, testbar).

    ``None``, wenn es nichts zu berichten gab - eine Zeile «0 Spuren
    entfernt» ist eine Zeile, die man wegliest und die dann auch die
    echte wegliest.
    """
    if not namen:
        return None
    wer = ", ".join(namen[:3]) + (f" und {len(namen) - 3} weitere" if len(namen) > 3 else "")
    teile = []
    if sitzungen:
        teile.append(f"{sitzungen} Sitzung(en)")
    if scheine:
        teile.append(f"{scheine} WLAN-Schein(e)")
    was = ", ".join(teile) if teile else "keine offenen Spuren"
    return f"Abgelaufene Gäste aufgeräumt ({wer}): {was}."
