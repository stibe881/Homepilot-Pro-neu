"""Pflege und Nachlese der Alarmanlage (Punkte 481, 485, 489, 490).

Drei Fälle: eine Sirene, die seit dem Einbau nie geheult hat; ein
Handwerker, der einen Vormittag lang alle Fenster offen hat; und die
Frage nach dem Entschärfen, die die Fehlalarm-Statistik bisher raten
musste.
"""

from datetime import datetime

from homepilot.core import alarmpflege

# ── Sirenen-Selbsttest (Punkt 481) ────────────────────────────────────────


def test_der_selbsttest_laeuft_nur_mittags():
    mittags = datetime(2030, 6, 1, 12, 0)
    nachts = datetime(2030, 6, 1, 3, 0)
    assert alarmpflege.sirenentest_faellig(None, mittags) is True
    # Nachts wäre es ein Fehlalarm, den die Anlage selbst auslöst.
    assert alarmpflege.sirenentest_faellig(None, nachts) is False


def test_eine_nie_geprueste_sirene_ist_faellig():
    mittags = datetime(2030, 6, 1, 12, 0)
    assert alarmpflege.sirenentest_faellig(0, mittags) is True
    assert alarmpflege.sirenentest_faellig("unsinn", mittags) is True


def test_nach_dem_test_ist_ein_quartal_ruhe():
    mittags = datetime(2030, 6, 1, 12, 0)
    gerade = mittags.timestamp() - 10 * 86400
    assert alarmpflege.sirenentest_faellig(gerade, mittags) is False
    lang_her = mittags.timestamp() - 100 * 86400
    assert alarmpflege.sirenentest_faellig(lang_her, mittags) is True


def test_der_satz_sagt_wann_zuletzt_und_wann_wieder():
    jetzt = datetime(2030, 6, 1, 12, 0)
    assert "noch nie" in alarmpflege.sirenentest_satz(None, jetzt)
    vor_zehn = jetzt.timestamp() - 10 * 86400
    satz = alarmpflege.sirenentest_satz(vor_zehn, jetzt)
    assert "vor 10 Tagen" in satz
    assert "in 80 Tagen" in satz


# ── Wartungsmodus (Punkt 489) ─────────────────────────────────────────────


def test_der_wartungsmodus_endet_von_selbst():
    jetzt = 1_000_000.0
    wartung = alarmpflege.wartung_setzen(3, jetzt, "Stefan")
    assert alarmpflege.wartung_laeuft(wartung, jetzt + 3600) is True
    assert alarmpflege.wartung_laeuft(wartung, jetzt + 4 * 3600) is False


def test_eine_zu_lange_dauer_wird_geklemmt_statt_abgelehnt():
    """Sonst schaltet man die Anlage ganz aus - genau das soll er verhindern."""
    jetzt = 1_000_000.0
    wartung = alarmpflege.wartung_setzen(48, jetzt)
    assert wartung["until"] == jetzt + alarmpflege.WARTUNG_MAX_STUNDEN * 3600
    # Unsinn und null werden zur Vorgabe, nicht zu «gar nicht».
    assert alarmpflege.wartung_setzen("drei", jetzt)["until"] > jetzt
    assert alarmpflege.wartung_setzen(0, jetzt)["until"] > jetzt


def test_der_satz_nennt_die_restzeit_und_wer_es_war():
    jetzt = 1_000_000.0
    wartung = alarmpflege.wartung_setzen(3, jetzt, "Stefan")
    satz = alarmpflege.wartung_satz(wartung, jetzt)
    assert satz is not None
    assert "Stefan" in satz and "3 Stunden" in satz
    # Vorbei heisst: keine Zeile, statt einer, die eine Ausnahme behauptet.
    assert alarmpflege.wartung_satz(wartung, jetzt + 4 * 3600) is None


# ── Einen Alarm einordnen (Punkt 490) ─────────────────────────────────────


def test_nach_dem_entschaerfen_steht_die_frage_offen():
    # Jüngste zuerst, wie der Verlauf der Integration.
    history = [
        {"kind": "disarmed", "at": 200.0},
        {"kind": "triggered", "at": 100.0, "entity_id": "hm.flur", "text": "Alarm"},
    ]
    offen = alarmpflege.offener_alarm(history)
    assert offen is not None
    assert offen["entity_id"] == "hm.flur"


def test_ein_laufender_alarm_wird_nicht_gefragt():
    """Erst entschärfen, dann fragen - vorher ist die Frage nicht dran."""
    history = [{"kind": "triggered", "at": 100.0, "entity_id": "hm.flur"}]
    assert alarmpflege.offener_alarm(history) is None


def test_ein_eingeordneter_alarm_wird_nicht_nochmal_gefragt():
    history = [
        {"kind": "urteil", "at": 300.0, "urteil": "fehlalarm"},
        {"kind": "disarmed", "at": 200.0},
        {"kind": "triggered", "at": 100.0, "entity_id": "hm.flur"},
    ]
    assert alarmpflege.offener_alarm(history) is None


def test_nur_bekannte_urteile_zaehlen():
    assert alarmpflege.urteil_lesen("Fehlalarm") == "fehlalarm"
    assert alarmpflege.urteil_lesen("vielleicht") is None
    assert alarmpflege.urteil_lesen(None) is None


def test_gezaehlt_wird_was_ein_mensch_gesagt_hat():
    """Nicht, was die Zeit bis zum Entschärfen vermuten lässt."""
    history = [
        {"kind": "urteil", "at": 600.0, "urteil": "fehlalarm"},
        {"kind": "triggered", "at": 500.0, "entity_id": "hm.flur"},
        {"kind": "urteil", "at": 400.0, "urteil": "fehlalarm"},
        {"kind": "triggered", "at": 300.0, "entity_id": "hm.flur"},
        {"kind": "urteil", "at": 200.0, "urteil": "echt"},
        {"kind": "triggered", "at": 100.0, "entity_id": "hm.keller"},
    ]
    stand = alarmpflege.fehlalarm_zaehlen(history)
    assert stand["hm.flur"]["fehlalarm"] == 2
    assert stand["hm.keller"]["echt"] == 1
    auffaellig = alarmpflege.auffaellige_sensoren(history, mindest=2)
    assert [zeile["entity_id"] for zeile in auffaellig] == ["hm.flur"]
