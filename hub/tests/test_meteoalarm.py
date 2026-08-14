from homepilot.integrations.meteoalarm import max_severity, parse_feed

SAMPLE_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <title>MeteoAlarm Switzerland</title>
  <entry>
    <title>Gewitter Warnung</title>
    <cap:event>Thunderstorm</cap:event>
    <cap:severity>Moderate</cap:severity>
    <cap:onset>2026-08-14T12:00:00+02:00</cap:onset>
    <cap:expires>2026-08-14T20:00:00+02:00</cap:expires>
    <cap:areaDesc>Zentralschweiz</cap:areaDesc>
  </entry>
  <entry>
    <title>Sturm Warnung</title>
    <cap:event>Wind</cap:event>
    <cap:severity>Severe</cap:severity>
    <cap:areaDesc>Alpen</cap:areaDesc>
  </entry>
</feed>
"""


def test_parse_feed():
    alerts = parse_feed(SAMPLE_FEED)
    assert len(alerts) == 2
    assert alerts[0]["event"] == "Thunderstorm"
    assert alerts[0]["severity"] == "Moderate"
    assert alerts[0]["area"] == "Zentralschweiz"
    assert alerts[1]["expires"] is None


def test_max_severity():
    alerts = parse_feed(SAMPLE_FEED)
    assert max_severity(alerts) == "Severe"
    assert max_severity([]) is None
