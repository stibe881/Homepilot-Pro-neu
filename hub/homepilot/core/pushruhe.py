"""Der Filter zwischen «der Hub will melden» und «das Telefon klingelt».

Abbestellen konnte man eine Kategorie schon (core/push.py: ``muted``) -
aber nur ganz oder gar nicht, und für immer. Die Fragen, die im Haus
wirklich gestellt wurden, beantwortet das nicht:

- «Ich will die Batteriewarnung schon, aber nicht um zwei Uhr nachts.»
  Dafür sind die Ruhezeiten da. Sie gelten je Person: Wer Schicht
  arbeitet, hat eine andere Nacht als der Rest des Hauses.
- «Heute nicht mehr.» Der Trockner läuft, die Erinnerung kam, man geht
  morgen hinunter - und will bis dahin Ruhe, ohne die Kategorie
  dauerhaft abzustellen und in einem halben Jahr zu merken, dass sie
  seither fehlt. Dafür ist das Stillstellen auf Zeit da: Es läuft von
  selbst ab.
- «Wie oft darf dieselbe Art Meldung am Tag kommen?» Dafür der Deckel.
  Er gilt fürs ganze Haus, nicht je Person: Er begrenzt, was der Hub
  *schickt*, nicht was jemand *bekommt*.

Was nie zurückgehalten wird, steht in ``IMMER_DURCH`` und ist der
wichtigste Teil dieser Datei: Eine Ruhezeit, die den Wasseralarm
verschluckt, ist ein Fehler, kein Komfort. Deshalb ist die Liste
namentlich aufgezählt und nicht abgeleitet - eine neue Kategorie ist
still, bis jemand ausdrücklich entscheidet, dass sie es nicht sein darf.

Reines Rechnen über Listen und Zahlen; wer speichert, ist der Hub.
"""

from __future__ import annotations

from typing import Any

#: Kategorien, die keine Ruhezeit und kein Stillstellen aufhält.
#:
#: Der Massstab ist nicht «wichtig», sondern «wer das um drei Uhr nachts
#: nicht erfährt, hat morgen einen Schaden oder ein Kind, das geweint
#: hat». Der Push-Test steht mit drin: Wer prüft, ob überhaupt etwas
#: ankommt, will keine Antwort von seinen eigenen Einstellungen
#: (dieselbe Überlegung wie bei /api/push/test).
IMMER_DURCH: frozenset[str] = frozenset(
    {
        "alarm",
        "alarm_arming",
        "camera_motion",
        "leak",
        # Rauch erst recht: Die eine Meldung, die man nachts haben will.
        "smoke",
        "doorbell",
        "baby_cry",
        "timer",
        "medication",
        "test",
    }
)


def darf_zurueckgehalten(category: str | None) -> bool:
    """Darf diese Kategorie überhaupt gebremst werden? (rein, testbar)

    Meldungen aus selbst gebauten Abläufen dürfen es: Wer sich einen
    Ablauf baut, der jede Viertelstunde meldet, soll ihn stillstellen
    können, ohne ihn zu löschen.
    """
    return bool(category) and category not in IMMER_DURCH


# ── Ruhezeiten ─────────────────────────────────────────────────────────────

#: Die Vorgabe: aus. Eine Ruhezeit, die niemand eingeschaltet hat, wäre
#: eine Nachricht, die niemand vermisst - und dann auch niemand sucht.
RUHE_AUS: dict[str, Any] = {"enabled": False, "from": 22, "to": 7}


def ruhe_lesen(raw: Any) -> dict[str, Any]:
    """Die gespeicherte Ruhezeit einer Person lesen (rein, testbar).

    Unsinn wird zur Vorgabe statt zu einem Fehler: Eine kaputte Zeile im
    Datenspeicher soll den Hub nicht am Melden hindern.
    """
    if not isinstance(raw, dict):
        return dict(RUHE_AUS)

    def stunde(wert: Any, ersatz: int) -> int:
        try:
            return int(wert) % 24
        except (TypeError, ValueError):
            return ersatz

    return {
        "enabled": raw.get("enabled") is True,
        "from": stunde(raw.get("from"), 22),
        "to": stunde(raw.get("to"), 7),
    }


