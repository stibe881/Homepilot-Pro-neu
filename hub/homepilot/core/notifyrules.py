"""Regeln für die eingebauten Push-Nachrichten des Wächters.

Der Wächter meldet Ausfälle, offene Fenster, Frost und Ähnliches. Bisher
waren Schwellen und Wartezeiten fest einprogrammiert – wer die Erinnerung
an die volle Waschmaschine nach vier statt zwei Stunden wollte, musste den
Quelltext ändern. Jetzt stehen diese Nachrichten als Regeln in der App
(Abläufe → Push): jede lässt sich abschalten, und wo es eine Schwelle
gibt, lässt sie sich verstellen.

Bewusst nicht dabei: die Alarm-Nachrichten. Eine Alarmanlage, deren
Auslöse-Push man versehentlich abschalten kann, ist keine. Wer einzelne
Kategorien für sich persönlich nicht will, stellt das weiter unter
Benachrichtigungen ab – das hier gilt für alle.
"""

from __future__ import annotations

from typing import Any

from . import push, waschkueche

# Beschreibung je Parameter: Grenzen halten Tippfehler fern (eine Erinnerung
# nach 0 Stunden wäre Dauerfeuer, eine Frostwarnung bei 40 °C nie still).
# {key, label, unit, default, min, max, step}
Param = dict[str, Any]

