"""Eigene Ablauf-Vorlagen - und die eingebauten, die niemand braucht.

Der Fall dahinter: Die Vorlagenliste kam ausschliesslich aus dem
Gerätebestand. Der Hub schlug vor, was er anbieten konnte; dazutun oder
wegnehmen konnte man nichts. In einem Haushalt, der seine drei immer
gleichen Abläufe kennt, wird die Liste damit länger, nicht nützlicher.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import vorlagen
from homepilot.core.hub import Hub

from .conftest import make_config

ENTWURF = {"alias": "Licht im Reduit", "triggers": [{"kind": "state"}], "steps": []}


def test_eine_neue_vorlage_bekommt_eine_kennung():
    liste, kennung = vorlagen.speichern([], ENTWURF, by="Stefan", now=1.0)
    assert kennung.startswith("vorlage_")
    assert liste[0]["label"] == "Licht im Reduit"
    assert liste[0]["by"] == "Stefan"
    assert vorlagen.eigene(liste) == liste


def test_dieselbe_kennung_ersetzt_statt_zu_verdoppeln():
    liste, kennung = vorlagen.speichern([], ENTWURF)
    liste, _ = vorlagen.speichern(liste, {**ENTWURF, "alias": "Neuer Name"}, kennung)
    assert len(liste) == 1
    assert liste[0]["label"] == "Neuer Name"


def test_die_kennung_der_vorlage_landet_nicht_im_entwurf():
    # Sonst überschriebe ein aus der Vorlage gebauter Ablauf beim Sichern
    # später seine eigene Vorlage.
    liste, _ = vorlagen.speichern([], {**ENTWURF, "templateId": "vorlage_1"})
    assert "templateId" not in liste[0]["draft"]


def test_ohne_namen_bleibt_die_vorlage_auffindbar():
    liste, _ = vorlagen.speichern([], {"alias": "   "})
    assert liste[0]["label"] == "Ohne Namen"


def test_loeschen_nimmt_nur_die_eine():
    liste, eins = vorlagen.speichern([], ENTWURF)
    liste, _ = vorlagen.speichern(liste, {**ENTWURF, "alias": "Zweite"})
    uebrig = vorlagen.entfernen(liste, eins)
    assert [eintrag["label"] for eintrag in uebrig] == ["Zweite"]


def test_eingebaute_werden_ausgeblendet_und_wieder_gezeigt():
    # Die eingebauten stehen im Code der App - löschen geht nicht,
    # ausblenden schon. Gemerkt wird die Beschriftung.
    liste = vorlagen.ausblenden([], "Licht bei Bewegung, mit Nachlauf")
    assert vorlagen.versteckte(liste) == ["Licht bei Bewegung, mit Nachlauf"]
    # Und sie zählen nicht als eigene Vorlagen.
    assert vorlagen.eigene(liste) == []
    zurueck = vorlagen.ausblenden(liste, "Licht bei Bewegung, mit Nachlauf", False)
    assert vorlagen.versteckte(zurueck) == []


def test_zweimal_ausblenden_bleibt_ein_eintrag():
    liste = vorlagen.ausblenden(vorlagen.ausblenden([], "Storen zu"), "Storen zu")
    assert len(liste) == 1


def test_eine_kaputte_zeile_reisst_die_liste_nicht_mit():
    assert vorlagen.read(["Unsinn", {}, {"id": "vorlage_1"}]) == [
        {
            "id": "vorlage_1",
            "label": "",
            "icon": "flash-outline",
            "draft": {},
            "hidden": False,
            "by": "",
            "at": None,
        }
    ]


# ── Über die Schnittstelle ───────────────────────────────────────────────


def test_der_ganze_weg_ueber_die_api():
    with TestClient(create_app(Hub(make_config(token="t-owner")))) as client:
        kopf = {"Authorization": "Bearer t-owner"}
        assert client.get("/api/automations/templates", headers=kopf).json() == {
            "templates": [],
            "hidden": [],
        }

        angelegt = client.post(
            "/api/automations/templates",
            json={"draft": ENTWURF, "icon": "bulb-outline"},
            headers=kopf,
        ).json()
        kennung = angelegt["id"]
        assert angelegt["templates"][0]["label"] == "Licht im Reduit"
        assert angelegt["templates"][0]["icon"] == "bulb-outline"

        geaendert = client.post(
            "/api/automations/templates",
            json={"id": kennung, "draft": {**ENTWURF, "alias": "Reduit"}},
            headers=kopf,
        ).json()
        assert len(geaendert["templates"]) == 1
        assert geaendert["templates"][0]["label"] == "Reduit"

        versteckt = client.post(
            "/api/automations/templates/hidden",
            json={"label": "Morgens saugen"},
            headers=kopf,
        ).json()
        assert versteckt["hidden"] == ["Morgens saugen"]

        gelöscht = client.delete(
            f"/api/automations/templates/{kennung}", headers=kopf
        ).json()
        assert gelöscht["templates"] == []
        # Die ausgeblendete eingebaute bleibt ausgeblendet.
        assert gelöscht["hidden"] == ["Morgens saugen"]


def test_ein_bewohner_darf_keine_vorlagen_aendern():
    hub = Hub(
        make_config(
            users=[
                {"name": "Stefan", "role": "besitzer", "token": "t-owner"},
                {"name": "Livia", "role": "bewohner", "token": "t-livia"},
            ]
        )
    )
    with TestClient(create_app(hub)) as client:
        antwort = client.post(
            "/api/automations/templates",
            json={"draft": ENTWURF},
            headers={"Authorization": "Bearer t-livia"},
        )
        assert antwort.status_code == 403
