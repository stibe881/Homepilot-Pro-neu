"""Was regelmässig ausgeht, kommt von selbst auf die Liste.

Der Anlass: Kaffee, Waschmittel und Katzenstreu fallen erst auf, wenn
die Packung leer ist. Die Standardartikel halfen nur dem, der ohnehin
auf die Liste schaute; der gelernte Rhythmus schlug bloss vor.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import vorrat
from homepilot.core.hub import Hub

from .conftest import make_config

TAG = 86400.0
JETZT = 1_800_000_000.0


def artikel(text="Kaffee", days=21, last=None):
    eintrag = {"id": "a1", "text": text, "days": days}
    if last is not None:
        eintrag["last"] = last
    return eintrag


# ── Der Takt ─────────────────────────────────────────────────────────────


def test_ohne_takt_ist_ein_standardartikel_einfach_ein_knopf():
    assert vorrat.takt({"text": "Brot"}) is None
    assert vorrat.faellig([{"text": "Brot"}], set(), JETZT) == []


def test_krumme_werte_zaehlen_als_kein_takt():
    """Ein einzelner Unsinn darf nicht die ganze Liste zu Fall bringen."""
    assert vorrat.takt({"days": "bald"}) is None
    assert vorrat.takt({"days": 0}) is None
    assert vorrat.takt({"days": 9999}) is None
    assert vorrat.takt({"days": "21"}) == 21


# ── Wann etwas dran ist ──────────────────────────────────────────────────


def test_ein_neuer_artikel_kommt_sofort_auf_die_liste():
    """Wer einen Takt einstellt, will nicht erst einen Durchgang lang
    zusehen."""
    assert vorrat.faellig([artikel()], set(), JETZT) != []


def test_nach_dem_einkauf_ist_erst_wieder_nach_dem_abstand_etwas_faellig():
    frisch = artikel(last=JETZT)
    assert vorrat.faellig([frisch], set(), JETZT + 20 * TAG) == []
    assert vorrat.faellig([frisch], set(), JETZT + 21 * TAG) != []


def test_was_schon_auf_der_liste_steht_kommt_nicht_zweimal():
    """Zwei Zeilen «Kaffee» sähen nach einem Fehler aus - und abhaken
    müsste man beide."""
    assert vorrat.faellig([artikel()], {"kaffee"}, JETZT) == []


def test_ein_artikel_ohne_namen_wird_uebergangen():
    assert vorrat.faellig([artikel(text="  ")], set(), JETZT) == []


# ── Der Takt beginnt beim Einkauf ────────────────────────────────────────


def test_abhaken_startet_den_takt_neu():
    liste, geaendert = vorrat.nachgekauft([artikel()], "Kaffee", JETZT)
    assert geaendert
    assert liste[0]["last"] == JETZT
    # Und damit ist er erst in drei Wochen wieder dran.
    assert vorrat.faellig(liste, set(), JETZT + TAG) == []


def test_gross_und_kleinschreibung_spielen_keine_rolle():
    """Wer «kaffee» von Hand einträgt und abhakt, hat genauso Kaffee
    gekauft wie der, dem der Hub ihn hingelegt hat."""
    _, geaendert = vorrat.nachgekauft([artikel()], "  kaffee ", JETZT)
    assert geaendert


def test_ein_fremder_posten_aendert_nichts():
    liste, geaendert = vorrat.nachgekauft([artikel()], "Bananen", JETZT)
    assert not geaendert
    assert "last" not in liste[0]


def test_ein_standardartikel_ohne_takt_bleibt_unberuehrt():
    """Er hat keinen Zyklus, den man neu starten könnte."""
    _, geaendert = vorrat.nachgekauft([{"text": "Brot"}], "Brot", JETZT)
    assert not geaendert


# ── Was dasteht ──────────────────────────────────────────────────────────


def test_der_satz_nennt_takt_und_naechsten_termin():
    assert vorrat.satz(artikel(last=JETZT), JETZT + 17 * TAG) == "Alle 21 Tage · in 4 Tagen"
    assert vorrat.satz(artikel(last=JETZT), JETZT + 20 * TAG) == "Alle 21 Tage · morgen"
    assert vorrat.satz(artikel(last=JETZT), JETZT + 22 * TAG) == "Alle 21 Tage · jetzt fällig"


def test_ohne_takt_gibt_es_keinen_satz():
    assert vorrat.satz({"text": "Brot"}, JETZT) is None


def test_die_meldung_zaehlt_auf_was_der_hub_getan_hat():
    """Wer die Liste aufschlägt und Posten findet, die er nicht kennt,
    glaubt eher an einen Fehler als an einen Dienst."""
    assert "Kaffee ist nach dem Vorrat dran." in vorrat.meldung(["Kaffee"])[1]
    assert "Kaffee, Waschmittel sind" in vorrat.meldung(["Kaffee", "Waschmittel"])[1]


# ── Und über die Routen ──────────────────────────────────────────────────


async def test_der_hub_traegt_den_vorrat_selbst_ein_und_zaehlt_ab_dem_einkauf():
    """Der ganze Weg: Takt setzen, der Wächter legt den Posten hin,
    abhaken startet den Takt neu."""
    hub = Hub(make_config())
    await hub.start()
    try:
        client = TestClient(create_app(hub))
        hub.data.set(
            "family_staples", [{"id": "s1", "text": "Kaffee", "days": 21}]
        )

        await hub.watchdog.check()
        liste = hub.data.get("family_shopping")
        assert [row["text"] for row in liste] == ["Kaffee"]
        # Woher der Posten kommt, muss dranstehen - sonst sucht man den
        # Mitbewohner, der ihn eingetragen hat, und findet keinen.
        assert liste[0]["author"] == "Vorrat"

        # Ein zweiter Durchgang legt nichts nach.
        await hub.watchdog.check()
        assert len(hub.data.get("family_shopping")) == 1

        # Abhaken startet den Takt.
        antwort = client.put(
            f"/api/family/shopping/{liste[0]['id']}", json={"done": True}
        )
        assert antwort.status_code == 200
        assert hub.data.get("family_staples")[0]["last"] > 0

        # Und dann bleibt es eine Weile still - auch wenn der erledigte
        # Posten von der Liste verschwindet.
        hub.data.set("family_shopping", [])
        await hub.watchdog.check()
        assert hub.data.get("family_shopping") == []
    finally:
        await hub.stop()


async def test_ein_standardartikel_ohne_takt_landet_nie_von_selbst_auf_der_liste():
    """Die Standardartikel sind zuerst eine Liste zum Antippen - wer
    keinen Takt setzt, will keinen."""
    hub = Hub(make_config())
    await hub.start()
    try:
        hub.data.set("family_staples", [{"id": "s1", "text": "Brot"}])
        await hub.watchdog.check()
        assert hub.data.get("family_shopping") == []
    finally:
        await hub.stop()
