"""Erinnerungen, die aus den Familien-Listen entstehen.

Drei Dinge, die man aufschreibt und dann trotzdem vergisst: die Gabe am
Abend, den Geburtstag am Morgen, und dass das Notfallblatt seit zwei
Jahren nicht mehr angesehen wurde. Alles drei steht bereits im Hub - es
fehlte nur der Anstoss von aussen.

Hier steht ausschliesslich das Rechnen. Wer die Nachricht schickt, ist
der Wächter; wer die Daten pflegt, ist die App.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from . import schulferien

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


def birthdays_in(
    contacts: list[dict[str, Any]], tag: date, tage: int
) -> list[tuple[int, dict[str, Any]]]:
    """Wer in den nächsten Tagen Geburtstag hat (rein, testbar).

    Der Gruss am Morgen ist nett; was fehlte, war der Anstoss, der etwas
    auslöst. Drei Tage Vorlauf sind Zeit genug für ein Geschenk - und
    kurz genug, dass man es bis dahin nicht wieder vergisst.

    Zurück kommt (Tage bis dahin, Kontakt), aufsteigend sortiert.
    """
    treffer: list[tuple[int, dict[str, Any]]] = []
    for versatz in range(0, max(0, tage) + 1):
        ziel = tag + timedelta(days=versatz)
        for contact in birthdays_on(contacts, ziel):
            treffer.append((versatz, contact))
    return treffer


# Wie ein Geburtstags-Kalender seine Einträge benennt. Google schreibt
# «Livia hat Geburtstag» (oder englisch «Livia's birthday»), andere
# hängen ein Alter an. Für die Nachricht wollen wir den Namen - «Livia
# hat Geburtstag hat heute Geburtstag» liest niemand zweimal.
_KALENDER_ZUSAETZE = (
    " hat geburtstag",
    "'s birthday",
    "s birthday",
    " birthday",
    " geburtstag",
)


def birthday_name(summary: Any) -> str:
    """Der Name hinter einem Kalendereintrag (rein, testbar).

    Findet sich keiner der bekannten Zusätze, bleibt der Titel stehen:
    Ein unbekanntes Format falsch zu kürzen wäre schlimmer, als einmal
    «Livias 40.» vorzulesen.
    """
    text = " ".join(str(summary or "").split())
    klein = text.lower()
    for zusatz in _KALENDER_ZUSAETZE:
        stelle = klein.find(zusatz)
        if stelle > 0:
            return text[:stelle].strip(" ,–-")
    return text


def _event_tag(event: dict[str, Any]) -> str:
    """Der Tag eines Kalendereintrags als «JJJJ-MM-TT» (rein).

    Ganztägige Einträge tragen ein blosses Datum, andere einen
    Zeitstempel - die ersten zehn Zeichen sind in beiden Fällen der Tag.
    """
    return str(event.get("start") or "")[:10]


def calendar_birthdays(
    events: list[dict[str, Any]], tag: date, tage: int = 0
) -> list[tuple[int, str]]:
    """Geburtstage aus dem Geburtstags-Kalender (rein, testbar).

    Die Kontakte in «Familie» sind nicht die einzige Quelle: Wer seine
    Geburtstage im Telefon pflegt, sieht sie über den Geburtstags-
    Kalender auf der Startseite - und wurde bisher trotzdem nicht daran
    erinnert, weil der Wächter nur in die Kontakte sah.

    Zurück kommt (Tage bis dahin, Name), aufsteigend sortiert.
    """
    treffer: list[tuple[int, str]] = []
    for versatz in range(0, max(0, tage) + 1):
        ziel = (tag + timedelta(days=versatz)).strftime("%Y-%m-%d")
        for event in events or []:
            if not isinstance(event, dict) or not event.get("birthday"):
                continue
            if _event_tag(event) != ziel:
                continue
            name = birthday_name(event.get("summary"))
            if name:
                treffer.append((versatz, name))
    return treffer


def namen_zusammen(*listen: list[str]) -> list[str]:
    """Namen aus mehreren Quellen, ohne Doppel (rein, testbar).

    Wer sowohl in den Kontakten als auch im Geburtstags-Kalender steht,
    soll einmal gegrüsst werden. Verglichen wird ohne Rücksicht auf
    Gross- und Kleinschreibung; die erste Schreibweise gewinnt.
    """
    gesehen: dict[str, str] = {}
    for liste in listen:
        for name in liste or []:
            sauber = " ".join(str(name or "").split())
            if sauber and sauber.casefold() not in gesehen:
                gesehen[sauber.casefold()] = sauber
    return list(gesehen.values())


def _ist_schaltjahr(jahr: int) -> bool:
    return jahr % 4 == 0 and (jahr % 100 != 0 or jahr % 400 == 0)


WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

# Wie die App die Tage des Wochenplans nennt (bausteine.tsx WEEK_DAYS).
PLAN_DAYS = [
    "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
]

# So lange bleibt Erledigtes in einer Familienliste stehen, bevor es von
# selbst in den Papierkorb wandert.
DONE_DAYS = 7


def cooked_from_plan(
    meals: list[dict[str, Any]], recipes: list[dict[str, Any]], tag: date
) -> list[dict[str, Any]]:
    """Den Kochstempel aus dem Wochenplan ableiten (rein, testbar).

    «Zuletzt gekocht» entstand bisher nur, wenn jemand den Kochmodus bis
    zum Fertig-Haken durchlief – die Lasagne, die man auswendig kann,
    zählte nie. Dabei weiss es der Plan: Stand ein Gericht am Dienstag
    im Wochenplan und der Dienstag ist vorbei, war es dran.

    Zurück kommt die geänderte Rezeptliste (oder dieselbe, wenn nichts
    zu stempeln war). Ein Rezept, das an diesem Tag schon gestempelt
    ist, bleibt unangetastet: Sonst zählte der Kochmodus doppelt.
    """
    name = PLAN_DAYS[tag.weekday()]
    stempel = tag.isoformat()
    eintrag = next(
        (
            meal
            for meal in meals or []
            if isinstance(meal, dict) and str(meal.get("day")) == name
        ),
        None,
    )
    if eintrag is None:
        return list(recipes or [])
    gericht = str(eintrag.get("text") or "").strip()
    rezept_id = eintrag.get("recipe_id")
    geaendert = []
    treffer = False
    for recipe in recipes or []:
        passt = isinstance(recipe, dict) and (
            (rezept_id and recipe.get("id") == rezept_id)
            or (not rezept_id and gericht and str(recipe.get("text") or "") == gericht)
        )
        if passt and not treffer and str(recipe.get("last_cooked") or "") != stempel:
            treffer = True
            geaendert.append(
                {
                    **recipe,
                    "last_cooked": stempel,
                    "cooked_count": int(recipe.get("cooked_count") or 0) + 1,
                }
            )
        else:
            geaendert.append(recipe)
    return geaendert if treffer else list(recipes or [])


def stale_done(
    rows: list[dict[str, Any]], heute: date, tage: int = DONE_DAYS
) -> list[dict[str, Any]]:
    """Was länger als `tage` erledigt ist (rein, testbar).

    Abgehakte Aufgaben und erledigte Einkäufe bleiben stehen, bis jemand
    aufräumt – und niemand räumt auf. Die Liste soll aber das bleiben,
    was sie sein soll: kurz. Der Zeitpunkt kommt aus `done_at`; wo er
    fehlt (alte Einträge), zählt `created`, sonst bleibt der Eintrag
    stehen – lieber einer zu viel als einer zu früh weg.
    """
    alt = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("done"):
            continue
        wann = str(row.get("done_at") or row.get("created") or "")[:10]
        if not wann:
            continue
        try:
            jahr, monat, tag = (int(teil) for teil in wann.split("-"))
        except (ValueError, TypeError):
            continue
        try:
            when = date(jahr, monat, tag)
        except ValueError:
            continue
        if (heute - when).days >= tage:
            alt.append(row)
    return alt


def _due_within(rows: list[dict[str, Any]], heute: date, tage: int) -> list[tuple[date, str]]:
    """Offene Einträge mit Frist in den nächsten Tagen (rein)."""
    treffer: list[tuple[date, str]] = []
    for row in rows or []:
        if not isinstance(row, dict) or row.get("done"):
            continue
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        frist = str(row.get("due") or "").strip()[:10]
        if not frist:
            continue
        try:
            jahr, monat, tag = (int(teil) for teil in frist.split("-"))
            wann = date(jahr, monat, tag)
        except (ValueError, TypeError):
            continue
        if heute <= wann <= heute + timedelta(days=tage):
            wer = str(row.get("member") or "").strip()
            treffer.append((wann, f"{text}{f' ({wer})' if wer else ''}"))
    return sorted(treffer)


# Die Tage, an denen ein fehlender Essensplan eine Lücke ist. Das
# Wochenende bleibt draussen: Samstag isst man, was kommt, und eine
# Nachricht, die jeden Sonntag «für Samstag fehlt ein Plan» sagt,
# schaltet man ab.
PLAN_LUECKEN_TAGE = PLAN_DAYS[:5]


def meals_lines(meals: list[dict[str, Any]] | None) -> list[str]:
    """Das Essen der Woche im Ausblick (rein, testbar) - Punkt 587.

    «Essen: Mo Lasagne · Di Reis …» und, wenn unter der Woche ein Tag
    ohne Plan ist, «Für Mittwoch fehlt noch ein Plan». Beides nur, wenn
    überhaupt geplant wird: Wer den Essensplan nicht führt, soll nicht
    jeden Sonntag daran erinnert werden.
    """
    geplant: dict[str, str] = {}
    for meal in meals or []:
        if not isinstance(meal, dict):
            continue
        tag = str(meal.get("day") or "")
        text = str(meal.get("text") or "").strip()
        if tag in PLAN_DAYS and text and tag not in geplant:
            geplant[tag] = text
    if not geplant:
        return []
    zeilen = [
        "Essen: "
        + " · ".join(
            f"{WEEKDAYS[PLAN_DAYS.index(tag)]} {geplant[tag]}"
            for tag in PLAN_DAYS
            if tag in geplant
        )
    ]
    fehlt = [tag for tag in PLAN_LUECKEN_TAGE if tag not in geplant]
    if fehlt:
        aufzaehlung = (
            fehlt[0] if len(fehlt) == 1 else ", ".join(fehlt[:-1]) + f" und {fehlt[-1]}"
        )
        zeilen.append(f"Für {aufzaehlung} fehlt noch ein Plan")
    return zeilen


def ferienrand(rows: Any, heute: date, tage: int = 7) -> list[tuple[date, str]]:
    """Wo in der kommenden Woche die Ferien anfangen oder aufhören
    (rein, testbar) - Punkt 620 der Werkbank.

    «Mo: Herbstferien beginnen» oder «Mo: Schule beginnt wieder» - der
    Sonntagabend-Ausblick sagte es nicht, und der Montagmorgen begann
    mit einem Wecker, den niemand brauchte. Zurück kommt (Tag, Text),
    nur für Ränder innerhalb der Spanne und nach heute.
    """
    von = heute + timedelta(days=1)
    bis = heute + timedelta(days=tage)
    treffer: list[tuple[date, str]] = []
    for eintrag in schulferien.lesen(rows):
        if von <= eintrag["von"] <= bis:
            treffer.append((eintrag["von"], f"{eintrag['name']} beginnen"))
        danach = eintrag["bis"] + timedelta(days=1)
        # Enden die Ferien am Freitag, beginnt die Schule am Montag - der
        # erste Schultag ist der nächste Werktag nach dem Ferienende.
        while danach.weekday() >= 5:
            danach += timedelta(days=1)
        if von <= danach <= bis:
            treffer.append((danach, "Schule beginnt wieder"))
    return sorted(treffer)


def unbesetzte_fahrten(activities: Any, hoechstens: int = 4) -> list[str]:
    """«Do Jugi: niemand fährt» - Wöchentliche mit Ort, aber ohne Person
    (rein, testbar). Punkt 621 der Werkbank: Die Frage «wer fährt Levin
    nach Sursee?» gehört in den Sonntagabend-Ausblick, nicht auf den
    Donnerstag um 17 Uhr.

    Ohne Ort keine Fahrt, also keine Zeile; und ein Eintrag ohne Kind
    gehört niemandem - er bleibt draussen.
    """
    zeilen: list[tuple[int, str]] = []
    for eintrag in activities if isinstance(activities, list) else []:
        if not isinstance(eintrag, dict):
            continue
        tag = str(eintrag.get("day") or "")
        text = str(eintrag.get("text") or "").strip()
        ort = str(eintrag.get("ort") or "").strip()
        if tag not in WEEKDAYS or not text or not ort:
            continue
        if str(eintrag.get("bringt") or "").strip() or str(eintrag.get("holt") or "").strip():
            continue
        zeilen.append((WEEKDAYS.index(tag), f"{tag} {text}: niemand fährt"))
    return [text for _, text in sorted(zeilen)[:hoechstens]]


def week_ahead(
    events: list[dict[str, Any]],
    tasks: list[dict[str, Any]],
    chores: list[dict[str, Any]],
    contacts: list[dict[str, Any]],
    heute: date,
    tage: int = 7,
    meals: list[dict[str, Any]] | None = None,
    ferien_rows: Any = None,
    activities: Any = None,
) -> str | None:
    """Was in den nächsten Tagen ansteht, in einer Nachricht (rein, testbar).

    Der Hub kennt die Termine, die fälligen Ämtli und die Geburtstage –
    aber jeder sammelt sich das selbst zusammen. Am Sonntagabend geht
    man die Woche ohnehin im Kopf durch; genau dann ist die Nachricht
    willkommen und nicht Lärm.

    Der heutige Tag bleibt draussen: Die Nachricht kommt am Sonntagabend,
    und «die kommende Woche» beginnt am Montag - gemeldet wurde eine
    Vorschau, die mit «So: …» anfing. Was heute noch ansteht, weiss man
    um sieben Uhr abends selbst; die Vorschau deckt Montag bis Sonntag.

    Nichts los heisst nichts schicken: Eine wöchentliche Push mit
    «diese Woche: nichts» schaltet man nach dem zweiten Mal ab.
    """
    zeilen: list[str] = []
    von = heute + timedelta(days=1)
    bis = heute + timedelta(days=tage)

    # Der Ferienrand zuerst (Punkt 620): «Mo: Herbstferien beginnen» ist
    # die Zeile, die die ganze Woche umstellt.
    for wann, text in ferienrand(ferien_rows, heute, tage):
        zeilen.append(f"{WEEKDAYS[wann.weekday()]}: {text}")

    termine: list[tuple[date, str]] = []
    for event in events or []:
        if not isinstance(event, dict) or event.get("birthday"):
            continue
        start = str(event.get("start") or "")[:10]
        try:
            jahr, monat, tag = (int(teil) for teil in start.split("-"))
            wann = date(jahr, monat, tag)
        except (ValueError, TypeError):
            continue
        if von <= wann <= bis:
            termine.append((wann, str(event.get("summary") or "Termin")))
    for wann, titel in sorted(termine)[:4]:
        zeilen.append(f"{WEEKDAYS[wann.weekday()]}: {titel}")

    faellig = [
        (wann, text)
        for wann, text in _due_within(tasks, heute, tage) + _due_within(chores, heute, tage)
        if wann >= von
    ]
    for wann, text in faellig[:4]:
        zeilen.append(f"{WEEKDAYS[wann.weekday()]}: {text}")

    # Beide Quellen, wie beim Gruss am Morgen: die Kontakte in «Familie»
    # und der Geburtstags-Kalender aus dem Telefon. Wer in beiden steht,
    # steht einmal in der Liste.
    geburtstage: list[tuple[int, str]] = [
        eintrag
        for eintrag in (
            [
                (versatz, str(contact.get("text") or "").strip())
                for versatz, contact in birthdays_in(contacts, heute, tage)
            ]
            + calendar_birthdays(events, heute, tage)
        )
        # Der heutige Geburtstag stand schon im Morgengruss.
        if eintrag[0] >= 1
    ]
    gesehen: set[str] = set()
    for versatz, name in sorted(geburtstage, key=lambda zeile: zeile[0]):
        if not name or name.casefold() in gesehen:
            continue
        gesehen.add(name.casefold())
        wann = heute + timedelta(days=versatz)
        zeilen.append(f"{WEEKDAYS[wann.weekday()]}: {name} hat Geburtstag")

    # Das Essen und die offenen Fahrten zuletzt (Punkte 587, 621): Zeilen,
    # die nicht mit den Terminen um die zehn Plätze konkurrieren sollen.
    zeilen = zeilen[:10] + meals_lines(meals) + unbesetzte_fahrten(activities)
    if not zeilen:
        return None
    return "\n".join(zeilen)


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
