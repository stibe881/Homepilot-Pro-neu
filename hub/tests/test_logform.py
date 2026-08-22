"""JSON-Protokollzeilen: eine jq-Abfrage statt grep und hoffen."""

import json
import logging

from homepilot.core.logform import JsonFormatter, wants_json


def test_a_record_becomes_one_json_line():
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="homepilot.integrations.homematic",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="CCU auf Port %s nicht erreichbar",
        args=(2010,),
        exc_info=None,
    )
    zeile = json.loads(formatter.format(record))
    assert zeile["level"] == "WARNING"
    assert zeile["logger"] == "homepilot.integrations.homematic"
    assert zeile["message"] == "CCU auf Port 2010 nicht erreichbar"


def test_the_switch_reads_the_environment(monkeypatch):
    monkeypatch.delenv("HOMEPILOT_LOG", raising=False)
    assert wants_json() is False
    monkeypatch.setenv("HOMEPILOT_LOG", "json")
    assert wants_json() is True
    monkeypatch.setenv("HOMEPILOT_LOG", "JSON ")
    assert wants_json() is True
