"""Wie eine Meldung aussieht, bevor sie das erste Mal kommt.

Die Liste der Kategorien beantwortet «was schickt der Hub?» mit einer
Überschrift: «Haushaltgerät fertig». Was dann wirklich auf dem
Sperrbildschirm steht, sieht man erst beim ersten Mal - und dann ist es
zu spät für die Frage, ob man das so wollte. Wer «Fällige Aufgaben»
abstellt, weiss nicht, dass darunter auch die Ämtli der Kinder laufen.

Deshalb je Kategorie ein Beispiel: derselbe Satzbau, dieselbe Länge,
dieselben Knöpfe wie im Ernstfall - nur mit erfundenen Namen. Es dient
zwei Dingen:

- **Vorschau** in den Einstellungen: Man liest, was man abbestellt.
- **Testversand** je Kategorie: genau diese Nachricht ans eigene
  Telefon. Erst das beantwortet die Frage, die der allgemeine Push-Test
  offenlässt - ob *diese* Art Meldung durchkommt, mit ihren Knöpfen,
  ihrer Dringlichkeit und durch die eigenen Ruhezeiten hindurch.

Erfundene Namen, keine echten: Ein Testversand, in dem «Wasser im
Keller» steht, ruft jemanden aus dem Büro nach Hause. Die Beispiele
sagen deshalb selbst, dass sie welche sind, sobald sie als Nachricht
rausgehen (siehe ``als_meldung``).

Nur Daten und reines Rechnen; wer schickt, ist die Route.
"""

from __future__ import annotations

from . import push

#: Titel und Text je Kategorie.
#:
#: Die Reihenfolge ist die von ``push.CATEGORIES`` - ein Test hält fest,
#: dass keine fehlt (tests/test_pushtexte.py). Eine neue Kategorie ohne
#: Beispiel wäre eine Zeile in den Einstellungen, die «Vorschau» sagt und
#: nichts zeigt.
BEISPIELE: dict[str, tuple[str, str]] = {
    "alarm": ("Alarm ausgelöst", "Bewegung im Wohnzimmer, während die Anlage scharf war."),
    "alarm_arming": ("Alarmanlage scharf", "Abwesend scharf geschaltet von Stefan."),
    "camera_motion": ("Bewegung an der Haustüre", "Die Kamera Haustüre sieht jemanden."),
    "outage": ("Hue nicht erreichbar", "Die Integration 'hue' antwortet seit 2 Minuten nicht mehr."),
    "flattern": (
        "Zigbee verbindet dauernd neu",
        "8 Rückkehrer in der letzten Stunde - Befehle gehen dabei verloren.",
    ),
    "device_down": (
        "Fensterkontakt Bad antwortet nicht",
        "Seit 30 Minuten kein Lebenszeichen - die Alarmanlage hat dort einen blinden Fleck.",
    ),
    "battery": ("Batterie schwach", "Bewegungsmelder Flur meldet eine schwache Batterie."),
    "open": ("Fenster Bad steht offen", "Seit 2 Stunden offen, draussen sind es 4 °C."),
    "leak": ("Wasser gemeldet", "Der Melder in der Waschküche meldet Wasser."),
    "smoke": ("🔥 Rauch gemeldet", "Rauchmelder Küche – Küche meldet Rauch. Das Haus verlassen, dann 118 anrufen."),
    "doorbell": ("Es klingelt", "Jemand steht an der Haustüre."),
    "baby_cry": ("Ein Baby weint", "Die Kamera im Kinderzimmer hört ein Kind."),
    "disk": ("Speicherplatz wird knapp", "Die Platte ist zu 87 % belegt."),
    "frost": ("Frost angekündigt", "Heute Nacht bis -1 °C - die Pflanzen auf dem Balkon."),
    "rain": ("Regen kommt", "In 30 Minuten Regen. Das Fenster im Bad steht offen."),
    "storm_covers": (
        "Sturm angekündigt: Storen hochgefahren",
        "MeteoSchweiz meldet Sturmböen ab 16 Uhr. 4 Storen sind oben.",
    ),
    "heat_covers": (
        "Storen senken?",
        "Drinnen 26 °C, die Sonne steht hoch - beschattet bleibt es kühler.",
    ),
    "plants": ("Pflanzen giessen", "Seit 4 Tagen kein Regen, und heute waren es 24 °C."),
    "appliance": ("Waschmaschine ist fertig", "Seit 2 Stunden fertig - die Trommel ist noch voll."),
    "oven": ("Backofen ist parat", "200 °C erreicht."),
    "departure": ("Zeit loszufahren", "Zahnarzt um 14:30 - etwa 18 Minuten Fahrzeit."),
    "vacuum": ("Saugroboter steht", "Der Wassertank der Station ist leer."),
    "tasks": ("Ämtli fällig", "Abfall rausstellen ist heute dran (Lina)."),
    "timer": ("Timer abgelaufen", "Eier - 7 Minuten sind um."),
    "maintenance": ("Wartung fällig", "Filter der Lüftung wechseln - zuletzt vor 6 Monaten."),
    "shopping": ("Einkaufsliste", "Milch ist zur Neige gegangen und steht auf der Liste."),
    "calendar": ("Termin steht an", "Elternabend um 19:30 in der Schule."),
    "medication": ("Medikament fällig", "Vitamin D für Lina."),
    "birthday": ("Geburtstag heute", "Oma Käthi wird heute 74."),
    "packlist": ("Morgen mitnehmen", "Turnsack und Znüni - morgen ist Dienstag."),
    "morning": (
        "Guten Morgen",
        "1 Fenster offen, 2 Batterien schwach, in der Nacht war nichts.",
    ),
    "presence": ("Telefon fast leer", "Bines Telefon hat noch 12 % - die Ortung fällt sonst aus."),
    "weekahead": ("Die Woche voraus", "3 Termine, 2 Ämtli, 1 Geburtstag."),
    "vouchers": ("Gutschein läuft ab", "Der Gutschein von Ochsner Sport gilt noch 7 Tage."),
    "test": ("HomePilot Test", "Push-Benachrichtigungen funktionieren \U0001f389"),
}

#: Das Zeichen, an dem man einen Testversand erkennt.
#:
#: Ohne das läuft jemand los, weil «Wasser gemeldet» auf dem Telefon
#: steht - der Text ist ja absichtlich derselbe wie im Ernstfall. Vorn,
#: nicht hinten: Auf dem Sperrbildschirm wird der Titel abgeschnitten,
#: und das Ende sieht niemand.
PROBE = "Probe: "


def beispiel(category: str | None) -> tuple[str, str] | None:
    """Titel und Text zu einer Kategorie (rein, testbar).

    ``None`` für alles, was kein Beispiel hat - vor allem für die
    Meldungen aus selbst gebauten Abläufen: Deren Text steht im Ablauf,
    und ihn hier zu erraten wäre eine Vorschau, die nicht stimmt.
    """
    if not category:
        return None
    return BEISPIELE.get(str(category))


def als_meldung(category: str) -> tuple[str, str]:
    """Dasselbe Beispiel, aber als Nachricht kenntlich gemacht (rein).

    Fehlt eines, wird daraus die Überschrift der Kategorie: Ein
    Testversand, der nichts schickt, weil ein Eintrag fehlt, wäre der
    unfreundlichste aller Fehler - man wartet auf eine Nachricht, die
    nie kommt, und hält Push für kaputt.
    """
    paar = beispiel(category)
    if paar is None:
        was = push.CATEGORIES.get(category, "Meldung")
        return f"{PROBE}{was}", "So sieht diese Art Nachricht aus."
    titel, text = paar
    return f"{PROBE}{titel}", text
