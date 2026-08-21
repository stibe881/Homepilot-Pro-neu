from homepilot.integrations.mqtt import parse_payload, split_topic


def test_split_topic():
    assert split_topic("tele/sonoff_kueche/STATE") == ("tele", "sonoff_kueche", "STATE")
    assert split_topic("stat/haus/kueche/POWER") == ("stat", "haus/kueche", "POWER")
    assert split_topic("kaputt") is None


def test_lwt_sets_availability():
    assert parse_payload("LWT", "Online") == ({}, True)
    assert parse_payload("LWT", "Offline") == ({}, False)


def test_power_message():
    assert parse_payload("POWER", "ON") == ({"state": "on"}, None)
    assert parse_payload("POWER", "OFF") == ({"state": "off"}, None)
    assert parse_payload("POWER", "Unsinn") == ({}, None)


def test_power_message_respects_relay():
    # Relais 2 darf sich nicht von der Meldung für Relais 1 beeinflussen lassen.
    assert parse_payload("POWER1", "ON", relay=2) == ({}, None)
    assert parse_payload("POWER2", "ON", relay=2) == ({"state": "on"}, None)


def test_state_json():
    payload = '{"Time":"2026-08-14T20:00:00","Uptime":"1T02:03:04","POWER":"ON"}'
    assert parse_payload("STATE", payload) == ({"state": "on"}, None)


def test_state_json_multi_relay():
    payload = '{"POWER1":"ON","POWER2":"OFF"}'
    assert parse_payload("STATE", payload, relay=1) == ({"state": "on"}, None)
    assert parse_payload("STATE", payload, relay=2) == ({"state": "off"}, None)


def test_sensor_values():
    payload = (
        '{"Time":"2026-08-14T20:00:00",'
        '"AM2301":{"Temperature":21.5,"Humidity":48.0},'
        '"ENERGY":{"Power":37.2,"Today":0.85},'
        '"TempUnit":"C"}'
    )
    changes, available = parse_payload("SENSOR", payload)
    assert available is None
    assert changes == {
        "temperature": 21.5,
        "humidity": 48.0,
        "power": 37.2,
        "energy_today": 0.85,
    }


def test_invalid_json_is_ignored():
    assert parse_payload("STATE", "{kaputt") == ({}, None)
    assert parse_payload("RESULT", "[]") == ({}, None)


def test_unknown_suffix_is_ignored():
    assert parse_payload("UPTIME", "irgendwas") == ({}, None)


def _integration(**config):
    from homepilot.integrations.mqtt import MqttIntegration

    integration = MqttIntegration(hub=None, config={"broker": "b", **config})  # type: ignore[arg-type]
    integration._tls = bool(config.get("tls", False))
    integration._tls_insecure = bool(config.get("tls_insecure", False))
    return integration


def test_ohne_tls_bleibt_es_wie_bisher():
    """Die Vorgabe ändert sich nicht – None heisst bei aiomqtt «kein TLS»."""
    assert _integration()._tls_context() is None


def test_mit_tls_werden_zertifikate_geprueft():
    context = _integration(tls=True)._tls_context()
    assert context is not None
    assert context.check_hostname is True


def test_tls_insecure_verschluesselt_ohne_pruefung():
    """Für einen Broker mit selbst ausgestelltem Zertifikat – und nur
    dann. Dass man es hinschreiben muss, ist der Punkt."""
    import ssl

    context = _integration(tls=True, tls_insecure=True)._tls_context()
    assert context is not None
    assert context.check_hostname is False
    assert context.verify_mode == ssl.CERT_NONE
