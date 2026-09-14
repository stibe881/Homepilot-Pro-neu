"""Das Einschaltverhalten nach Stromausfall (Punkt 630 der Werkbank).

stromrueckkehr.py sagte selbst: «Wer den Blitz loswerden will, stellt es
am Gerät ein.» Genau das konnte der Hub nicht. Hier: Hue liest und
schreibt ``powerup``, Homematic den POWERUP-Parameter im MASTER-Paramset,
und beide sprechen dieselben drei Wörter wie Zigbee.
"""

from __future__ import annotations

import pytest

from homepilot.core.errors import HomePilotError
from homepilot.integrations import homematic_channels as hmc
from homepilot.integrations import hue
from homepilot.integrations.homematic import HomematicIntegration

# ── Hue ──────────────────────────────────────────────────────────────────


def test_hue_liest_die_voreinstellungen_der_bridge():
    assert hue.powerup_lesen({"preset": "powerfail"}) == "previous"
    # «safety» ist der Blitz um drei Uhr nachts: an, volle Helligkeit.
    assert hue.powerup_lesen({"preset": "safety"}) == "on"
    assert hue.powerup_lesen({"preset": "last_on_state"}) == "on"
    assert hue.powerup_lesen({"preset": "custom", "on": {"mode": "previous"}}) == "previous"
    assert (
        hue.powerup_lesen({"preset": "custom", "on": {"mode": "on", "on": {"on": False}}})
        == "off"
    )
    # Umschalten bietet der Hub nicht an - dann steht «anders» da.
    assert hue.powerup_lesen({"preset": "custom", "on": {"mode": "toggle"}}) == "other"
    assert hue.powerup_lesen(None) is None
    assert hue.powerup_lesen({}) is None


def test_hue_schreibt_die_drei_woerter_als_powerup():
    assert hue.powerup_body("previous") == {"preset": "powerfail"}
    assert hue.powerup_body("on") == {"preset": "safety"}
    # «aus» gibt es nur als eigene Einstellung.
    assert hue.powerup_body("off") == {
        "preset": "custom",
        "on": {"mode": "on", "on": {"on": False}},
    }
    with pytest.raises(HomePilotError):
        hue.powerup_body("toggle")


async def test_eine_hue_leuchte_bringt_ihr_einschaltverhalten_mit():
    from .test_hue_szenen import _hue

    hub, bridge = await _hue()
    try:
        await bridge._apply_light(
            {
                "id": "l-1",
                "metadata": {"name": "Stehlampe"},
                "on": {"on": True},
                "dimming": {"brightness": 40},
                "powerup": {"preset": "safety", "configured": True},
            }
        )
        entity = hub.registry.get("hue.l-1")
        assert entity is not None
        assert "set_power_on" in entity.commands
        assert entity.state["power_on"] == "on"
        # Eine Leuchte ohne powerup (ältere Firmware) bekommt den Befehl nicht.
        await bridge._apply_light({"id": "l-2", "on": {"on": False}})
        alt = hub.registry.get("hue.l-2")
        assert alt is not None and "set_power_on" not in alt.commands
    finally:
        await hub.stop()


# ── Homematic ────────────────────────────────────────────────────────────

BESCHREIBUNG = {
    "POWERUP_SWITCH_STATE": {
        "TYPE": "ENUM",
        "VALUE_LIST": ["PERMANENT_OFF", "PERMANENT_ON", "RESTORE_LAST"],
    },
    "LOGGING": {"TYPE": "BOOL"},
}


def test_homematic_findet_den_powerup_parameter_in_der_beschreibung():
    assert hmc.powerup_parameter(BESCHREIBUNG) == (
        "POWERUP_SWITCH_STATE",
        ["PERMANENT_OFF", "PERMANENT_ON", "RESTORE_LAST"],
    )
    # Ohne Aufzählung kein Einschaltverhalten - und keine Attrappe.
    assert hmc.powerup_parameter({"LOGGING": {"TYPE": "BOOL"}}) is None
    assert hmc.powerup_parameter("") is None


def test_homematic_uebersetzt_die_aufzaehlung_in_die_drei_woerter():
    werte = ["PERMANENT_OFF", "PERMANENT_ON", "RESTORE_LAST"]
    # Die CCU liefert die Nummer …
    assert hmc.powerup_lesen(0, werte) == "off"
    assert hmc.powerup_lesen(1, werte) == "on"
    assert hmc.powerup_lesen(2, werte) == "previous"
    # … manchmal den Namen.
    assert hmc.powerup_lesen("PERMANENT_ON", werte) == "on"
    assert hmc.powerup_lesen(7, werte) is None
    assert hmc.powerup_index(werte, "previous") == 2
    assert hmc.powerup_index(werte, "off") == 0
    # Ein Aktor, der nur aus und an kennt, kann «wie vorher» nicht.
    assert hmc.powerup_index(["PERMANENT_OFF", "PERMANENT_ON"], "previous") is None


class _CCU:
    """Eine CCU mit einem Schaltaktor, der sein MASTER-Paramset hergibt."""

    def __init__(self) -> None:
        self.master: dict[str, object] = {"POWERUP_SWITCH_STATE": 1}
        self.calls: list[tuple[str, tuple, int]] = []

    async def call(self, method: str, *args, port: int = 0):
        self.calls.append((method, args, port))
        if method == "listDevices":
            return [{"ADDRESS": "0001D3C99C6A2B:3", "TYPE": "HmIP-PS", "PARENT": "0001D3C99C6A2B"}]
        if method == "getValue":
            return True
        if method == "getParamsetDescription" and args[1] == "MASTER":
            return BESCHREIBUNG
        if method == "getParamset" and args[1] == "MASTER":
            return dict(self.master)
        if method == "putParamset":
            self.master.update(args[2])
            return ""
        return ""


async def test_ein_hmip_aktor_bekommt_den_befehl_und_stellt_ihn_ueber_master(hub):
    ccu = _CCU()
    integration = HomematicIntegration(
        hub,
        {
            "integration": "homematic",
            "host": "127.0.0.1",
            "port": 2001,
            "callback_port": 0,
            "devices": [
                {"address": "0001D3C99C6A2B:3", "port": 2010, "name": "Stehlampe", "kind": "switch"}
            ],
        },
    )
    integration._call = ccu.call  # type: ignore[method-assign]
    await integration.setup()
    try:
        # Das Lesen läuft im Hintergrund, damit der Start nicht wartet.
        await integration._powerup_lesen()
        entity = hub.registry.get("homematic.0001D3C99C6A2B_3")
        assert entity is not None
        assert "set_power_on" in entity.commands
        assert entity.state["power_on"] == "on"

        await integration.handle_command(entity, "set_power_on", {"mode": "previous"})
        geschrieben = [args for method, args, _ in ccu.calls if method == "putParamset"]
        assert geschrieben == [("0001D3C99C6A2B:3", "MASTER", {"POWERUP_SWITCH_STATE": 2})]
        assert hub.registry.get(entity.id).state["power_on"] == "previous"

        # Was der Aktor nicht kennt, wird lesbar abgewiesen.
        with pytest.raises(HomePilotError, match="nur"):
            await integration.handle_command(entity, "set_power_on", {"mode": "toggle"})
    finally:
        await integration.teardown()
