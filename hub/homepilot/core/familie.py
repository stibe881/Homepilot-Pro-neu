"""Erinnerungen, die aus den Familien-Listen entstehen.

Drei Dinge, die man aufschreibt und dann trotzdem vergisst: die Gabe am
Abend, den Geburtstag am Morgen, und dass das Notfallblatt seit zwei
Jahren nicht mehr angesehen wurde. Alles drei steht bereits im Hub - es
fehlte nur der Anstoss von aussen.

Hier steht ausschliesslich das Rechnen. Wer die Nachricht schickt, ist
der Wächter; wer die Daten pflegt, ist die App.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

# Die Tageszeiten einer Kur und die Stunde, ab der sie fällig sind.
# Bewusst grob: «morgens» ist keine Uhrzeit, sondern der Teil des Tages,
# in dem man daran denken soll. Wer es genauer braucht, stellt sich einen
# Wecker - und wer eine Erinnerung auf die Minute bekäme, schaltete sie
# nach drei Tagen ab.
SLOTS: list[tuple[str, int]] = [
    ("morgens", 8),
    ("mittags", 12),
    ("abends", 18),
    ("nachts", 22),
]
SLOT_NAMES = [name for name, _ in SLOTS]


def slots_of(med: dict[str, Any]) -> list[str]:
    """Zu welchen Tageszeiten diese Kur ansteht (rein, testbar).

    Ohne Angabe einmal täglich morgens - so war es, bevor es mehrere
    Gaben gab, und so bleibt es für alles, was schon eingetragen ist.
    """
    roh = med.get("times")
    if not isinstance(roh, list):
        return ["morgens"]
    gewaehlt = [str(name) for name in roh if str(name) in SLOT_NAMES]
    return sorted(set(gewaehlt), key=SLOT_NAMES.index) or ["morgens"]


def taken_map(med: dict[str, Any]) -> dict[str, list[str]]:
    """Was wann genommen wurde, in einer Form (rein, testbar).

    Früher war `taken` eine Liste von Tagen - ein Haken je Tag. Diese
    Einträge gibt es noch, und sie sollen weiter stimmen: Ein abgehakter
    Tag von damals gilt als vollständig genommen.
    """
    roh = med.get("taken")
    if isinstance(roh, dict):
        return {
            str(tag): [str(name) for name in werte if str(name) in SLOT_NAMES]
            for tag, werte in roh.items()
            if isinstance(werte, list)
        }
    if isinstance(roh, list):
        return {str(tag): list(slots_of(med)) for tag in roh}
    return {}


def days_done(med: dict[str, Any]) -> int:
    """Wie viele Tage der Kur vollständig erledigt sind (rein, testbar)."""
    noetig = set(slots_of(med))
    return sum(1 for genommen in taken_map(med).values() if noetig <= set(genommen))


def is_finished(med: dict[str, Any]) -> bool:
    """Ist die Kur durch? (rein, testbar)

    Eine Kur über zehn Tage endet nach zehn vollständigen Tagen von
    selbst - sonst erinnerte sie bis in alle Ewigkeit weiter.
    """
    if med.get("done"):
        return True
    tage = int(med.get("days") or 0)
    return tage > 0 and days_done(med) >= tage


def open_slots(med: dict[str, Any], tag: str, stunde: int) -> list[str]:
    """Welche Gaben heute noch offen und schon fällig sind (rein, testbar).

    «Schon fällig» ist wichtig: Die Abendgabe um acht Uhr morgens zu
    melden, macht aus einer Erinnerung eine Liste, die man wegwischt.
    """
    if is_finished(med):
        return []
    genommen = set(taken_map(med).get(tag, []))
    return [
        name
        for name, ab in SLOTS
        if name in slots_of(med) and name not in genommen and stunde >= ab
    ]


def describe(med: dict[str, Any], slots: list[str]) -> str:
    """Eine Zeile für die Nachricht (rein, testbar)."""
    teile = [str(med.get("text") or "Medikament")]
    if med.get("dose"):
        teile.append(str(med["dose"]))
    wer = str(med.get("member") or "").strip()
    kopf = " ".join(teile)
    zeit = "/".join(slots)
    return f"{kopf} – {zeit}" + (f" für {wer}" if wer else "")


def due_medications(
    meds: list[dict[str, Any]], tag: str, stunde: int
) -> list[tuple[dict[str, Any], list[str]]]:
    """Welche Kuren jetzt eine Erinnerung brauchen (rein, testbar)."""
    faellig = []
    for med in meds or []:
        if not isinstance(med, dict):
            continue
        offen = open_slots(med, tag, stunde)
        if offen:
            faellig.append((med, offen))
    return faellig


def _birthday_parts(value: Any) -> tuple[int, int] | None:
    """Tag und Monat aus «TT.MM.JJJJ», «TT.MM.» oder «JJJJ-MM-TT» (rein)."""
    text = str(value or "").strip()
    if not text:
        return None
    teile = text.replace("-", ".").split(".")
    zahlen = [teil for teil in teile if teil.isdigit()]
    if len(zahlen) < 2:
        return None
    if len(zahlen[0]) == 4:  # JJJJ-MM-TT
        return (int(zahlen[2]), int(zahlen[1]))
    return (int(zahlen[0]), int(zahlen[1]))


def birthdays_on(contacts: list[dict[str, Any]], tag: date) -> list[dict[str, Any]]:
    """Wer heute Geburtstag hat (rein, testbar).

    Das Jahr ist gleichgültig - gefeiert wird der Tag. Am 29. Februar
    Geborene bekommen ihren Gruss am 28., weil das häufigere Verhalten
    «gar nicht» die schlechtere Antwort ist.
    """
    treffer = []
    for contact in contacts or []:
        if not isinstance(contact, dict):
            continue
        teile = _birthday_parts(contact.get("birthday"))
        if teile is None:
            continue
        tag_im_monat, monat = teile
        if (tag_im_monat, monat) == (tag.day, tag.month) or (
            (tag_im_monat, monat) == (29, 2)
            and (tag.day, tag.month) == (28, 2)
            and not _ist_schaltjahr(tag.year)
        ):
            treffer.append(contact)
    return treffer


def _ist_schaltjahr(jahr: int) -> bool:
    return jahr % 4 == 0 and (jahr % 100 != 0 or jahr % 400 == 0)


def emergency_stale(checked: Any, heute: date, monate: int = 12) -> bool:
    """Ist das Notfallblatt zu lange nicht angesehen worden? (rein, testbar)

    Ein Blatt von vorletztem Jahr ist gefährlicher als keines: Man
    verlässt sich darauf, und die Nummer der Kinderärztin stimmt nicht
    mehr. Nie geprüft zählt als fällig - aber nur, wenn überhaupt etwas
    darauf steht.
    """
    if not checked:
        return True
    try:
        zuletzt = datetime.fromisoformat(str(checked)[:10]).date()
    except ValueError:
        return True
    return (heute - zuletzt).days >= monate * 30
