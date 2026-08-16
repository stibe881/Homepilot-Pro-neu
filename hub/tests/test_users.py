import pytest

from homepilot.core.errors import ConfigError
from homepilot.core.users import Capability, Role, parse_users


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
