"""Die Einmal-Türöffnung selbst - nicht ihre Routen.

Die Routen-Tests daneben prüfen, dass die Schnittstelle die richtigen
Antworten gibt; hier steht die Logik dahinter: wann ein Link gilt, wann
er ausgestellt werden darf und dass alle Fehlwege von aussen gleich
aussehen. Das ist die sicherheitsrelevante Hälfte, und sie war bisher
nur mittelbar abgedeckt.
"""

from __future__ import annotations

import time

import pytest

from homepilot.core.guestpass import (
    DEFAULT_MINUTES,
    MAX_MINUTES,
    MAX_OPEN,
    MAX_WINDOW_DAYS,
    Pass,
    PassStore,
    seite,
    tuerennamen,
)

TUER = [("nuki.haustuer", "unlock")]
BEIDE = [("nuki.haustuer", "unlock"), ("nuki.wohnung", "unlock")]


# ── Ausstellen ─────────────────────────────────────────────────────────────


def test_a_pass_without_targets_opens_nothing():
    with pytest.raises(ValueError):
        PassStore().create([], created_by="Stefan")


def test_the_default_pass_lasts_fifteen_minutes_from_now():
    entry = PassStore().create(TUER, created_by="Stefan")
    assert entry.expires == pytest.approx(time.time() + DEFAULT_MINUTES * 60, abs=2)
    assert not entry.pending()
    assert entry.used_at is None


def test_minutes_are_clamped_to_the_allowed_range():
    kurz = PassStore().create(TUER, created_by="Stefan", minutes=0)
    assert kurz.expires == pytest.approx(time.time() + 60, abs=2)
    lang = PassStore().create(TUER, created_by="Stefan", minutes=999)
    assert lang.expires == pytest.approx(time.time() + MAX_MINUTES * 60, abs=2)


def test_an_end_in_the_past_is_refused():
    with pytest.raises(ValueError):
        PassStore().create(TUER, created_by="Stefan", until=time.time() - 1)


def test_an_end_before_the_start_is_refused():
    starts = time.time() + 3600
    with pytest.raises(ValueError):
        PassStore().create(TUER, created_by="Stefan", starts=starts, until=starts - 60)


def test_a_window_longer_than_the_maximum_is_refused():
    # Ein Link, den man vor einem halben Jahr ausgestellt und vergessen
    # hat, ist kein Zugang mehr, sondern ein Loch.
    with pytest.raises(ValueError):
        PassStore().create(
            TUER,
            created_by="Stefan",
            until=time.time() + (MAX_WINDOW_DAYS * 86400) + 3600,
        )


def test_tokens_are_long_random_and_unique():
    store = PassStore()
    eins = store.create(TUER, created_by="Stefan")
    zwei = store.create(TUER, created_by="Stefan")
    assert eins.token != zwei.token
    # 32 Byte Zufall - Raten ist keine Angriffsart.
    assert len(eins.token) >= 40


def test_the_oldest_expiring_pass_is_evicted_beyond_the_limit():
    store = PassStore()
    erster = store.create(TUER, created_by="Stefan", minutes=1)
    for _ in range(MAX_OPEN):
        store.create(TUER, created_by="Stefan", minutes=MAX_MINUTES)
    assert len(store.all()) == MAX_OPEN
    assert store.get(erster.token) is None


# ── Einlösen ───────────────────────────────────────────────────────────────


def test_redeeming_marks_the_pass_used():
    store = PassStore()
    entry = store.create(BEIDE, created_by="Stefan")
    eingeloest = store.redeem(entry.token)
    assert eingeloest is entry
    assert eingeloest.used_at is not None
    # Die Reihenfolge der Ziele bleibt: erst Haustüre, dann Wohnungstüre.
    assert [eid for eid, _ in eingeloest.targets] == ["nuki.haustuer", "nuki.wohnung"]


