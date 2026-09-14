"""Wer den Haushalt verlässt, hinterlässt alles - hier wird es aufgeräumt.

Punkt 628 der Werkbank. ``DELETE /api/users/{name}`` rief nur
``hub.users.remove`` und schrieb einen Änderungseintrag. Was nach Namen
abgelegt ist, blieb liegen: Sitzungen, angemeldete Telefone, Push- und
Oberflächen-Einstellungen, die Anmelde-Adresse, die Ortungszone samt
Verlauf - und die Ämtli-Reihen. Zog die Au-pair aus, stand sie im
Ämtli-Plan weiter «dran», und ``chores.rotate`` gab ihr die nächste Woche
gleich wieder.

Das Gegenstück zu ``umzug.py``: Dort wandert ein Mensch von einem Namen
zum anderen, hier verlässt er den Datenbestand. Die Listen, die einen
Namen tragen, sind dieselben - sie werden von dort wiederverwendet, damit
eine neue Liste nicht an der einen Stelle mitzieht und an der anderen
liegen bleibt.

Zwei Dinge sind bewusst *nicht* dabei: Was jemand hinterlassen hat, das
den anderen gehört - ein Rezept mit ``author``, ein Eintrag «von Anna» im
Verlauf -, bleibt stehen. Ein Kochbuch verliert seine Rezepte nicht,
weil die Köchin auszieht. Und die Ämtli werden nicht gelöscht, sondern
übergeben: Der Abfall muss weiter raus.

Rein bis auf die Uhr: Hinein kommt der Datenbestand, heraus ein neuer
plus ein Bericht. Wer schreibt, ist die Route (api/routes/users.py).
"""

from __future__ import annotations

from typing import Any

from . import chores, umzug

#: Listen, aus denen die Zeilen eines Namens verschwinden. ``users`` selbst
#: nicht - den Benutzer entfernt ``hub.users.remove``, mit seinen eigenen
#: Regeln (letzter Besitzer, config.yaml).
NAMENSLISTEN: tuple[tuple[str, str], ...] = tuple(
    (schluessel, feld) for schluessel, feld in umzug.NAMENSLISTEN if schluessel != "users"
)

#: Listen, in denen ein Name in einer Reihe steht - die aus ``umzug`` plus
#: die Empfängerliste der Erinnerungen (core/erinnerungen.py).
REIHEN: tuple[str, ...] = (*umzug.FAMILIENREIHEN, "push_an")

#: Was in der Bilanz als Satzteil steht: Schlüssel → (Einzahl, Mehrzahl).
WORTE: dict[str, tuple[str, str]] = {
    "geraete": ("Gerät", "Geräte"),
    "push_geraete": ("Push-Telefon", "Push-Telefone"),
    "aemtli": ("Ämtli", "Ämtli"),
    "aufgaben": ("Aufgabe", "Aufgaben"),
    "erinnerungen": ("Erinnerung", "Erinnerungen"),
    "punkte": ("Punktekonto", "Punktekonten"),
    "ortung": ("Ortungsspur", "Ortungsspuren"),
    "einstellungen": ("Einstellung", "Einstellungen"),
}


def _zeilen(data: dict[str, Any], schluessel: str) -> list[Any]:
    rows = data.get(schluessel)
    return rows if isinstance(rows, list) else []


def _traegt(row: Any, name: str) -> bool:
    """Steht dieser Name irgendwo in der Familienzeile - als Zuständiger,
    in einer Reihe oder als Stimme? (rein)"""
    if not isinstance(row, dict):
        return False
    if str(row.get("member") or "") == name:
        return True
    for feld in REIHEN:
        werte = row.get(feld)
        if isinstance(werte, list) and any(str(w) == name for w in werte):
            return True
    stimmen = row.get("votes")
    return isinstance(stimmen, dict) and name in stimmen


def bilanz(data: dict[str, Any], name: str, zone: str = "") -> dict[str, int]:
    """Was ein Name im Datenbestand berührt (rein, testbar).

    Die Zahlen, die vor dem Löschen auf dem Blatt stehen: «Anna
    entfernen? 2 Geräte, 3 Ämtli, 1 Erinnerung». Ein Löschen, das sagt,
    was es mitnimmt, wird gelesen; eines, das schweigt, wird bereut.
    """
    name = str(name or "").strip()
    if not name:
        return {}
    zaehlung = {
        "geraete": sum(
            1 for row in _zeilen(data, "sessions")
            if isinstance(row, dict) and str(row.get("user") or "") == name
        ),
        "push_geraete": sum(
            1 for row in _zeilen(data, "push_devices")
            if isinstance(row, dict) and str(row.get("user") or "") == name
        ),
        "einstellungen": sum(
            1
            for schluessel, feld in NAMENSLISTEN
            if schluessel not in ("sessions", "push_devices")
            for row in _zeilen(data, schluessel)
            if isinstance(row, dict) and str(row.get(feld) or "") == name
        ),
        "ortung": sum(
            1
            for schluessel, feld in umzug.ZONENLISTEN
            for row in _zeilen(data, schluessel)
            if zone and isinstance(row, dict) and str(row.get(feld) or "") == zone
        ),
        "aemtli": sum(1 for row in _zeilen(data, "family_chores") if _traegt(row, name)),
        "aufgaben": sum(
            1 for row in _zeilen(data, "family_tasks")
            if isinstance(row, dict) and str(row.get("member") or "") == name
        ),
        "erinnerungen": sum(
            1 for row in _zeilen(data, "family_reminders") if _traegt(row, name)
        ),
        "punkte": sum(
            1 for row in _zeilen(data, "family_rewards")
            if isinstance(row, dict) and str(row.get("member") or "") == name
        ),
    }
    return {schluessel: anzahl for schluessel, anzahl in zaehlung.items() if anzahl}


