from datetime import datetime, timedelta

import pytest

from homepilot.core.errors import ConfigError
from homepilot.core.users import (
    Capability,
    Role,
    User,
    UserRegistry,
    parse_hours,
    parse_users,
)


def registry(entries, legacy=None):
    return parse_users(entries, legacy)


OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}
RESIDENT = {"name": "Partnerin", "role": "bewohner", "token": "t-resident"}
GUEST = {"name": "Gast", "role": "gast", "token": "t-guest"}


def test_lookup_by_token():
    users = registry([OWNER, RESIDENT])
    assert users.by_token("t-owner").name == "Stefan"
    assert users.by_token("t-resident").role == Role.RESIDENT
    assert users.by_token("falsch") is None
    assert users.by_token(None) is None


def test_capabilities_per_role():
    users = registry([OWNER, RESIDENT, GUEST])
    owner = users.by_token("t-owner")
    resident = users.by_token("t-resident")
    guest = users.by_token("t-guest")

    assert owner.can(Capability.MANAGE_USERS)
    assert owner.can(Capability.EDIT_AUTOMATIONS)

    # Bewohner bedienen alles und dürfen pausieren, aber nichts umbauen.
    assert resident.can(Capability.CONTROL)
    assert resident.can(Capability.PAUSE_AUTOMATIONS)
    assert not resident.can(Capability.EDIT_AUTOMATIONS)
    assert not resident.can(Capability.MANAGE_USERS)

    # Gäste dürfen schalten, aber nichts über das Haus erfahren.
    assert guest.can(Capability.CONTROL)
    assert not guest.can(Capability.VIEW_HISTORY)
    assert not guest.can(Capability.VIEW_SYSTEM)
    assert not guest.can(Capability.VIEW_AUTOMATIONS)


def test_guest_sees_only_lights_and_switches_by_default():
    guest = registry([OWNER, GUEST]).by_token("t-guest")
    assert guest.may_see("hue.stehlampe", "light")
    assert guest.may_see("mqtt.sonoff_kueche", "switch")
    assert not guest.may_see("unifi.anyone_home", "binary_sensor")
    assert not guest.may_see("ring.haustuer", "camera")


def test_guest_allow_list_overrides_default():
    guest = registry(
        [OWNER, {**GUEST, "allow": ["hue.*"]}]
    ).by_token("t-guest")
    assert guest.may_see("hue.stehlampe", "light")
    # Mit ausdrücklicher Liste zählt nur noch diese.
    assert not guest.may_see("mqtt.sonoff_kueche", "switch")


def test_other_roles_see_everything():
    resident = registry([OWNER, RESIDENT]).by_token("t-resident")
    assert resident.may_see("ring.haustuer", "camera")


def test_legacy_token_becomes_owner():
    users = registry([], legacy="altes-token")
    user = users.by_token("altes-token")
    assert user is not None and user.role == Role.OWNER
    assert not users.open_access


def test_open_access_without_any_user():
    users = registry([])
    assert users.open_access
    assert users.by_token(None).role == Role.OWNER


def test_unknown_role_is_rejected():
    with pytest.raises(ConfigError, match="Unbekannte Rolle"):
        registry([{"name": "X", "role": "chef", "token": "t"}])


def test_at_least_one_owner_required():
    with pytest.raises(ConfigError, match="besitzer"):
        registry([RESIDENT])


def test_config_users_cannot_be_removed_via_api():
    """Was in der config.yaml steht, gehört der Datei – nicht der App."""
    users = registry([OWNER, RESIDENT])
    with pytest.raises(ConfigError, match="config.yaml"):
        users.remove("Partnerin")


def test_last_owner_cannot_be_removed():
    from homepilot.core.users import User

    users = registry([OWNER])
    users.add(User(name="Zweiter", role=Role.OWNER, token="t2", editable=True))
    assert users.remove("Zweiter")

    # Der letzte Besitzer bleibt, auch wenn er in der App angelegt wurde.
    solo = registry([])
    solo.open_access = False
    solo.add(User(name="Einzig", role=Role.OWNER, token="t", editable=True))
    with pytest.raises(ConfigError, match="letzte Besitzer"):
        solo.remove("Einzig")


def test_changes_are_reported_for_saving():
    from homepilot.core.users import User

    saved = []
    users = registry([OWNER])
    users.on_change = saved.append
    users.add(User(name="Gast", role=Role.GUEST, token="g", editable=True))

    assert len(saved) == 1
    # Nur die in der App angelegten werden gespeichert.
    assert [entry["name"] for entry in saved[0]] == ["Gast"]
    assert saved[0][0]["token"] == "g"


def test_duplicate_name_is_rejected():
    from homepilot.core.users import User

    users = registry([OWNER])
    with pytest.raises(ConfigError, match="existiert bereits"):
        users.add(User(name="Stefan", role=Role.GUEST, token="x"))


