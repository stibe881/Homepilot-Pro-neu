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
