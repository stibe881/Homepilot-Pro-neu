"""Konsolenzeit: die Regeln, ohne Uhr und ohne Konsole.

Das Beispiel kommt aus den Bildern: Dienstag, 16:00–19:00, 45 Minuten für
PS5 und Switch zusammen, Monatsgrenze 20 Stunden.
"""

from datetime import date

from homepilot.core import konsolenzeit as kz

DIENSTAG = date(2026, 11, 10)
SAMSTAG = date(2026, 11, 14)
MIN = 60.0


def _plan(**ueberschreibung):
    tage = [{"an": True, "von": 960, "bis": 1140, "minuten": 45} for _ in range(5)]
    tage[2] = {"an": False, "von": 960, "bis": 1140, "minuten": 45}  # Mittwoch frei
    tage += [
        {"an": True, "von": 540, "bis": 1140, "minuten": 120},  # Samstag
        {"an": True, "von": 540, "bis": 1080, "minuten": 90},  # Sonntag
    ]
    roh = {"aktiv": True, "tage": tage, "monat": 1200, **ueberschreibung}
    return kz.plan_lesen(roh)


def _rest(plan=None, minute=16 * 60 + 27, heute=0.0, monat=0.0, tag=DIENSTAG, **rest):
    return kz.rest_sekunden(plan or _plan(), tag, minute, heute, monat, **rest)


# ── Plan lesen ─────────────────────────────────────────────────────────────


def test_a_missing_plan_limits_nobody():
    assert kz.plan_lesen(None)["aktiv"] is False
    assert _rest(kz.plan_lesen({}))["rest_s"] is None


def test_garbage_in_the_plan_becomes_sane_values():
    plan = kz.plan_lesen(
        {"aktiv": 1, "tage": [{"von": "abc", "bis": -5, "minuten": 99999}], "monat": "x",
         "warnungen": [10, 7, "5", None], "konsolen": ["ps", "ps", "", None, "sw"]}
    )
    assert len(plan["tage"]) == 7
    assert plan["tage"][0]["minuten"] == kz.MAX_TAG_MINUTEN
    assert plan["tage"][0]["bis"] > plan["tage"][0]["von"]
    assert plan["monat"] is None
    # 7 ist keine Wahl, die die Oberfläche anbietet.
    assert plan["warnungen"] == [10, 5]
    assert plan["konsolen"] == ["ps", "sw"]


def test_a_window_that_ends_before_it_starts_runs_until_midnight():
    tag = kz.tag_lesen({"an": True, "von": 20 * 60, "bis": 6 * 60, "minuten": 30})
    assert tag["bis"] == 24 * 60


# ── Ferien ─────────────────────────────────────────────────────────────────


def test_in_the_holidays_a_weekday_gets_the_saturday_times():
    regel = kz.tag_regel(_plan(), DIENSTAG, ferien=True)
    assert (regel["von"], regel["minuten"]) == (540, 120)


def test_holidays_can_be_switched_off():
    regel = kz.tag_regel(_plan(ferien_wie_wochenende=False), DIENSTAG, ferien=True)
    assert regel["minuten"] == 45


def test_a_sunday_in_the_holidays_keeps_its_own_entry():
    sonntag = date(2026, 11, 15)
    assert kz.tag_regel(_plan(), sonntag, ferien=True)["minuten"] == 90


# ── Rest ───────────────────────────────────────────────────────────────────


def test_inside_the_window_the_daily_allowance_is_what_is_left():
    # Bild 4: 25 min gespielt, also 20 übrig.
    antwort = _rest(heute=25 * MIN)
    assert antwort["rest_s"] == 20 * MIN
    assert antwort["grund"] == ""


def test_the_window_closing_before_the_minutes_run_out_ends_the_time():
    # 18:50, noch 40 min erlaubt - aber das Fenster schliesst in 10.
    antwort = _rest(minute=18 * 60 + 50, heute=5 * MIN)
    assert antwort["rest_s"] == 10 * MIN
    assert antwort["grund"] == ""
    antwort = _rest(minute=19 * 60, heute=5 * MIN)
    assert antwort["rest_s"] == 0
    assert antwort["grund"] == kz.GRUND_FENSTER


def test_before_the_window_opens_there_is_no_time():
    antwort = _rest(minute=15 * 60 + 40)
    assert antwort["rest_s"] == 0
    assert antwort["grund"] == kz.GRUND_FENSTER


def test_a_day_without_gaming_has_no_time_at_all():
    mittwoch = date(2026, 11, 11)
    antwort = _rest(tag=mittwoch)
    assert antwort["rest_s"] == 0
    assert antwort["grund"] == kz.GRUND_KEIN_TAG


def test_a_used_up_day_says_the_day_is_over():
    antwort = _rest(heute=45 * MIN)
    assert antwort["rest_s"] == 0
    assert antwort["grund"] == kz.GRUND_TAG


def test_the_month_limit_wins_when_it_runs_out_first():
    # 19 h 50 min bereits gespielt: Der Tag hätte 45 min, der Monat 10.
    antwort = _rest(monat=(19 * 60 + 50) * MIN)
    assert antwort["rest_s"] == 10 * MIN
    antwort = _rest(monat=20 * 60 * MIN)
    assert antwort["rest_s"] == 0
    assert antwort["grund"] == kz.GRUND_MONAT


def test_when_day_and_month_are_both_full_the_day_is_named():
    antwort = _rest(heute=45 * MIN, monat=20 * 60 * MIN)
    assert antwort["grund"] == kz.GRUND_TAG