def in_der_ruhe(ruhe: dict[str, Any], stunde: int) -> bool:
    """Liegt diese Stunde in der Ruhezeit? (rein, testbar)

    Über Mitternacht hinweg ist der Normalfall - 22 bis 7 heisst «22, 23,
    0 … 6». Gleiche Zahlen heissen «keine Ruhezeit»: Ein Fenster von
    null Stunden ist verständlicher als eines von vierundzwanzig, und
    wer wirklich nie etwas will, stellt die Kategorie ab.
    """
    if not ruhe.get("enabled"):
        return False
    von = int(ruhe["from"])
    bis = int(ruhe["to"])
    if von == bis:
        return False
    jetzt = int(stunde) % 24
    if von < bis:
        return von <= jetzt < bis
    return jetzt >= von or jetzt < bis


# ── Stillstellen auf Zeit ──────────────────────────────────────────────────

#: So lange höchstens. Länger ist kein «heute nicht mehr», sondern ein
#: Abbestellen - und dafür gibt es den Schalter daneben, der auch noch
#: in einem halben Jahr sichtbar sagt, dass hier etwas aus ist.
STILL_MAX_STUNDEN = 24.0


def still_lesen(raw: Any, jetzt: float) -> dict[str, float]:
    """Welche Kategorien gerade stillgestellt sind (rein, testbar).

    Abgelaufene fliegen beim Lesen heraus - so muss sie niemand
    aufräumen, und eine Zeile im Speicher hält keine Kategorie stumm,
    die längst wieder dran wäre.
    """
    wenn = {}
    if isinstance(raw, dict):
        for key, wert in raw.items():
            try:
                bis = float(wert)
            except (TypeError, ValueError):
                continue
            if bis > jetzt:
                wenn[str(key)] = bis
    return wenn


def still_setzen(
    raw: Any, category: str, stunden: Any, jetzt: float
) -> dict[str, float]:
    """Eine Kategorie auf Zeit stillstellen (rein, testbar).

    ``stunden`` auf 0 (oder darunter) hebt es wieder auf - derselbe Weg
    hin und zurück, statt eines zweiten Aufrufs, den man vergessen kann.
    """
    if not darf_zurueckgehalten(category):
        raise ValueError(f"'{category}' lässt sich nicht stillstellen")
    stand = still_lesen(raw, jetzt)
    try:
        dauer = float(stunden)
    except (TypeError, ValueError):
        dauer = 0.0
    if dauer <= 0:
        stand.pop(category, None)
        return stand
    stand[category] = jetzt + min(dauer, STILL_MAX_STUNDEN) * 3600.0
    return stand


# ── Der Deckel: wie oft am Tag ─────────────────────────────────────────────

#: Wie viele Meldungen einer Art der Hub an einem Tag höchstens schickt.
#:
#: Nicht überall einer: Wo er fehlt, gibt es keinen, und das ist die
#: Vorgabe. Jede Zahl hier ist eine Entscheidung, dass die n+1-te
#: Meldung desselben Tages nichts Neues mehr sagt - nachlesen kann man
#: sie trotzdem, sie steht auf dem Zettel (core/pushverlauf.py).
DECKEL: dict[str, int] = {
    # Zwölf schwache Batterien an einem Tag heisst nicht zwölf
    # Nachrichten - es heisst, dass jemand einen Ausflug in den Keller
    # machen sollte, und das weiss man nach der dritten.
    "battery": 3,
    # Dasselbe Gerät, dasselbe Problem: Nach dem dritten Mal ist es
    # keine Meldung mehr, sondern ein Zustand.
    "device_down": 3,
    "outage": 5,
    "flattern": 3,
    "open": 6,
    "maintenance": 3,
    "vacuum": 3,
    # Der Platz auf der Platte wird nicht durch Melden mehr - die Regel
    # selbst meldet schon nur einmal am Tag, der Deckel ist das Netz
    # darunter.
    "disk": 1,
    "plants": 1,
    "frost": 1,
    "heat_covers": 3,
    "shopping": 5,
}

