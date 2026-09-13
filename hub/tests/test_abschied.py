"""Wer den Haushalt verlässt, hinterlässt alles (Punkt 628).

Der Fall: Die Au-pair zieht aus. DELETE /api/users/{name} rief nur
hub.users.remove - Sitzungen, Telefone, Einstellungen, Ortungsspur,
Personenbild und die Ämtli-Reihen blieben, und im Ämtli-Plan stand sie
weiter «dran».
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import abschied
from homepilot.core.hub import Hub

from .conftest import make_config

BESTAND = {
    "users": [{"name": "Stefan", "role": "besitzer"}, {"name": "Anna"}, {"name": "Levin"}],
    "emails": [{"name": "Anna", "email": "a@example.ch"}],
    "sessions": [{"user": "Anna", "hash": "abc"}, {"user": "Anna", "hash": "def"},
                 {"user": "Levin", "hash": "ghi"}],
    "user_prefs": [{"user": "Anna", "prefs": {}}],
    "push_devices": [{"user": "Anna", "token": "ExponentPushToken[a]"}],
    "push_prefs": [{"user": "Anna", "aus": ["battery"]}],
    "person_prefs": [{"zone": "anna", "meldungen": {}}],
    "presence_last": [{"zone": "anna", "state": "home"}],
    "presence_history": [{"person": "anna", "state": "home", "at": 1.0},
                         {"person": "levin", "state": "away", "at": 2.0}],
    "family_chores": [
        {"text": "Abfall", "member": "Anna", "members": ["Anna", "Levin", "Stefan"]},
        {"text": "Bad", "member": "Levin", "members": ["Levin", "Anna"]},
        {"text": "Küche", "member": "Stefan", "members": ["Stefan"]},
    ],
    "family_tasks": [{"text": "Zahnarzt", "member": "Anna"}],
    "family_rewards": [{"member": "Anna", "points": 5}, {"member": "Levin", "points": 2}],
    "family_reminders": [{"text": "Miete", "push_an": ["Anna", "Stefan"], "quittiert": ["Anna"]}],
    "family_polls": [{"text": "Pizza?", "votes": {"Anna": "ja", "Levin": "nein"}}],
    "family_recipes": [{"title": "Risotto", "author": "Anna"}],
    "audit": [{"user": "Anna", "command": "turn_on"}],
}


def test_die_bilanz_zaehlt_was_am_namen_haengt():
    bilanz = abschied.bilanz(BESTAND, "Anna", "anna")
    assert bilanz == {
        "geraete": 2,
        "push_geraete": 1,
        "einstellungen": 3,  # E-Mail, Oberfläche, Push-Einstellungen
        "ortung": 3,
        "aemtli": 2,  # dran beim Abfall, in der Reihe beim Bad
        "aufgaben": 1,
        "erinnerungen": 1,
        "punkte": 1,
    }
    # Wer nichts hinterlässt, bekommt eine leere Bilanz - kein Satz voller Nullen.
    assert abschied.bilanz(BESTAND, "Niemand", "niemand") == {}


def test_der_satz_sagt_was_mitgeht():
    bilanz = abschied.bilanz(BESTAND, "Anna", "anna")
    assert abschied.satz("Anna", bilanz, bild=True) == (
        "Anna entfernen? 2 Geräte, 1 Push-Telefon, Bild, 2 Ämtli, 1 Aufgabe, "
        "1 Erinnerung, 1 Punktekonto, 3 Ortungsspuren, 3 Einstellungen"
    )
    assert abschied.satz("Gast", {}, bild=False) == (
        "Gast entfernen? An diesem Namen hängt sonst nichts."
    )
    assert abschied.satz("Gast", {}, bild=True) == "Gast entfernen? Bild"


def test_der_zugang_und_die_spuren_verschwinden():
    neu, bericht = abschied.abschied(BESTAND, "Anna", "anna")
    assert neu["emails"] == []
    assert [row["user"] for row in neu["sessions"]] == ["Levin"]
    assert neu["push_devices"] == [] and neu["push_prefs"] == [] and neu["user_prefs"] == []
    assert neu["person_prefs"] == [] and neu["presence_last"] == []
    assert [row["person"] for row in neu["presence_history"]] == ["levin"]
    assert bericht["sessions"] == 2 and bericht["presence_history"] == 1
    # Der Benutzer selbst bleibt hier stehen - ihn entfernt hub.users.remove,
    # mit seinen eigenen Regeln (letzter Besitzer, config.yaml).
    assert [row["name"] for row in neu["users"]] == ["Stefan", "Anna", "Levin"]
    # Und das Zugriffsprotokoll bleibt, was es ist: ein Protokoll.
    assert neu["audit"] == BESTAND["audit"]


def test_die_aemtli_werden_uebergeben_nicht_geloescht():
    """Der Abfall muss weiter raus - ohne Wunsch rückt die Reihe weiter,
    wie beim Abhaken, nur ohne die Person, die geht."""
    neu, _ = abschied.abschied(BESTAND, "Anna", "anna")
    abfall, bad, kueche = neu["family_chores"]
    assert abfall["member"] == "Levin"
    assert abfall["members"] == ["Levin", "Stefan"]
    assert bad["member"] == "Levin" and bad["members"] == ["Levin"]
    assert kueche == BESTAND["family_chores"][2]
    # Die offene Aufgabe steht ohne Zuständigen da - sichtbar leer statt
    # still bei jemandem, der nicht mehr da ist.
    assert neu["family_tasks"][0]["member"] is None


def test_der_verwalter_bestimmt_wer_uebernimmt():
    neu, bericht = abschied.abschied(BESTAND, "Anna", "anna", aemtli_an="Stefan")
    assert neu["family_chores"][0]["member"] == "Stefan"
    assert neu["family_tasks"][0]["member"] == "Stefan"
    assert bericht["family_chores"] == 2 and bericht["family_tasks"] == 1


def test_bleibt_niemand_in_der_reihe_steht_das_aemtli_leer():
    assert abschied.uebernehmer(["Anna"], "Anna") is None
    assert abschied.uebernehmer(["Anna", "Levin"], "Anna") == "Levin"
    assert abschied.uebernehmer(["Anna", "Levin"], "Anna", wunsch="Stefan") == "Stefan"
    # Ein Wunsch, der die Person selbst nennt, ist keiner.
    assert abschied.uebernehmer(["Anna", "Levin"], "Anna", wunsch="Anna") == "Levin"


def test_was_den_anderen_gehoert_bleibt():
    """Ein Kochbuch verliert seine Rezepte nicht, weil die Köchin auszieht."""
    neu, bericht = abschied.abschied(BESTAND, "Anna", "anna")
    assert neu["family_recipes"] == [{"title": "Risotto", "author": "Anna"}]
    assert "family_recipes" not in bericht
    # Punkte ohne Person sind niemandes Punkte.
    assert neu["family_rewards"] == [{"member": "Levin", "points": 2}]
    # Aus Reihen und Abstimmungen verschwindet der Name, die Zeile bleibt.
    assert neu["family_reminders"] == [{"text": "Miete", "push_an": ["Stefan"], "quittiert": []}]
    assert neu["family_polls"][0]["votes"] == {"Levin": "nein"}


def test_ohne_namen_passiert_nichts():
    neu, bericht = abschied.abschied(BESTAND, "")
    assert neu == BESTAND and bericht == {}


# ── Die Route ─────────────────────────────────────────────────────────────


def _hub(tmp_path) -> Hub:
    return Hub(
        make_config(
            token="geheim",
            users=[{"name": "Stefan", "role": "besitzer", "token": "t-stefan"}],
            data_file=str(tmp_path / "homepilot-data.json"),
        )
    )


OWNER = {"Authorization": "Bearer geheim"}


def test_das_loeschen_raeumt_auf_und_uebergibt_die_aemtli(tmp_path):
    hub = _hub(tmp_path)
    with TestClient(create_app(hub)) as client:
        for name in ("Anna", "Levin"):
            assert client.post(
                "/api/users",
                json={"name": name, "role": "bewohner", "password": "start1234"},
                headers=OWNER,
            ).status_code == 200
        token = client.post(
            "/api/auth/login", json={"email": "Anna", "password": "start1234", "label": "iPhone"}
        ).json()["token"]
        hub.push.register("ExponentPushToken[anna]", "Anna")
        hub.data.set(
            "family_chores",
            [{"text": "Abfall", "member": "Anna", "members": ["Anna", "Levin"]}],
        )
        hub.data.set("presence_last", [{"zone": "anna", "state": "home"}])

        vorschau = client.get("/api/users/Anna/abschied", headers=OWNER)
        assert vorschau.status_code == 200
        assert vorschau.json()["bilanz"] == {
            "geraete": 1, "push_geraete": 1, "ortung": 1, "aemtli": 1,
        }
        assert vorschau.json()["satz"].startswith("Anna entfernen? 1 Gerät, 1 Push-Telefon")
        assert vorschau.json()["uebernehmer"] == ["Stefan", "Levin"]

        # Eine Übergabe an jemanden, den es nicht gibt, prallt ab - bevor
        # irgendetwas gelöscht ist.
        assert client.delete("/api/users/Anna?aemtli_an=Niemand", headers=OWNER).status_code == 400
        assert client.get("/api/users/Anna/pairing", headers=OWNER).status_code == 200

        weg = client.delete("/api/users/Anna?aemtli_an=Levin", headers=OWNER)
        assert weg.status_code == 200, weg.text
        assert weg.json()["bericht"]["family_chores"] == 1
        assert weg.json()["aemtli_an"] == "Levin"
        assert hub.data.get("family_chores")[0]["member"] == "Levin"
        assert hub.data.get("family_chores")[0]["members"] == ["Levin"]
        assert hub.data.get("presence_last") == []
        # Die Sitzung ist weg, das Telefon auch - im Speicher und in der Datei.
        assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
        assert not any(d.user == "Anna" for d in hub.push.devices)
        assert not any(row.get("user") == "Anna" for row in hub.data.get("push_devices"))


def test_ein_gescheitertes_loeschen_laesst_alles_stehen(tmp_path):
    """Der letzte Besitzer lässt sich nicht entfernen - dann darf auch
    nichts von dem verschwinden, was an ihm hängt."""
    hub = _hub(tmp_path)
    with TestClient(create_app(hub)) as client:
        assert client.post(
            "/api/users",
            json={"name": "Bine", "role": "besitzer", "password": "start1234"},
            headers=OWNER,
        ).status_code == 200
        hub.data.set("family_chores", [{"text": "Abfall", "member": "Bine", "members": ["Bine"]}])
        # «Bine» ist in der App angelegt, Stefan steht in der config.yaml
        # - beide Besitzer; erst Stefan kaputt machen ginge nicht. Also
        # der andere Weg: Bine bleibt die einzige löschbare Besitzerin, und
        # sich selbst darf man nicht löschen.
        bine = client.post(
            "/api/auth/login", json={"email": "Bine", "password": "start1234"}
        ).json()["token"]
        antwort = client.delete("/api/users/Bine", headers={"Authorization": f"Bearer {bine}"})
        assert antwort.status_code == 400
        assert hub.data.get("family_chores")[0]["member"] == "Bine"