def test_without_a_month_limit_only_the_day_counts():
    antwort = _rest(_plan(monat=None), monat=9999 * MIN)
    assert antwort["monat_s"] is None
    assert antwort["rest_s"] == 45 * MIN


# ── Geben, frei, sperren ───────────────────────────────────────────────────


def test_given_minutes_are_added_to_the_day():
    assert _rest(heute=45 * MIN, bonus_minuten=15)["rest_s"] == 15 * MIN


def test_given_minutes_count_after_the_window_has_closed():
    """Sonst wäre «15 Minuten geben» um 19:05 ein Geschenk, das sich nicht
    einlösen lässt."""
    antwort = _rest(minute=19 * 60 + 5, heute=10 * MIN, bonus_minuten=15)
    assert antwort["rest_s"] == 15 * MIN


def test_given_minutes_are_used_up_only_after_the_regular_ones():
    # 50 min gespielt von 45 + 15: Die letzten 5 waren geschenkt.
    antwort = _rest(heute=50 * MIN, bonus_minuten=15)
    assert antwort["rest_s"] == 10 * MIN


def test_given_minutes_on_a_day_without_gaming_work_too():
    mittwoch = date(2026, 11, 11)
    assert _rest(tag=mittwoch, bonus_minuten=20)["rest_s"] == 20 * MIN


def test_free_day_lifts_window_and_daily_minutes_but_not_the_month():
    antwort = _rest(_plan(monat=None), minute=22 * 60, heute=300 * MIN, frei=True)
    assert antwort["rest_s"] is None
    antwort = _rest(minute=22 * 60, frei=True, monat=(19 * 60 + 30) * MIN)
    assert antwort["rest_s"] == 30 * MIN
    antwort = _rest(frei=True, monat=20 * 60 * MIN)
    assert antwort["grund"] == kz.GRUND_MONAT


def test_a_manual_lock_beats_everything():
    antwort = _rest(frei=True, bonus_minuten=60, gesperrt=True)
    assert antwort["rest_s"] == 0
    assert antwort["grund"] == kz.GRUND_GESPERRT


# ── Warnungen ──────────────────────────────────────────────────────────────


def test_crossing_ten_minutes_warns_once():
    assert kz.warnstufe(10 * MIN + 5, 10 * MIN - 5, [10, 5, 1]) == 10
    assert kz.warnstufe(10 * MIN - 5, 10 * MIN - 20, [10, 5, 1]) is None


def test_a_long_gap_warns_with_the_most_urgent_step_only():
    # Der Hub war eine Weile weg: nicht dreimal hintereinander durchsagen.
    assert kz.warnstufe(11 * MIN, 4 * MIN, [10, 5, 1]) == 5


def test_starting_with_little_time_left_gives_no_late_warning():
    assert kz.warnstufe(None, 3 * MIN, [10, 5, 1]) is None
    assert kz.warnstufe(3 * MIN, 3 * MIN - 15, [10, 5, 1]) is None


def test_no_warning_once_the_time_is_over():
    assert kz.warnstufe(30, 0, [10, 5, 1]) is None


def test_unlimited_time_never_warns():
    assert kz.warnstufe(None, None, [10, 5, 1]) is None


# ── Zählen ─────────────────────────────────────────────────────────────────


def test_a_gap_after_a_restart_is_not_counted_as_played():
    assert kz.luecke_zaehlt(15) == 15
    assert kz.luecke_zaehlt(kz.MAX_LUECKE_SEKUNDEN + 1) == 0
    assert kz.luecke_zaehlt(-30) == 0


def test_the_month_sums_only_its_own_calendar_month():
    tage = {
        "2026-10-31": {"gesamt": 3600},
        "2026-11-01": {"gesamt": 1800},
        "2026-11-09": {"gesamt": 900},
        "2026-12-01": {"gesamt": 7200},
        "2026-11-10": "kaputt",
    }
    assert kz.monat_summe(tage, DIENSTAG) == 2700


def test_month_pace_names_a_child_who_is_ahead_of_the_month():
    # Bild 1: Tag 10 von 30, 9 h 05 von 20 h - etwas schneller.
    tempo = kz.monatstempo((9 * 60 + 5) * MIN, 1200, DIENSTAG)
    assert tempo is not None
    assert round(tempo["strich"], 2) == 0.33
    assert tempo["urteil"] == "schneller"


def test_month_pace_is_calm_for_a_child_within_the_plan():
    assert kz.monatstempo(4 * 60 * MIN, 1200, DIENSTAG)["urteil"] == "im_plan"
    assert kz.monatstempo(20 * 60 * MIN, 1200, DIENSTAG)["urteil"] == "voll"
    assert kz.monatstempo(1, None, DIENSTAG) is None


# ── Texte ──────────────────────────────────────────────────────────────────


def test_duration_texts_read_like_the_pictures():
    assert kz.dauer_text(45 * MIN) == "45 min"
    assert kz.dauer_text((9 * 60 + 5) * MIN) == "9 h 5 min"
    assert kz.dauer_text(2 * 3600) == "2 h"
    assert kz.dauer_text(20) == "unter einer Minute"
    assert kz.zeit_text(960) == "16:00"


def test_the_announcements_use_the_childs_name_and_swiss_spelling():
    assert "Maja, noch 5 Minuten" in kz.warn_text("Maja", 5)
    assert "eine Minute" in kz.warn_text("Maja", 1)
    for grund in (kz.GRUND_TAG, kz.GRUND_FENSTER, kz.GRUND_MONAT, kz.GRUND_GESPERRT, kz.GRUND_KEIN_TAG):
        text = kz.ende_text("Maja", grund)
        assert text.startswith("Maja,")
        assert "ß" not in text