#: Wo der Zählerstand liegt.
#:
#: Als Liste mit einer Zeile, nicht als Objekt: Die Ablage speichert
#: Listen von Zeilen (core/persistence.py), und ein Objekt dort abzulegen
#: hätte still seine Schlüssel gespeichert statt seines Inhalts.
DECKEL_KEY = "push_deckel"


def deckel_fuer(category: str | None) -> int | None:
    """Wie viele Meldungen dieser Art heute höchstens (rein, testbar)."""
    if not darf_zurueckgehalten(category):
        return None
    return DECKEL.get(str(category))


def _zeile(raw: Any) -> dict[str, Any]:
    """Die eine Zeile aus der Liste holen (rein)."""
    if isinstance(raw, list) and raw and isinstance(raw[0], dict):
        return raw[0]
    return {}


def zaehlerstand(raw: Any, tag: str) -> dict[str, int]:
    """Die heutigen Zählerstände (rein, testbar).

    Ein anderer Tag heisst: alles auf null. Der Tag steht als Zeichenkette
    daneben statt als Zeitstempel - so ist beim Nachsehen im Datenspeicher
    ohne Rechnen zu erkennen, worauf sich die Zahlen beziehen.
    """
    zeile = _zeile(raw)
    if str(zeile.get("tag") or "") != tag:
        return {}
    zahlen = zeile.get("zahl")
    if not isinstance(zahlen, dict):
        return {}
    stand = {}
    for key, wert in zahlen.items():
        try:
            stand[str(key)] = int(wert)
        except (TypeError, ValueError):
            continue
    return stand


def ueber_deckel(raw: Any, category: str | None, tag: str) -> bool:
    """Ist der Deckel für heute erreicht? (rein, testbar)"""
    grenze = deckel_fuer(category)
    if grenze is None:
        return False
    return zaehlerstand(raw, tag).get(str(category), 0) >= grenze


def hochzaehlen(raw: Any, category: str | None, tag: str) -> list[dict[str, Any]]:
    """Eine verschickte Meldung mitzählen (rein, testbar).

    Gezählt wird nur, was einen Deckel hat: Sonst wüchse der Speicher um
    eine Zeile je Kategorie, die niemand je liest.
    """
    stand = zaehlerstand(raw, tag)
    if deckel_fuer(category) is not None:
        stand[str(category)] = stand.get(str(category), 0) + 1
    return [{"tag": tag, "zahl": stand}]


# ── Die Entscheidung ───────────────────────────────────────────────────────

#: Warum eine Meldung nicht ans Telefon ging - in derselben Sprache, in
#: der sie auf dem Nachlese-Zettel steht.
GRUND_RUHE = "Ruhezeit"
GRUND_STILL = "stillgestellt"
GRUND_DECKEL = "Tagesdeckel erreicht"


def haelt_zurueck(
    category: str | None,
    *,
    ruhe: dict[str, Any] | None = None,
    still: dict[str, float] | None = None,
    stunde: int = 12,
) -> str | None:
    """Hält es diese Meldung für diese Person zurück? (rein, testbar)

    Gibt den Grund zurück oder ``None``. Zwei Gründe gleichzeitig gibt es
    nicht - der erste genügt, und die Reihenfolge ist die, in der man
    danach sucht: «Warum kam nichts?» «Es ist Nacht.»
    """
    if not darf_zurueckgehalten(category):
        return None
    if ruhe and in_der_ruhe(ruhe, stunde):
        return GRUND_RUHE
    if still and str(category) in still:
        return GRUND_STILL
    return None
