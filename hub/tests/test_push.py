"""Der Expo-Dienst antwortet auch bei Fehlern mit HTTP 200.

Der Status steht je Nachricht in der Antwort – wer nur auf den HTTP-Code
schaut, meldet «verschickt», obwohl nichts ankommt. Genau das prüfen die
Tests hier.
"""

from homepilot.core.push import (
    PushService,
    is_expo_token,
    parse_receipts,
    parse_tickets,
)

TOKEN = "ExponentPushToken[abcdefghijklmnopqrst]"
OTHER = "ExponentPushToken[uvwxyz01234567890abc]"


def test_is_expo_token():
    assert is_expo_token(TOKEN)
    assert not is_expo_token("irgendwas")


def test_parse_tickets_counts_accepted_messages():
    payload = {"data": [{"status": "ok", "id": "TICKET-1"}]}
    result, dead = parse_tickets(payload, [TOKEN])
    assert result.accepted == 1
    assert result.ticket_ids == ["TICKET-1"]
    assert result.errors == []
    assert dead == []


def test_parse_tickets_reports_rejected_message_and_dead_token():
    payload = {
        "data": [
            {
                "status": "error",
                "message": "…is not a registered push notification recipient",
                "details": {"error": "DeviceNotRegistered"},
            }
        ]
    }
    result, dead = parse_tickets(payload, [TOKEN])
    assert result.accepted == 0
    assert len(result.errors) == 1
    # Der rohe Code hilft niemandem – es braucht den Klartext.
    assert "abgemeldet" in result.errors[0]
    assert dead == [TOKEN]


def test_parse_tickets_mixes_ok_and_error():
    payload = {
        "data": [
            {"status": "ok", "id": "TICKET-1"},
            {"status": "error", "message": "zu gross", "details": {"error": "MessageTooBig"}},
        ]
    }
    result, dead = parse_tickets(payload, [TOKEN, OTHER])
    assert result.accepted == 1
    assert result.ticket_ids == ["TICKET-1"]
    assert len(result.errors) == 1
    # MessageTooBig macht das Gerät nicht tot.
    assert dead == []


def test_parse_tickets_survives_nonsense():
    result, dead = parse_tickets("kaputt", [TOKEN])
    assert result.accepted == 0
    assert result.errors
    assert dead == []


def test_parse_receipts_finds_undelivered_messages():
    payload = {
        "data": {
            "TICKET-1": {"status": "ok"},
            "TICKET-2": {
                "status": "error",
                "message": "abgelehnt",
                "details": {"error": "InvalidCredentials"},
            },
        }
    }
    problems = parse_receipts(payload)
    assert len(problems) == 1
    assert "Zugangsdaten" in problems[0]


def test_parse_receipts_empty_when_all_delivered():
    assert parse_receipts({"data": {"TICKET-1": {"status": "ok"}}}) == []


def test_send_without_registered_device_reports_it():
    import asyncio

    service = PushService()
    result = asyncio.run(service.send([], title="Test", body="Test"))
    assert result.accepted == 0

    # Ein Token, den Expo nie ausgestellt hat, ist keiner.
    result = asyncio.run(service.send(["kaputt"], title="Test", body="Test"))
    assert result.accepted == 0
    assert result.errors