# Die Regeln in Anzeige-Reihenfolge. `category` ist zugleich der Schlüssel
# der Push-Kategorie (siehe push.CATEGORIES) – so greifen persönliche
# Abbestellungen weiterhin.
RULES: list[dict[str, Any]] = [
    {
        "key": "doorbell",
        "title": "Es klingelt",
        "detail": "Sofort, sobald jemand an einer Türklingel oder "
        "Gegensprechanlage klingelt. Dafür braucht es keinen eigenen "
        "Ablauf mehr – die wichtigste Nachricht im Haus soll nicht an "
        "einer Verdrahtung hängen, die man versehentlich falsch setzt.",
        "params": [],
    },
    {
        "key": "leak",
        "title": "Wasser gemeldet",
        "detail": "Sofort, sobald ein Wassermelder Wasser meldet – unabhängig "
        "davon, ob die Alarmanlage scharf ist.",
        "params": [],
    },
    {
        "key": "battery",
        "title": "Batterie schwach",
        "detail": "Einmal je Gerät, sobald es eine schwache Batterie meldet. "
        "Nach dem Wechsel ist die Warnung wieder scharf.",
        "params": [],
    },
    {
        "key": "outage",
        "title": "Integration ausgefallen",
        "detail": "Wenn eine ganze Anbindung (z.B. Hue) nicht mehr antwortet – "
        "und wieder, wenn sie zurück ist.",
        "params": [
            {
                "key": "minutes",
                "label": "Melden nach",
                "unit": "Minuten",
                "default": 2,
                "min": 1,
                "max": 60,
                "step": 1,
            }
        ],
    },
    {
        "key": "flattern",
        "title": "Anbindung verbindet dauernd neu",
        "detail": "Die Zwischenstufe zwischen «da» und «weg»: Wer alle paar "
        "Minuten die Verbindung verliert und wieder aufbaut, sieht von aussen "
        "aus wie Betrieb – verschluckt aber Befehle und leert Batterien.",
        "params": [
            {
                "key": "mal",
                "label": "Melden ab",
                "unit": "Rückkehrern pro Stunde",
                "default": 6,
                "min": 2,
                "max": 30,
                "step": 1,
            }
        ],
    },
    {
        "key": "device_down",
        "title": "Überwachtes Gerät antwortet nicht",
        "detail": "Für Sensoren, die der Alarmanlage zugeordnet sind: dort "
        "wäre ein stiller Ausfall ein blinder Fleck.",
        "params": [
            {
                "key": "minutes",
                "label": "Melden nach",
                "unit": "Minuten",
                "default": 30,
                "min": 5,
                "max": 720,
                "step": 5,
            }
        ],
    },
    {
        "key": "open",
        "title": "Fenster/Tür steht offen",
        "detail": "Erinnert einmal je Öffnung – wer schliesst und wieder "
        "öffnet, fängt neu an.",
        "params": [
            {
                "key": "hours",
                "label": "Erinnern nach",
                "unit": "Stunden",
                "default": 2,
                "min": 1,
                "max": 24,
                "step": 1,
            }
        ],
    },
    {
        "key": "appliance",
        "title": "Haushaltgerät noch voll",
        "detail": "Erinnert an die fertige, aber nicht ausgeräumte Maschine. "
        "Mit einem Türkontakt in der Waschküche wird nachgehakt, bis "
        "jemand dort war – sonst bleibt es bei einer Nachricht je "
        "Programmlauf. Nachts bleibt es still: Wer um zwei Uhr erfährt, "
        "dass der Tumbler fertig ist, geht deswegen nicht hinunter. Die "
        "Nachricht kommt am Morgen. Beide Zeiten gleich gesetzt heisst: "
        "keine Nachtruhe.",
        "params": [
            {
                "key": "hours",
                "label": "Erinnern nach",
                "unit": "Stunden",
                "default": 2,
                "min": 1,
                "max": 24,
                "step": 1,
            },
            {
                "key": "quiet_from",
                "label": "Still ab",
                "unit": "Uhr",
                "default": waschkueche.RUHE_VON,
                "min": 0,
                "max": 23,
                "step": 1,
            },
            {
                "key": "quiet_to",
                "label": "Wieder ab",
                "unit": "Uhr",
                "default": waschkueche.RUHE_BIS,
                "min": 0,
                "max": 23,
                "step": 1,
            },
        ],
    },
    {
        "key": "oven",
        "title": "Backofen parat und fertig",
        "detail": "Sobald das Vorheizen durch ist und wenn das Programm "
        "endet - als Nachricht und als Durchsage auf den Boxen. Gilt für "
        "Kochgeräte (Backofen, Steamer, Mikrowelle); die Waschküche hat "
        "ihre eigene Erinnerung oben.",
        "params": [],
    },
    {
        "key": "departure",
        "title": "Losfahren zum Termin",
        "detail": "Hat ein Termin einen Ort, meldet sich das Haus, sobald "
        "es Zeit ist loszufahren - die Fahrzeit wird aus der Entfernung "
        "ab zuhause geschätzt, bewusst mit Reserve. Termine ohne Ort "
        "bleiben still.",
        "params": [
            {
                "key": "buffer",
                "label": "Puffer",
                "unit": "Minuten",
                "default": 10,
                "min": 0,
                "max": 45,
                "step": 5,
            }
        ],
    },
    {
        "key": "vacuum",
        "title": "Saugroboter meldet ein Problem",
        "detail": "Sofort, wenn der Sauger oder seine Station nicht "
        "weiterkommen - leerer Wassertank, voller Schmutzwassertank, "
        "festgefahren. Einmal je Problem; nach dem Beheben ist die "
        "Meldung wieder scharf. Bisher stand das nur in der "
        "Hersteller-App.",
        "params": [],
    },
    {
        "key": "rain",
        "title": "Regen kommt",
        "detail": "Wenn in der Vorschau Regen ansteht - einmal je Schauer, "
        "rechtzeitig genug, um noch etwas hereinzuholen. Offene Fenster "
        "stehen in der Meldung; draussen liegt aber mehr, als der Hub "
        "sieht. Die Quelle kennt Viertelstunden, die Vorwarnzeit wird "
        "darauf gerundet.",
        "params": [
            {
                "key": "minutes",
                "label": "Vorwarnzeit",
                "unit": "Minuten",
                "default": 30,
                "min": 15,
                "max": 120,
                "step": 15,
            },
            {
                # Wie lange nach einer Vorwarnung Ruhe ist. Endet früher,
                # sobald es regnet oder die Vorschau leer ist - das ist
                # der Normalfall, und dann zählt diese Zahl gar nicht.
                "key": "pause",
                "label": "Danach Ruhe",
                "unit": "Minuten",
                "default": 120,
                "min": 15,
                "max": 240,
                "step": 15,
            },
        ],
    },
    {
        "key": "plants",
        "title": "Pflanzen giessen",
        "detail": "Abends, wenn es länger nicht geregnet hat, auch keiner "
        "kommt und es warm genug war. Alle drei zusammen - bei 14 Grad "
        "hält die Erde eine Woche, und wer giesst, während nachts der "
        "Regen kommt, giesst zweimal.",
        "params": [
            {
                "key": "days",
                "label": "Trocken seit",
                "unit": "Tagen",
                "default": 3,
                "min": 2,
                "max": 10,
                "step": 1,
            },
            {
                "key": "degrees",
                "label": "Erst ab",
                "unit": "°C",
                "default": 18.0,
                "min": 10.0,
                "max": 30.0,
                "step": 1.0,
            },
        ],
    },
    {
        "key": "frost",
        "title": "Frost angekündigt",
        "detail": "Abends, wenn die Nacht kälter wird als die Schwelle – für "
        "die Pflanzen auf dem Balkon. Drei Grad statt null, weil es am Boden "
        "kälter ist als in Messhöhe.",
        "params": [
            {
                "key": "below",
                "label": "Warnen unter",
                "unit": "°C",
                "default": 3.0,
                "min": -5.0,
                "max": 10.0,
                "step": 0.5,
            }
        ],
    },
    {
        "key": "presence",
        "title": "Ortung: schwacher Akku",
        "detail": "Bevor die Ortung mangels Strom ausfällt. Ein leeres Telefon "
        "ist die häufigste Ursache für ein falsches «niemand zuhause» – und es "
        "kündigt sich an.",
        "params": [
            {
                "key": "percent",
                "label": "Warnen unter",
                "unit": "% Akku",
                "default": 15,
                "min": 5,
                "max": 50,
                "step": 5,
            }
        ],
    },
    {
        "key": "morning",
        "title": "Morgen-Zusammenfassung",
        "detail": "Eine Nachricht am Morgen statt sieben einzelner: was noch "
        "offen steht, welche Batterie schwach ist, welches Gerät sich nicht "
        "meldet, was in der Nacht war und welcher Ablauf seit Tagen nicht "
        "lief. Sie kommt nur, wenn etwas dasteht - eine Zusammenfassung, die "
        "«alles in Ordnung» meldet, bestellt man ab.",
        "params": [
            {
                "key": "hour",
                "label": "Schicken um",
                "unit": "Uhr",
                "default": 7,
                "min": 4,
                "max": 12,
                "step": 1,
            },
            {
                "key": "quiet_days",
                "label": "Stille Abläufe melden ab",
                "unit": "Tagen",
                "default": 7,
                "min": 0,
                "max": 60,
                "step": 1,
            },
        ],
    },
    {
        "key": "birthday",
        "title": "Geburtstag",
        "detail": "Am Morgen, wer heute Geburtstag hat – aus den Kontakten in "
        "Familie und aus dem Geburtstags-Kalender. Wer in beiden steht, wird "
        "einmal gegrüsst. Der Vorlauf meldet es zusätzlich vorher, solange "
        "noch Zeit für ein Geschenk ist; auf 0 gestellt entfällt er.",
        "params": [
            {
                "key": "hour",
                "label": "Erinnern um",
                "unit": "Uhr",
                "default": 8,
                "min": 5,
                "max": 22,
                "step": 1,
            },
            {
                "key": "days",
                "label": "Vorlauf",
                "unit": "Tage",
                "default": 3,
                "min": 0,
                "max": 14,
                "step": 1,
            },
        ],
    },
    {
        "key": "weekahead",
        "title": "Wochenausblick am Sonntag",
        "detail": "Sonntagabend, wenn man die Woche ohnehin im Kopf durchgeht: "
        "Termine, fällige Ämtli und Geburtstage der kommenden sieben Tage in "
        "einer Nachricht.",
        "params": [
            {
                "key": "hour",
                "label": "Verschicken um",
                "unit": "Uhr",
                "default": 19,
                "min": 6,
                "max": 22,
                "step": 1,
            }
        ],
    },
    {
        "key": "disk",
        "title": "Speicherplatz wird knapp",
        "detail": "Höchstens einmal am Tag, solange es knapp bleibt. Nicht "
        "erst bei 100 %: Eine volle Platte verhindert jedes Speichern.",
        "params": [
            {
                "key": "percent",
                "label": "Warnen ab",
                "unit": "% belegt",
                "default": 85,
                "min": 50,
                "max": 99,
                "step": 1,
            }
        ],
    },
]

