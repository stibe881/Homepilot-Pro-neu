"""Familienlisten: Papierkorb, Rhythmus, Wochenausblick, Kochstempel."""

from __future__ import annotations

from datetime import date, datetime

from homepilot.core import bilder, familie, familienbuch, shopping, trash, users

# ── Papierkorb (Punkt 167) ───────────────────────────────────────────────


def test_a_deleted_task_keeps_its_readable_name():
    korb = trash.put([], "tasks", {"id": "a1", "text": "Grüngut rausstellen"}, "Stefan")
    assert korb[0]["name"] == "Grüngut rausstellen"
    row, rest = trash.take(korb, "tasks", "a1")
    assert row is not None and rest == []


# ── Erledigtes verschwindet (Punkt 170) ──────────────────────────────────


def test_only_things_done_a_week_ago_are_cleared():
    heute = date(2026, 8, 22)
    rows = [
        {"id": "1", "text": "alt", "done": True, "done_at": "2026-08-10"},
        {"id": "2", "text": "frisch", "done": True, "done_at": "2026-08-21"},
        {"id": "3", "text": "offen"},
    ]
    assert [row["id"] for row in familie.stale_done(rows, heute)] == ["1"]


def test_done_without_a_date_stays_put():
    # Lieber einer zu viel als einer zu früh weg.
    rows = [{"id": "1", "text": "irgendwann", "done": True}]
    assert familie.stale_done(rows, date(2026, 8, 22)) == []


# ── Rhythmus der Einkaufsliste (Punkt 176) ───────────────────────────────


def test_milk_every_seven_days_is_due_after_nine():
    jetzt = 1_000_000.0
    tag = 86400.0
    log: list[dict] = []
    for tage_her in (9, 16, 23, 30):
        log = shopping.log_item(log, "Milch", jetzt - tage_her * tag)
    faellig = shopping.rhythm(log, jetzt)
    assert faellig and faellig[0]["text"] == "Milch"
    assert faellig[0]["interval"] == 7
    assert faellig[0]["days_since"] == 9


def test_two_times_is_coincidence_not_a_rhythm():
    jetzt = 1_000_000.0
    log: list[dict] = []
    for tage_her in (3, 10):
        log = shopping.log_item(log, "Kapern", jetzt - tage_her * 86400.0)
    assert shopping.rhythm(log, jetzt) == []


def test_something_bought_yesterday_is_not_due():
    jetzt = 1_000_000.0
    log: list[dict] = []
    for tage_her in (1, 8, 15, 22):
        log = shopping.log_item(log, "Brot", jetzt - tage_her * 86400.0)
    assert shopping.rhythm(log, jetzt) == []


# ── Geburtstage mit Vorlauf (Punkt 180) ──────────────────────────────────


def test_birthdays_three_days_ahead():
    kontakte = [
        {"text": "Livia", "birthday": "25.08.2015"},
        {"text": "Opa", "birthday": "01.12.1950"},
    ]
    treffer = familie.birthdays_in(kontakte, date(2026, 8, 22), 3)
    assert [(versatz, k["text"]) for versatz, k in treffer] == [(3, "Livia")]


# ── Wochenausblick (Punkt 204) ───────────────────────────────────────────


def test_the_week_ahead_gathers_all_three_sources():
    text = familie.week_ahead(
        [{"summary": "Elternabend", "start": "2026-08-25T19:00"}],
        [{"text": "Steuererklärung", "due": "2026-08-26", "member": "Stefan"}],
        [{"text": "Bad putzen", "due": "2026-08-27"}],
        [{"text": "Livia", "birthday": "28.08.2015"}],
        date(2026, 8, 23),
    )
    assert text is not None
    assert "Elternabend" in text and "Steuererklärung (Stefan)" in text
    assert "Livia hat Geburtstag" in text


def test_a_quiet_week_sends_nothing():
    # Eine wöchentliche Push mit «diese Woche: nichts» schaltet man ab.
    assert familie.week_ahead([], [], [], [], date(2026, 8, 23)) is None