def test_gast_bereiche_steuern_sichtbarkeit():
    from homepilot.core.users import User

    gast = User(
        name="G", role="gast", token="t",
        features=["licht", "storen", "haustuere"],
    )
    assert gast.may_see("hue.wohnzimmer", "light", "hue")
    assert gast.may_see("overkiz.storen", "cover", "overkiz")
    assert gast.may_see("ring.intercom", "lock", "ring")          # Haustüre
    assert not gast.may_see("nuki.wohnungstuer", "lock", "nuki")  # nicht freigegeben
    assert not gast.may_see("weather.forecast", "weather", "weather")
    assert not gast.may_see("vzug.geschirrspueler", "appliance", "vzug")

    tuer = User(name="T", role="gast", token="t2", features=["wohnungstuere"])
    assert tuer.may_see("nuki.wohnungstuer", "lock", "nuki")
    assert not tuer.may_see("ring.intercom", "lock", "ring")

    # Kameras sind nur mit eigener Freigabe sichtbar.
    assert not gast.may_see("unifi_protect.eingang", "camera", "unifi_protect")
    kamera = User(name="K", role="gast", token="t3", features=["kameras"])
    assert kamera.may_see("unifi_protect.eingang", "camera", "unifi_protect")
    assert not kamera.may_see("hue.wohnzimmer", "light", "hue")


def test_gast_ohne_bereiche_behaelt_standard():
    from homepilot.core.users import User

    gast = User(name="G", role="gast", token="t")
    assert gast.may_see("hue.licht", "light", "hue")
    assert not gast.may_see("overkiz.storen", "cover", "overkiz")


def test_deaktivierter_benutzer_kommt_nicht_rein():
    from homepilot.core.users import User, UserRegistry

    registry = UserRegistry(
        [
            User(name="S", role="besitzer", token="t-owner"),
            User(name="G", role="gast", token="t-guest", editable=True),
        ]
    )
    assert registry.by_token("t-guest") is not None
    registry.update("G", enabled=False)
    assert registry.by_token("t-guest") is None
    # Wieder aktivieren – dasselbe Token funktioniert erneut.
    registry.update("G", enabled=True)
    assert registry.by_token("t-guest").name == "G"


def test_update_validiert_bereiche():
    import pytest as _pytest

    from homepilot.core.errors import ConfigError
    from homepilot.core.users import User, UserRegistry

    registry = UserRegistry([User(name="G", role="gast", token="t", editable=True)])
    registry.update("G", features=["licht", "familie"])
    assert registry.by_name("G").features == ["licht", "familie"]
    with _pytest.raises(ConfigError):
        registry.update("G", features=["quatsch"])


def test_an_expired_guest_is_no_longer_let_in():
    """Ein Wochenendgast, den man von Hand sperren müsste, bleibt sonst für
    immer drin – daran denkt man genau einmal."""
    gestern = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    morgen = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    abgelaufen = User(name="Gast", role=Role.GUEST, token="t", expires=gestern)
    gueltig = User(name="Gast2", role=Role.GUEST, token="t2", expires=morgen)
    assert abgelaufen.active() is False
    assert gueltig.active() is True

    registry = UserRegistry([abgelaufen, gueltig])
    assert registry.by_token("t") is None
    assert registry.by_token("t2") is not None
    # Sichtbar bleibt er trotzdem – sonst rätselt man, wem man Zugang gab.
    assert len(registry.users) == 2


def test_a_time_window_limits_when_someone_may_control():
    kind = User(
        name="Levin", role=Role.RESIDENT, token="t", hours={"from": "07:00", "to": "20:00"}
    )
    assert kind.active(datetime(2026, 8, 17, 12, 0)) is True
    assert kind.active(datetime(2026, 8, 17, 6, 59)) is False
    assert kind.active(datetime(2026, 8, 17, 23, 30)) is False


def test_a_window_across_midnight_works():
    """Nachtruhe ist der Normalfall für so ein Fenster – 22:00 bis 06:00
    darf nicht als leere Menge gelesen werden."""
    nacht = User(
        name="Nacht", role=Role.RESIDENT, token="t", hours={"from": "22:00", "to": "06:00"}
    )
    assert nacht.active(datetime(2026, 8, 17, 23, 0)) is True
    assert nacht.active(datetime(2026, 8, 17, 3, 0)) is True
    assert nacht.active(datetime(2026, 8, 17, 12, 0)) is False


def test_half_a_window_is_no_window():
    """«ab 07:00» allein ist mehrdeutig: bis Mitternacht oder für immer?"""
    assert parse_hours({"from": "07:00"}) == {}
    assert parse_hours({"from": "07:00", "to": "quatsch"}) == {}
    assert parse_hours({"from": "07:00", "to": "20:00"}) == {"from": "07:00", "to": "20:00"}
    assert parse_hours(None) == {}