def test_all_four_failure_modes_are_indistinguishable_from_outside():
    # Wer Adressen durchprobiert, soll aus der Antwort nichts lernen -
    # auch nicht, dass es sich lohnt, später wiederzukommen.
    store = PassStore()

    gebraucht = store.create(TUER, created_by="Stefan")
    store.redeem(gebraucht.token)

    abgelaufen = store.create(TUER, created_by="Stefan")
    abgelaufen.expires = time.time() - 1

    zukunft = store.create(TUER, created_by="Stefan", starts=time.time() + 3600)
    assert zukunft.pending()

    meldungen = set()
    for token in ("gibts-nicht", gebraucht.token, abgelaufen.token, zukunft.token):
        with pytest.raises(KeyError) as err:
            store.redeem(token)
        meldungen.add(str(err.value))
    assert meldungen == {"'Dieser Link gilt nicht mehr'"}


def test_a_pass_cannot_be_redeemed_twice():
    store = PassStore()
    entry = store.create(TUER, created_by="Stefan")
    store.redeem(entry.token)
    with pytest.raises(KeyError):
        store.redeem(entry.token)


def test_a_pending_pass_exists_but_does_not_open_yet():
    store = PassStore()
    entry = store.create(TUER, created_by="Stefan", starts=time.time() + 3600)
    # Sichtbar in der Verwaltung, wertlos an der Türe.
    assert store.get(entry.token) is entry
    with pytest.raises(KeyError):
        store.redeem(entry.token)


# ── Aufräumen und Widerrufen ───────────────────────────────────────────────


def test_used_passes_stay_visible_until_they_expire():
    # Die App zeigt «benutzt um 14:32» - dafür muss der Eintrag noch da sein.
    store = PassStore()
    entry = store.create(TUER, created_by="Stefan")
    store.redeem(entry.token)
    assert store.get(entry.token) is entry
    entry.expires = time.time() - 1
    store.purge()
    assert store.get(entry.token) is None


def test_revoke_removes_a_pass_and_reports_whether_it_existed():
    store = PassStore()
    entry = store.create(TUER, created_by="Stefan")
    assert store.revoke(entry.token)
    assert not store.revoke(entry.token)
    with pytest.raises(KeyError):
        store.redeem(entry.token)


def test_all_lists_the_latest_expiring_first():
    store = PassStore()
    kurz = store.create(TUER, created_by="Stefan", minutes=5)
    lang = store.create(TUER, created_by="Stefan", minutes=60)
    assert [entry.token for entry in store.all()] == [lang.token, kurz.token]


# ── Darstellung ────────────────────────────────────────────────────────────


def test_as_dict_builds_the_link_from_the_base_url():
    entry = PassStore().create(BEIDE, created_by="Stefan", label="Paketbote")
    row = entry.as_dict("http://hub.local:8123/")
    assert row["url"] == f"http://hub.local:8123/einmal/{entry.token}"
    assert row["entity_id"] == "nuki.haustuer"
    assert row["command"] == "unlock"
    assert row["label"] == "Paketbote"
    assert row["pending"] is False
    assert row["seconds_left"] > 0
    ohne = entry.as_dict()
    assert "url" not in ohne


def test_tuerennamen_drops_doors_the_hub_no_longer_knows():
    entry = Pass(
        token="t",
        targets=[("nuki.haustuer", "unlock"), ("nuki.alt", "unlock")],
        expires=time.time() + 60,
        created_by="Stefan",
    )
    # «nuki.alt» hilft vor der Türe niemandem - lieber weglassen.
    assert tuerennamen(entry, {"nuki.haustuer": "Haustüre"}) == ["Haustüre"]


def test_the_visitor_page_opens_only_via_post():
    # GET öffnete früher die Türe - Link-Vorschauen von Messengern und
    # Mailservern lösten den Pass aus, bevor ihn ein Mensch sah.
    mit_knopf = seite("Türe öffnen", "Einmal gültig.", knopf="Öffnen")
    assert 'method="post"' in mit_knopf
    assert "Öffnen" in mit_knopf
    ohne_knopf = seite("Vorbei", "Dieser Link gilt nicht mehr.")
    assert "<form" not in ohne_knopf