# ── Wochenplan füttert «zuletzt gekocht» (Punkt 218) ─────────────────────


def test_a_dish_planned_for_tuesday_counts_on_wednesday():
    dienstag = date(2026, 8, 25)
    meals = [{"day": "Dienstag", "text": "Lasagne"}]
    recipes = [{"id": "r1", "text": "Lasagne", "cooked_count": 2}]
    neu = familie.cooked_from_plan(meals, recipes, dienstag)
    assert neu[0]["last_cooked"] == "2026-08-25"
    assert neu[0]["cooked_count"] == 3


def test_the_cook_mode_does_not_count_twice():
    dienstag = date(2026, 8, 25)
    meals = [{"day": "Dienstag", "recipe_id": "r1"}]
    recipes = [{"id": "r1", "text": "Lasagne", "last_cooked": "2026-08-25", "cooked_count": 3}]
    assert familie.cooked_from_plan(meals, recipes, dienstag)[0]["cooked_count"] == 3


def test_a_dish_without_a_recipe_changes_nothing():
    meals = [{"day": "Dienstag", "text": "Pizza vom Kurier"}]
    recipes = [{"id": "r1", "text": "Lasagne"}]
    assert familie.cooked_from_plan(meals, recipes, date(2026, 8, 25)) == recipes


# ── Zugang läuft ab (Punkt 185) ──────────────────────────────────────────


def test_the_window_ends_before_midnight():
    jetzt = datetime(2026, 8, 22, 20, 0)
    ende = users.access_end("2026-08-22", {"from": "19:00", "to": "23:00"}, jetzt)
    assert ende == datetime(2026, 8, 22, 23, 0)


def test_a_window_over_midnight_ends_tomorrow():
    jetzt = datetime(2026, 8, 22, 23, 30)
    ende = users.access_end(None, {"from": "19:00", "to": "01:00"}, jetzt)
    assert ende == datetime(2026, 8, 23, 1, 0)


def test_without_window_the_date_decides():
    jetzt = datetime(2026, 8, 22, 20, 0)
    ende = users.access_end("2026-08-23", {}, jetzt)
    assert ende is not None and ende.date() == date(2026, 8, 23)


# ── Rezeptbilder (Punkt 193) ─────────────────────────────────────────────


def test_a_data_uri_becomes_bytes_and_an_extension():
    # 1×1 Pixel als PNG.
    winzig = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
        "IQAAAABJRU5ErkJggg=="
    )
    ergebnis = bilder.decode_data_uri(winzig)
    assert ergebnis is not None
    roh, endung = ergebnis
    assert endung == "png" and roh.startswith(b"\x89PNG")


def test_a_finished_address_is_not_a_data_uri():
    assert bilder.decode_data_uri("/api/recipes/r1/bild?v=abc") is None


def test_an_id_that_could_escape_the_folder_is_refused():
    assert bilder.safe_id("../../etc/passwd") is None
    assert bilder.safe_id("r1_abc-XYZ") == "r1_abc-XYZ"


# ── Familienbuch (Punkt 169) ─────────────────────────────────────────────


def test_the_family_book_is_one_readable_page():
    seite = familienbuch.render(
        {
            "family_contacts": [{"id": "c1", "text": "Kinderärztin", "phone": "041 111 22 33"}],
            "family_recipes": [{"id": "r1", "text": "Lasagne"}],
        },
        "22.08.2026",
    )
    assert "<!doctype html>" in seite
    assert "Kinderärztin" in seite and "041 111 22 33" in seite
    assert "Lasagne" in seite
    # Nichts nachzuladen: keine fremden Adressen in der Seite.
    assert "http://" not in seite and "https://" not in seite


def test_the_book_escapes_what_people_typed():
    seite = familienbuch.render(
        {"family_contacts": [{"id": "c1", "text": "<script>alert(1)</script>"}]},
        "22.08.2026",
    )
    assert "<script>alert" not in seite