def test_rename_haelt_token_und_rechte_und_weist_doppelte_ab():
    """Der Profilname ist der Benutzername - umbenennen heisst: derselbe
    Mensch, neuer Name, alles andere bleibt."""
    from homepilot.core.errors import HomePilotError
    from homepilot.core.users import UserRegistry

    registry = UserRegistry(
        [
            User(name="Stefan", role=Role.OWNER, token="t1", editable=True),
            User(name="Bine", role=Role.RESIDENT, token="t2", editable=True),
        ]
    )
    umbenannt = registry.rename("Stefan", "Stefano")
    assert umbenannt.name == "Stefano"
    assert umbenannt.token == "t1"
    assert umbenannt.role == Role.OWNER
    assert registry.by_name("Stefan") is None

    # Ein schon vergebener Name würde zwei Menschen ununterscheidbar machen.
    try:
        registry.rename("Stefano", "Bine")
        raise AssertionError("doppelter Name wurde angenommen")
    except HomePilotError:
        pass
    # Leer ist kein Name.
    try:
        registry.rename("Stefano", "   ")
        raise AssertionError("leerer Name wurde angenommen")
    except HomePilotError:
        pass


def test_rename_verweigert_benutzer_aus_der_config():
    """Was in der config.yaml steht, dreht der nächste Neustart zurück -
    die Fehlermeldung ist ehrlicher als eine Änderung auf Zeit."""
    from homepilot.core.errors import HomePilotError
    from homepilot.core.users import UserRegistry

    registry = UserRegistry([User(name="Stefan", role=Role.OWNER, token="t")])
    try:
        registry.rename("Stefan", "Stefano")
        raise AssertionError("config-Benutzer wurde umbenannt")
    except HomePilotError as err:
        assert "config.yaml" in str(err)


# ── Rechte je Raum ───────────────────────────────────────────────────────
#
# Ein Kind soll sein Zimmer schalten dürfen, aber nicht die Haustüre und
# nicht die Alarmanlage. Über die Rolle ging das nicht: «Bewohner» heisst
# ganzes Haus, «Gast» heisst Freigaben nach Geräteart - und damit kein
# eigenes Zimmer.


def test_ohne_raumliste_gilt_weiter_das_ganze_haus():
    """Der Normalfall und der Zustand, in dem alle Benutzer starten."""
    resident = registry([OWNER, RESIDENT]).by_token("t-resident")
    assert resident.may_see("ring.haustuer", "camera", "ring", "Flur")
    assert resident.may_see("hue.decke", "light", "hue", None)


def test_mit_raumliste_bleibt_der_rest_der_wohnung_draussen():
    levin = registry(
        [OWNER, {"name": "Levin", "role": "bewohner", "token": "t-levin",
                 "rooms": ["Kinderzimmer Levin"]}]
    ).by_token("t-levin")
    assert levin.may_see("hue.levin", "light", "hue", "Kinderzimmer Levin")
    assert not levin.may_see("nuki.haustuer", "lock", "nuki", "Flur")
    assert not levin.may_see("alarm.haus", "alarm", "alarm", "Flur")


def test_geraete_ohne_raum_fallen_heraus():
    """«Nur diese Räume» heisst nicht «diese Räume und alles Ortlose».

    Der Stromzähler und die Anwesenheit gehören niemandem Bestimmten -
    und sind genau das, wovor der Schnitt schützen soll.
    """
    levin = registry(
        [OWNER, {"name": "Levin", "role": "bewohner", "token": "t-levin",
                 "rooms": ["Kinderzimmer Levin"]}]
    ).by_token("t-levin")
    assert not levin.may_see("geofence.anyone_home", "binary_sensor", "geofence", None)


def test_der_raum_nimmt_weg_und_gibt_nie_dazu():
    """Ein Gast mit Raum bekommt den Schnitt aus beidem.

    Die Kamera im freigegebenen Raum bleibt gesperrt, weil «Kameras»
    nicht freigegeben ist; die Lampe im fremden Raum bleibt gesperrt,
    weil der Raum nicht dazugehört.
    """
    gast = registry(
        [OWNER, {**GUEST, "features": ["licht"], "rooms": ["Gästezimmer"]}]
    ).by_token("t-guest")
    assert gast.may_see("hue.gast", "light", "hue", "Gästezimmer")
    assert not gast.may_see("ring.gast", "camera", "ring", "Gästezimmer")
    assert not gast.may_see("hue.wohnzimmer", "light", "hue", "Wohnzimmer")


def test_eine_kaputte_raumliste_faellt_beim_laden_auf():
    with pytest.raises(ConfigError):
        registry([OWNER, {**RESIDENT, "rooms": "Kinderzimmer"}])
