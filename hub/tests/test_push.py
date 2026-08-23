"""Der Expo-Dienst antwortet auch bei Fehlern mit HTTP 200.

Der Status steht je Nachricht in der Antwort – wer nur auf den HTTP-Code
schaut, meldet «verschickt», obwohl nichts ankommt. Genau das prüfen die
Tests hier.
"""

from types import SimpleNamespace

from homepilot.core import push as push_module
from homepilot.core.push import (
    PushService,
    is_expo_token,
    parse_muted,
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


def test_parse_muted_drops_unknown_keys():
    """Eine umbenannte Kategorie darf niemanden stillschweigend stumm
    schalten – dann kommen die Nachrichten lieber wieder."""
    parsed = parse_muted(
        [
            {"user": "Stefan", "muted": ["battery", "gibtsnicht"]},
            {"muted": ["alarm"]},
            "kaputt",
        ]
    )
    assert parsed == {"Stefan": {"battery"}}


def test_muted_categories_do_not_reach_the_user():
    """Der Kern der Einstellung: Wer die Batteriewarnung abbestellt hat,
    bekommt sie nicht – den Alarm aber weiterhin."""
    service = PushService()
    service.register("ExponentPushToken[a]", "Stefan")
    service.register("ExponentPushToken[b]", "Partnerin")
    service.muted = {"Stefan": {"battery"}}
    users = [
        SimpleNamespace(name="Stefan", role="besitzer"),
        SimpleNamespace(name="Partnerin", role="bewohner"),
    ]

    assert service.recipients(users, "all", "battery") == ["ExponentPushToken[b]"]
    assert len(service.recipients(users, "all", "alarm")) == 2
    # Ohne Kategorie – etwa beim Push-Test – gilt keine Abbestellung.
    assert len(service.recipients(users, "all")) == 2


# ── Je meldender Ablauf ein eigener Schalter ─────────────────────────────
#
# Vorher lief alles unter der einen Kategorie «Nachricht aus einem
# Ablauf»: Wer die Gefriertruhe nicht mehr gemeldet haben wollte,
# schaltete damit auch «Jemand weint im Kinderzimmer» ab.


def _ablauf(id_, alias, category=None, meldet=True, sonst=False):
    aktion = {"type": "notify", "title": alias}
    return SimpleNamespace(
        id=id_,
        alias=alias,
        category=category,
        actions=[] if sonst else ([aktion] if meldet else [{"type": "command"}]),
        otherwise=[aktion] if sonst else [],
    )


def test_der_schluessel_haengt_an_der_kennung():
    # Am Namen wäre er zerbrechlich: Ein umbenannter Ablauf poppte sonst
    # wieder bei allen auf, die ihn abbestellt haben.
    assert push_module.automation_key("app_1") == "automation:app_1"
    assert push_module.is_automation("automation:app_1")
    assert not push_module.is_automation("battery")


def test_nur_meldende_ablaeufe_bekommen_einen_schalter():
    zeilen = push_module.automation_categories(
        [
            _ablauf("a", "Gefriertruhe zu warm", "Push"),
            _ablauf("b", "Licht bei Bewegung", meldet=False),
            _ablauf("c", "Ging nicht", sonst=True),
        ]
    )
    assert [zeile["key"] for zeile in zeilen] == ["automation:a", "automation:c"]
    # Die Kategorie des Ablaufs ist die Gruppe im Profil.
    assert zeilen[0]["group"] == "Push"
    # Ohne Kategorie: unter «Aus Abläufen».
    assert zeilen[1]["group"] == "Aus Abläufen"


def test_eine_abbestellung_gilt_nur_fuer_ihren_ablauf():
    service = PushService()
    service.register("ExponentPushToken[a]", "Stefan")
    service.muted = {"Stefan": {"automation:a"}}
    users = [SimpleNamespace(name="Stefan", role="besitzer")]
    assert service.recipients(users, "all", "automation:a") == []
    assert service.recipients(users, "all", "automation:b") == ["ExponentPushToken[a]"]


def test_schluessel_aus_ablaeufen_ueberleben_das_speichern():
    # parse_muted wirft Unbekanntes weg - die Schlüssel aus Abläufen
    # stehen aber in keiner festen Liste und müssen trotzdem bleiben.
    parsed = parse_muted([{"user": "Stefan", "muted": ["automation:app_7", "quatsch"]}])
    assert parsed == {"Stefan": {"automation:app_7"}}


def test_die_alte_sammelkategorie_wird_aufgeteilt():
    rows = [
        {"user": "Stefan", "muted": ["automation", "battery"]},
        {"user": "Livia", "muted": ["alarm"]},
    ]
    gewandelt = push_module.migrate_muted(rows, ["automation:a", "automation:b"])
    assert gewandelt is not None
    stefan = next(zeile for zeile in gewandelt if zeile["user"] == "Stefan")
    assert set(stefan["muted"]) == {"automation:a", "automation:b", "battery"}
    # Wer sie nie abbestellt hatte, bleibt unberührt.
    livia = next(zeile for zeile in gewandelt if zeile["user"] == "Livia")
    assert livia["muted"] == ["alarm"]
    # Und ein zweiter Lauf schreibt nicht noch einmal.
    assert push_module.migrate_muted(gewandelt, ["automation:a"]) is None
