"""Was ein abgelaufener Gast hinterlässt (Punkt 498 der Werkbank).

Der Fall: Ein Gastpass läuft ab - und die offene Sitzung, der WLAN-Schein
und die Protokollzeilen bleiben. Nach einem Jahr Gästen ist das die
längste Liste im Haus.
"""

from types import SimpleNamespace

from homepilot.core import gastspur


def gast(name, rolle="gast", frist=None):
    return SimpleNamespace(name=name, role=rolle, expires=frist)


def test_erst_nach_der_nachfrist():
    users = [gast("Besuch", frist="2030-06-01")]
    # Am Tag danach noch nicht - ein verlängerter Besuch soll nicht bei
    # null anfangen.
    assert gastspur.abgelaufene_gaeste(users, "2030-06-02") == []
    assert gastspur.abgelaufene_gaeste(users, "2030-06-16") == ["Besuch"]


def test_nur_gaeste_und_nur_mit_frist():
    users = [
        gast("Stefan", rolle="besitzer", frist="2020-01-01"),
        gast("Dauergast", frist=None),
        gast("Besuch", frist="2030-06-01"),
    ]
    assert gastspur.abgelaufene_gaeste(users, "2030-07-01") == ["Besuch"]


def test_ein_tippfehler_im_datum_loescht_keinen_zugang():
    users = [gast("Besuch", frist="morgen")]
    assert gastspur.abgelaufene_gaeste(users, "2030-07-01") == []


def test_sitzungen_und_scheine_gehen_mit():
    sitzungen = [{"user": "Besuch", "hash": "a"}, {"user": "Stefan", "hash": "b"}]
    assert gastspur.sitzungen_ohne(sitzungen, ["Besuch"]) == [
        {"user": "Stefan", "hash": "b"}
    ]
    scheine = [{"fuer": "Besuch", "code": "x"}, {"fuer": "Nachbar", "code": "y"}]
    assert gastspur.scheine_ohne(scheine, ["Besuch"]) == [
        {"fuer": "Nachbar", "code": "y"}
    ]


def test_ohne_treffer_bleibt_alles_stehen():
    sitzungen = [{"user": "Stefan"}]
    assert gastspur.sitzungen_ohne(sitzungen, []) == sitzungen
    assert gastspur.scheine_ohne(None, ["X"]) == []


def test_der_bericht_schweigt_wenn_nichts_war():
    """«0 Spuren entfernt» ist eine Zeile, die man weglernt wegzulesen."""
    assert gastspur.bericht([], 0, 0) is None
    satz = gastspur.bericht(["Besuch"], 1, 2)
    assert satz is not None
    assert "Besuch" in satz and "1 Sitzung" in satz and "2 WLAN-Schein" in satz
    # Viele Namen werden gekürzt - eine Protokollzeile mit zwanzig Namen
    # liest niemand.
    viele = gastspur.bericht(["A", "B", "C", "D", "E"], 0, 0)
    assert "2 weitere" in (viele or "")


# ── Was ein Kind nie schaltet (Punkt 497) ─────────────────────────────────


def test_ein_kind_schaltet_weder_schloss_noch_anlage():
    from homepilot.core.users import Role, kind_darf_schalten

    assert kind_darf_schalten(Role.KID, "light") is True
    assert kind_darf_schalten(Role.KID, "lock") is False
    assert kind_darf_schalten(Role.KID, "alarm") is False
    # Für alle anderen gilt weiter, was may_see und die Fähigkeiten sagen.
    for rolle in (Role.OWNER, Role.RESIDENT, Role.GUEST):
        assert kind_darf_schalten(rolle, "lock") is True
        assert kind_darf_schalten(rolle, "alarm") is True
