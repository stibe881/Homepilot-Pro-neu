"""Die Prüfwerkzeuge aus der App (Punkt 344).

Die Werkzeuge selbst (storencheck, livecheck, …) tun, was sie schon
als Kommandozeile tun - hier geht es nur um die Route drumherum: wer
darf, welche Werkzeuge und Flags es gibt, und ob eine echte Antwort
beim Aufrufer ankommt.

Ein voller Lauf braucht einen erreichbaren Hub mit echten Geräten - das
ist hier nicht nachzustellen. Stattdessen wird geprüft, dass die Route
das Werkzeug wirklich startet, seine Ausgabe wirklich einsammelt und
unverändert zurückgibt: Ohne Token bricht z.B. pushcheck sofort mit
einer lesbaren Meldung ab - das reicht, um den ganzen Weg (Unterprozess
starten, stdout+stderr einsammeln, als JSON zurückgeben) echt zu
prüfen, ohne Geräte zu brauchen.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

USERS = [
    {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
    {"name": "Partnerin", "role": "bewohner", "token": "t-resident"},
]


def make_client() -> TestClient:
    hub = Hub(make_config(integrations=[{"integration": "demo"}], users=USERS))
    return TestClient(create_app(hub))


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_nur_der_besitzer_darf():
    with make_client() as client:
        assert (
            client.get("/api/diagnose", headers=auth("t-resident")).status_code == 403
        )
        assert (
            client.get(
                "/api/diagnose/pushcheck", headers=auth("t-resident")
            ).status_code
            == 403
        )


def test_die_liste_nennt_alle_fuenf():
    with make_client() as client:
        antwort = client.get("/api/diagnose", headers=auth("t-owner"))
        assert antwort.status_code == 200
        werkzeuge = antwort.json()["werkzeuge"]
        namen = {zeile["key"] for zeile in werkzeuge}
        assert namen == {
            # Punkt 491 der Werkbank: das eine, das alle fünf ruft -
            # und es steht zuoberst, weil man es zuerst greift, wenn man
            # nicht weiss, woran es liegt.
            "hauscheck",
            "storencheck",
            "livecheck",
            "tvcheck",
            "saugercheck",
            "pushcheck",
        }
        assert werkzeuge[0]["key"] == "hauscheck"


def test_ein_unbekanntes_werkzeug_gibt_404():
    with make_client() as client:
        antwort = client.get("/api/diagnose/erfunden", headers=auth("t-owner"))
        assert antwort.status_code == 404
        assert "erfunden" in antwort.json()["detail"]


def test_ein_unbekanntes_flag_gibt_400():
    with make_client() as client:
        antwort = client.get(
            "/api/diagnose/tvcheck", headers=auth("t-owner"), params={"flag": "kalt"}
        )
        assert antwort.status_code == 400
        assert "tvcheck" in antwort.json()["detail"]


def test_pushcheck_laeuft_wirklich_und_die_ausgabe_kommt_an():
    """Ohne Token (kein config.yaml, keine Umgebungsvariable im Test)
    bricht pushcheck sofort mit einer lesbaren Meldung ab - genau das
    beweist, dass die Route den Unterprozess wirklich startet und seine
    Ausgabe wirklich zurückgibt, nicht bloss simuliert."""
    with make_client() as client:
        antwort = client.get("/api/diagnose/pushcheck", headers=auth("t-owner"))
        assert antwort.status_code == 200
        daten = antwort.json()
        assert daten["exit_code"] != 0
        assert "Kein Token" in daten["text"]
