"""Wiederkehrende Aufgaben und die Ämtli-Rotation.

Zwei Dinge, die eine Familienliste erst tragfähig machen:

*Wiederholung.* «Jeden Montag Abfall» einmal eintragen statt jede Woche
neu. Beim Abhaken rückt die Frist weiter, statt dass der Eintrag
verschwindet – der Haushalt hört ja nicht auf.

*Rotation.* Wer diese Woche das Bad putzt, entscheidet keine Diskussion,
sondern die Reihe. Damit niemand Buch führen muss, rückt sie von selbst
weiter, sobald das Ämtli erledigt ist.

Beides sind reine Rechenfunktionen: Aus einem Eintrag und dem heutigen
Datum wird der nächste. Das lässt sich prüfen, ohne eine Uhr zu stellen.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

# Was als Wiederholung erlaubt ist. «none» heisst: einmalig, wie bisher.
REPEATS = ("none", "daily", "weekly", "monthly")


def parse_date(value: Any) -> date | None:
    """«2026-08-20» → date. Alles andere → None (rein)."""
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        year, month, day = (int(part) for part in text.split("-"))
        return date(year, month, day)
    except (ValueError, TypeError):
        return None


def add_months(start: date, months: int) -> date:
    """Monate addieren, ohne über das Monatsende zu stolpern (rein).

    Der 31. Januar plus einen Monat ist der 28. Februar – nicht der 3.
    März. Wer eine Frist auf den Monatsletzten legt, meint den Letzten.
    """
    month = start.month - 1 + months
    year = start.year + month // 12
    month = month % 12 + 1
    # Rückwärts suchen, bis der Tag im Monat existiert.
    for day in range(start.day, 0, -1):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    return date(year, month, 1)


def next_due(current: Any, repeat: str, today: date | None = None) -> str | None:
    """Die nächste Fälligkeit nach dem Abhaken (rein, testbar).

    Gerechnet wird ab der bisherigen Frist, nicht ab heute: Wer den
    Montags-Abfall am Dienstag abhakt, soll nicht künftig dienstags
    daran erinnert werden. Liegt die Frist aber schon in der
    Vergangenheit, wird so lange weitergerückt, bis sie in der Zukunft
    liegt – sonst stapelten sich nach zwei Wochen Ferien vierzehn
    überfällige Einträge.
    """
    if repeat not in REPEATS or repeat == "none":
        return None
    heute = today or date.today()
    basis = parse_date(current) or heute
    schritt = {"daily": 1, "weekly": 7}.get(repeat)

    # Immer ab dem Ausgangsdatum rechnen, nie ab dem zuletzt errechneten:
    # Sonst wandert eine Frist auf dem 31. über den Februar (28.) für
    # immer auf den 28. - der geklammerte Tag wäre der neue Ausgangswert.
    for schritte in range(1, 400):
        if repeat == "monthly":
            nächste = add_months(basis, schritte)
        else:
            nächste = basis + timedelta(days=(schritt or 1) * schritte)
        if nächste > heute:
            return nächste.isoformat()
    return basis.isoformat()


def repeat_label(repeat: str) -> str:
    """Wie die Wiederholung heisst (rein)."""
    return {
        "daily": "täglich",
        "weekly": "wöchentlich",
        "monthly": "monatlich",
    }.get(repeat, "einmalig")


def rotate(members: list[str], current: Any) -> str | None:
    """Wer ist als Nächstes dran? (rein, testbar)

    Steht die aktuelle Person nicht (mehr) in der Reihe – etwa weil
    jemand ausgezogen ist –, beginnt die Reihe wieder vorn, statt
    stehenzubleiben.
    """
    people = [str(name).strip() for name in members if str(name).strip()]
    if not people:
        return None
    if len(people) == 1:
        return people[0]
    try:
        index = people.index(str(current))
    except ValueError:
        return people[0]
    return people[(index + 1) % len(people)]


def due_soon(item: dict[str, Any], today: date | None = None) -> bool:
    """Ist dieser Eintrag heute oder überfällig? (rein)"""
    if item.get("done"):
        return False
    frist = parse_date(item.get("due"))
    return frist is not None and frist <= (today or date.today())