BY_KEY: dict[str, dict[str, Any]] = {rule["key"]: rule for rule in RULES}


def _clamp(value: Any, spec: Param) -> float:
    """Einen Parameterwert in seine Grenzen zwingen (rein, testbar).

    Kein Fehler bei Unsinn, sondern der nächstliegende erlaubte Wert:
    Gespeicherte Regeln sollen den Hub nie am Starten hindern.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(spec["default"])
    number = max(float(spec["min"]), min(float(spec["max"]), number))
    # Ganzzahlige Parameter bleiben ganzzahlig – «2.5 Minuten» liest sich
    # wie ein Fehler, auch wenn der Wächter damit rechnen könnte.
    if float(spec["step"]) == int(spec["step"]) and float(spec["default"]) == int(
        spec["default"]
    ):
        return float(round(number))
    return number


def effective(stored: Any) -> dict[str, dict[str, Any]]:
    """Gespeicherte Regeln mit den Vorgaben verschmelzen (rein, testbar).

    Ergebnis je Regel: {enabled, params}. Unbekannte Schlüssel fliegen
    raus, fehlende bekommen die Vorgabe – eine neue Regel ist damit sofort
    aktiv, ohne dass jemand etwas speichern muss.
    """
    by_key: dict[str, dict[str, Any]] = {}
    for entry in stored or []:
        if isinstance(entry, dict) and entry.get("key") in BY_KEY:
            by_key[str(entry["key"])] = entry

    result: dict[str, dict[str, Any]] = {}
    for rule in RULES:
        entry = by_key.get(rule["key"], {})
        params = entry.get("params") if isinstance(entry.get("params"), dict) else {}
        result[rule["key"]] = {
            "enabled": entry.get("enabled") is not False,
            "params": {
                spec["key"]: _clamp(params.get(spec["key"], spec["default"]), spec)
                for spec in rule["params"]
            },
        }
    return result


def store(stored: Any, key: str, enabled: bool, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Eine Regel in die gespeicherte Liste einsetzen (rein, testbar).

    Gespeichert wird die ganze Regel, nicht nur die Abweichung: So bleibt
    nachvollziehbar, mit welchen Werten eine Nachricht rausging, auch wenn
    sich die Vorgaben in einer späteren Version ändern.
    """
    if key not in BY_KEY:
        raise ValueError(f"Unbekannte Regel '{key}'")
    cleaned = {
        spec["key"]: _clamp(params.get(spec["key"], spec["default"]), spec)
        for spec in BY_KEY[key]["params"]
    }
    entry = {"key": key, "enabled": bool(enabled), "params": cleaned}
    rest = [
        item
        for item in (stored or [])
        if isinstance(item, dict) and item.get("key") in BY_KEY and item.get("key") != key
    ]
    return [*rest, entry]


def describe(stored: Any) -> list[dict[str, Any]]:
    """Die Regeln für die App: Metadaten plus aktuelle Werte (rein)."""
    current = effective(stored)
    return [
        {
            "key": rule["key"],
            "title": rule["title"],
            "detail": rule["detail"],
            # Dieselbe Einteilung wie im Profil - der Schlüssel einer Regel
            # ist zugleich ihre Push-Kategorie (siehe Kopf dieser Datei).
            "group": push.group_of(rule["key"]),
            "enabled": current[rule["key"]]["enabled"],
            "params": [
                {**spec, "value": current[rule["key"]]["params"][spec["key"]]}
                for spec in rule["params"]
            ],
        }
        for rule in RULES
    ]
