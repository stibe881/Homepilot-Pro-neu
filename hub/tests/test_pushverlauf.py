"""Der Nachlese-Zettel: was hat vorhin gebrummt?"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import pushverlauf
from homepilot.core.hub import Hub

from .conftest import make_config


def test_alte_meldungen_verfallen_und_der_zettel_bleibt_kurz():
    jetzt = 1_000_000.0
    rows = pushverlauf.anhaengen([], {"title": "Uralt"}, jetzt - 8 * 86400)
    rows = pushverlauf.anhaengen(rows, {"title": "Frisch"}, jetzt)
    assert [row["title"] for row in rows] == ["Frisch"]
    for nummer in range(pushverlauf.HOECHSTENS + 10):
        rows = pushverlauf.anhaengen(rows, {"title": f"M{nummer}"}, jetzt + nummer)
    assert len(rows) == pushverlauf.HOECHSTENS


def test_jeder_sieht_nur_seinen_zettel():
    """Dass Lina ans Medikament erinnert wurde, geht die anderen
    Telefone nichts an."""
    jetzt = 1_000_000.0
    rows = pushverlauf.anhaengen([], {"title": "An alle"}, jetzt)
    rows = pushverlauf.anhaengen(rows, {"title": "Für Lina", "to": ["Lina"]}, jetzt + 1)
    assert [row["title"] for row in pushverlauf.fuer(rows, "Lina")] == [
        "Für Lina",
        "An alle",
    ]
    assert [row["title"] for row in pushverlauf.fuer(rows, "Stefan")] == ["An alle"]


async def test_der_versand_schreibt_den_zettel():
    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-owner"}],
            integrations=[{"integration": "demo"}],
        )
    )
    with TestClient(create_app(hub)) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        hub.push.register("ExponentPushToken[x]", "Stefan")

        # Der Vermerk passiert vor dem Netz - eine Meldung, die bei Expo
        # hängenbleibt, war trotzdem eine. Der Test kappt das Netz.
        class KaputteSession:
            def post(self, *args, **kwargs):
                raise ConnectionError("kein Netz")

            async def close(self):
                pass

        hub.push._session_factory = lambda: KaputteSession()
        await hub.push.send(
            ["ExponentPushToken[x]"],
            title="Fenster offen",
            body="seit 2 Std",
            category="open",
        )
        antwort = client.get("/api/push/log", headers=kopf).json()
        assert antwort["log"][0]["title"] == "Fenster offen"
        # Stefan ist das einzige Telefon - das zählt als «an alle».
        assert antwort["log"][0]["to"] == []