def satz(name: str, bilanz_: dict[str, int], bild: bool = False) -> str:
    """«Anna entfernen? 2 Geräte, Bild, 3 Ämtli, 1 Erinnerung» (rein, testbar).

    Dieselbe Reihenfolge wie in WORTE - was man von Hand nachholen
    müsste, steht vorn.
    """
    def teil(schluessel: str) -> str:
        anzahl = int(bilanz_.get(schluessel) or 0)
        einzahl, mehrzahl = WORTE[schluessel]
        return f"{anzahl} {einzahl if anzahl == 1 else mehrzahl}"

    geraete = ("geraete", "push_geraete")
    teile = [
        *(teil(k) for k in geraete if int(bilanz_.get(k) or 0) > 0),
        *(["Bild"] if bild else []),
        *(teil(k) for k in WORTE if k not in geraete and int(bilanz_.get(k) or 0) > 0),
    ]
    if not teile:
        return f"{name} entfernen? An diesem Namen hängt sonst nichts."
    return f"{name} entfernen? {', '.join(teile)}"


def uebernehmer(reihe: list[Any], name: str, wunsch: str = "") -> str | None:
    """Wer ein Ämtli übernimmt, wenn ``name`` geht (rein, testbar).

    Der Wunsch des Verwalters zuerst - er kennt die Familie. Ohne Wunsch
    rückt die Reihe weiter, wie beim Abhaken (chores.rotate), nur ohne die
    Person, die geht. Bleibt niemand übrig, bleibt das Ämtli ohne
    Zuständigen stehen - besser sichtbar leer als still bei jemandem, der
    nicht mehr da ist.
    """
    wunsch = str(wunsch or "").strip()
    if wunsch and wunsch != name:
        return wunsch
    rest = [str(m).strip() for m in reihe if str(m).strip() and str(m).strip() != name]
    return chores.rotate(rest, name)


def _familienzeile(row: dict[str, Any], schluessel: str, name: str, aemtli_an: str) -> dict[str, Any]:
    geaendert = dict(row)
    if str(geaendert.get("member") or "") == name:
        if schluessel == "family_chores":
            reihe = geaendert.get("members")
            geaendert["member"] = uebernehmer(
                reihe if isinstance(reihe, list) else [], name, aemtli_an
            )
        elif schluessel == "family_tasks":
            geaendert["member"] = aemtli_an or None
    for feld in REIHEN:
        werte = geaendert.get(feld)
        if isinstance(werte, list) and any(str(w) == name for w in werte):
            geaendert[feld] = [w for w in werte if str(w) != name]
    stimmen = geaendert.get("votes")
    if isinstance(stimmen, dict) and name in stimmen:
        stimmen = dict(stimmen)
        stimmen.pop(name)
        geaendert["votes"] = stimmen
    return geaendert


def abschied(
    data: dict[str, Any], name: str, zone: str = "", aemtli_an: str = ""
) -> tuple[dict[str, Any], dict[str, int]]:
    """Alles, was an einem Namen hängt, aus dem Datenbestand nehmen
    (rein, testbar).

    Zurück kommen der neue Bestand und ein Bericht «Liste → Anzahl
    geänderter Zeilen» - wie bei ``umzug.umziehen``: Ein Werkzeug, das
    schweigend etwas entfernt, prüft niemand nach.

    ``aemtli_an`` ist, wer die Ämtli und offenen Aufgaben übernimmt.
    Punktekonten fallen weg - Punkte ohne Person sind niemandes Punkte.
    """
    name = str(name or "").strip()
    if not name:
        return dict(data), {}
    aemtli_an = str(aemtli_an or "").strip()
    ergebnis = dict(data)
    bericht: dict[str, int] = {}

    def zaehlen(schluessel: str, anzahl: int) -> None:
        if anzahl:
            bericht[schluessel] = anzahl

    for schluessel, feld in NAMENSLISTEN:
        rows = _zeilen(ergebnis, schluessel)
        if not rows:
            continue
        rest = [
            row for row in rows
            if not (isinstance(row, dict) and str(row.get(feld) or "") == name)
        ]
        zaehlen(schluessel, len(rows) - len(rest))
        ergebnis[schluessel] = rest

    if zone:
        for schluessel, feld in umzug.ZONENLISTEN:
            rows = _zeilen(ergebnis, schluessel)
            if not rows:
                continue
            rest = [
                row for row in rows
                if not (isinstance(row, dict) and str(row.get(feld) or "") == zone)
            ]
            zaehlen(schluessel, len(rows) - len(rest))
            ergebnis[schluessel] = rest

    for schluessel, rows in list(ergebnis.items()):
        if not schluessel.startswith("family_") or not isinstance(rows, list):
            continue
        if schluessel == "family_rewards":
            rest = [
                row for row in rows
                if not (isinstance(row, dict) and str(row.get("member") or "") == name)
            ]
            zaehlen(schluessel, len(rows) - len(rest))
            ergebnis[schluessel] = rest
            continue
        neue = [
            _familienzeile(row, schluessel, name, aemtli_an) if isinstance(row, dict) else row
            for row in rows
        ]
        zaehlen(schluessel, sum(1 for a, b in zip(rows, neue, strict=True) if a != b))
        ergebnis[schluessel] = neue

    return ergebnis, bericht
