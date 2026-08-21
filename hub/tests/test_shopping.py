"""Die Erinnerung im Laden.

Der Fall: Man steht wegen einer Sache im Coop, und die drei anderen von
der Liste fallen einem im Auto wieder ein. Zu früh gemeldet ist sie
lästig, zu spät nutzlos - deshalb hängt hier alles an der Frage, wann
genau.
"""

from homepilot.core.shopping import (
    STAY_SECONDS,
    describe,
    due_reminders,
    open_items,
)

JETZT = 1_700_000_000.0
COOP = {"id": "s1", "name": "Coop Willisau", "zone": "coop_willisau"}
OHNE_ZONE = {"id": "s2", "name": "Kaufland Lörrach"}


def da_seit(sekunden: float) -> dict:
    return {"state": "home", "changed_at": JETZT - sekunden}


def test_open_items_ignores_what_is_done():
    rows = [{"text": "Milch"}, {"text": "Brot", "done": True}, "unsinn"]
    assert [row["text"] for row in open_items(rows)] == ["Milch"]


def test_a_short_stop_does_not_remind():
    """Wer an der Ampel davor steht, kauft nicht ein."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS - 1)}
    assert due_reminders([COOP], zonen, 3, JETZT, {}) == []


def test_a_real_visit_reminds():
    zonen = {"coop_willisau": da_seit(STAY_SECONDS)}
    assert due_reminders([COOP], zonen, 3, JETZT, {}) == [COOP]


def test_an_empty_list_never_reminds():
    """Nichts zu holen heisst nichts zu melden - sonst wäre es die
    Nachricht, an der man das Ganze abschaltet."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS * 2)}
    assert due_reminders([COOP], zonen, 0, JETZT, {}) == []


def test_only_once_per_visit():
    """Sonst käme sie jede Minute erneut."""
    zonen = {"coop_willisau": da_seit(STAY_SECONDS)}
    erinnert = {"coop_willisau": zonen["coop_willisau"]["changed_at"]}
    assert due_reminders([COOP], zonen, 3, JETZT, erinnert) == []

    # Beim nächsten Besuch ist der Zeitpunkt ein anderer - und die
    # Erinnerung kommt wieder.
    spaeter = {"coop_willisau": {"state": "home", "changed_at": JETZT - 60}}
    assert due_reminders([COOP], spaeter, 3, JETZT + STAY_SECONDS, erinnert) == [COOP]


def test_leaving_stops_it():
    zonen = {"coop_willisau": {"state": "away", "changed_at": JETZT - STAY_SECONDS * 3}}
    assert due_reminders([COOP], zonen, 3, JETZT, {}) == []


def test_a_shop_without_a_zone_is_silent():
    """Ohne Zone weiss der Hub nicht, wo man ist - dann schweigt er,
    statt zu raten."""
    assert due_reminders([OHNE_ZONE], {}, 3, JETZT, {}) == []
    # Und eine Zone, von der noch nie etwas gemeldet wurde, ebenso.
    assert due_reminders([COOP], {}, 3, JETZT, {}) == []
    assert due_reminders([COOP], {"coop_willisau": {"state": "home"}}, 3, JETZT, {}) == []


def test_the_message_names_what_is_missing():
    """«5 Einträge» zwingt zum Nachsehen, die Namen beantworten es schon
    auf dem Sperrbildschirm."""
    titel, text = describe(COOP, [{"text": "Milch"}, {"text": "Brot"}])
    assert titel == "Du bist im Coop Willisau"
    assert text == "Milch, Brot"

    # Bei vielen Einträgen wird abgekürzt, statt die Nachricht zu fluten.
    viele = [{"text": f"Ding {i}"} for i in range(7)]
    _, text = describe(COOP, viele)
    assert text.endswith("und 3 weitere")
    assert text.startswith("Ding 0, Ding 1, Ding 2, Ding 3")
