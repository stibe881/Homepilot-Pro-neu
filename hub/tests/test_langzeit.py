"""Der Monats- und Jahresrückblick (Punkt 253 der Werkbank).

Die Reihen sind künstlich - geprüft wird die Rechnung, nicht die Quelle:
wärmster Raum aus Rohzeilen, fairer Stromvergleich, ehrliches «fehlt»
ohne Supabase.
"""

import asyncio
from datetime import date

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import langzeit
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub

OWNER = {"name": "Stefan", "role": "besitzer", "token": "t-owner"}
GUEST = {"name": "Gast", "role": "gast", "token": "t-guest"}


# ── Temperatur ─────────────────────────────────────────────────────────────


def test_waermster_und_kaeltester_raum_aus_rohen_reihen():
    raum_von = {"s.bad": "Bad", "s.keller": "Keller", "s.flur": "Flur"}
    reihen = [
        {"entity_id": "s.bad", "state": {"temperature": 23.0}},
        {"entity_id": "s.bad", "state": {"temperature": 25.0}},
        {"entity_id": "s.keller", "state": {"temperature": 14.0}},
        {"entity_id": "s.flur", "state": {"temperature": 20.0}},
        # Ohne Zahl oder ohne bekannten Raum zählt eine Zeile nicht mit.
        {"entity_id": "s.bad", "state": {"temperature": "kaputt"}},
        {"entity_id": "s.unbekannt", "state": {"temperature": 99.0}},
    ]
    ergebnis = langzeit.temperatur_extreme(reihen, raum_von)
    assert ergebnis["waermster"] == {"raum": "Bad", "mittel_c": 24.0, "messwerte": 2}
    assert ergebnis["kaeltester"]["raum"] == "Keller"
    assert [zeile["raum"] for zeile in ergebnis["raeume"]] == ["Bad", "Flur", "Keller"]


def test_temperatur_ohne_messwerte_ist_ehrlich_none():
    assert langzeit.temperatur_extreme([], {"s.bad": "Bad"}) is None


def test_das_mittel_zaehlt_nicht_der_ausreisser():
    # Ein einzelner Spitzenwert (Fühler an der Sonne) darf den «wärmsten
    # Raum» nicht krönen.
    raum_von = {"s.balkon": "Balkon", "s.bad": "Bad"}
    reihen = [
        {"entity_id": "s.balkon", "state": {"temperature": 40.0}},
        {"entity_id": "s.balkon", "state": {"temperature": 10.0}},
        {"entity_id": "s.balkon", "state": {"temperature": 10.0}},
        {"entity_id": "s.bad", "state": {"temperature": 23.0}},
    ]
    assert langzeit.temperatur_extreme(reihen, raum_von)["waermster"]["raum"] == "Bad"


# ── Strom ──────────────────────────────────────────────────────────────────


def tage(*paare):
    return [{"day": day, "kwh": kwh} for day, kwh in paare]


def test_stromtrend_monat_vergleicht_gleiche_zeitraeume():
    days = tage(
        # Vorjahresmonat: 30 kWh.
        ("2025-09-05", 30.0),
        # Vormonat: bis zum 6. je 10, danach noch ein dicker Rest.
        ("2026-08-03", 10.0),
        ("2026-08-05", 10.0),
        ("2026-08-25", 80.0),
        # Laufender Monat.
        ("2026-09-02", 12.0),
        ("2026-09-05", 12.0),
    )
    trend = langzeit.stromtrend_monat(days, "2026-09-06")
    assert trend["monat"] == "2026-09"
    assert trend["aktuell_kwh"] == 24.0
    # Fairer Vergleich: der Vormonat bis zum selben Tag, nicht der ganze.
    assert trend["vormonat_kwh"] == 20.0
    assert trend["vormonat_gesamt_kwh"] == 100.0
    assert trend["trend_vormonat_prozent"] == 20.0
    assert trend["vorjahresmonat_kwh"] == 30.0
    assert trend["trend_vorjahr_prozent"] == -20.0


def test_stromtrend_monat_ohne_vorjahr_behauptet_nichts():
    days = tage(("2026-09-02", 12.0))
    trend = langzeit.stromtrend_monat(days, "2026-09-06")
    # 0 aus year_ago heisst «wissen wir nicht», nicht «100 % gespart».
    assert trend["vorjahresmonat_kwh"] is None
    assert trend["trend_vorjahr_prozent"] is None
    assert langzeit.stromtrend_monat([], "2026-09-06") is None


def test_stromtrend_jahr_zaehlt_bis_zum_gleichen_stichtag():
    days = tage(
        ("2025-03-01", 10.0),
        ("2025-09-01", 10.0),
        # Nach dem Stichtag im Vorjahr - zählt nicht in den Vergleich.
        ("2025-11-01", 50.0),
        ("2026-02-01", 15.0),
        ("2026-09-01", 15.0),
    )
    trend = langzeit.stromtrend_jahr(days, "2026-09-06")
    assert trend["jahr"] == "2026"
    assert trend["aktuell_kwh"] == 30.0
    assert trend["vorjahr_kwh"] == 20.0
    assert trend["trend_vorjahr_prozent"] == 50.0
    assert trend["vorjahr_tage"] == 2


# ── Licht ──────────────────────────────────────────────────────────────────


def test_hitparade_zaehlt_nur_einschalten_von_lampen_im_fenster():
    events = [
        {"entity_id": "hue.kueche", "state": "on", "at": 1000.0},
        {"entity_id": "hue.kueche", "state": "off", "at": 1001.0},
        {"entity_id": "hue.kueche", "state": "on", "at": 1002.0},
        {"entity_id": "hue.flur", "state": "on", "at": 1003.0},
        # Vor dem Zeitraum: zählt nicht.
        {"entity_id": "hue.flur", "state": "on", "at": 10.0},
        # Kein Licht: zählt nicht, egal wie oft es schaltet.
        {"entity_id": "hm.steckdose", "state": "on", "at": 1004.0},
    ]
    lampen = {"hue.kueche", "hue.flur"}
    top = langzeit.schalt_hitparade(events, seit=500.0, lampen=lampen)
    assert top[0] == {"entity_id": "hue.kueche", "count": 2}
    assert top[1] == {"entity_id": "hue.flur", "count": 1}


# ── Zusammensetzen ohne Supabase ───────────────────────────────────────────


def make_hub(tmp_path) -> Hub:
    return Hub(
        HubConfig(
            api=ApiConfig(),
            integrations=[{"integration": "demo"}],
            users=[OWNER, GUEST],
            data_file=str(tmp_path / "daten.json"),
        )
    )


def test_ohne_supabase_kommt_der_rest_trotzdem(tmp_path):
    async def run():
        hub = make_hub(tmp_path)
        await hub.start()
        heute = date.today()
        hub.data.set(
            "energy_days",
            tage((f"{heute.year}-{heute.month:02d}-01", 5.0)),
        )
        antwort = await langzeit.erstellen(hub, "monat", heute=heute)
        await hub.stop()
        return antwort

    antwort = asyncio.run(run())
    # Der Stromteil ist rein lokal und steht da.
    assert antwort["strom"]["aktuell_kwh"] == 5.0
    # Der Temperatur-Teil fehlt - und die Antwort sagt ehrlich, warum.
    assert antwort["temperatur"] is None
    assert any("Supabase" in grund for grund in antwort["fehlt"])
    assert antwort["zeitraum"] == "monat"


def test_verfallene_gutscheine_stehen_im_rueckblick(tmp_path):
    """Punkt 372 der Werkbank: die Zahl, die den Rückblick unbequem macht."""

    async def run():
        hub = make_hub(tmp_path)
        await hub.start()
        heute = date(2030, 6, 15)
        hub.data.set(
            "family_vouchers",
            [
                {"shop": "Brack.ch", "unit": "chf", "left": 40, "expires": "2030-06-10"},
                {"shop": "Zalando", "unit": "chf", "left": 0, "expires": "2030-06-10"},
            ],
        )
        antwort = await langzeit.erstellen(hub, "monat", heute=heute)
        await hub.stop()
        return antwort

    antwort = asyncio.run(run())
    # Punkt 454: Verfallenes steht jetzt neben dem Eingelösten - hier gab
    # es nichts einzulösen, also nur die unbequeme Hälfte.
    assert antwort["gutscheine"]["verfallen"] == {"CHF": 40}
    assert antwort["gutscheine"]["verfallen_anzahl"] == 1
    assert antwort["gutscheine"]["eingeloest"] == {}


def test_eingeloeste_gutscheine_stehen_neben_den_verfallenen(tmp_path):
    """Punkt 454: die Zahl, die das Modul rechtfertigt."""

    async def run():
        hub = make_hub(tmp_path)
        await hub.start()
        hub.data.set(
            "family_vouchers",
            [
                {
                    "shop": "Coop",
                    "unit": "chf",
                    "total": 100,
                    "left": 40,
                    "transactions": [
                        {"at": "2030-06-05T10:00:00", "amount": 60, "art": "abzug"}
                    ],
                }
            ],
        )
        antwort = await langzeit.erstellen(hub, "monat", heute=date(2030, 6, 15))
        await hub.stop()
        return antwort

    antwort = asyncio.run(run())
    assert antwort["gutscheine"]["eingeloest"] == {"CHF": 60}
    assert antwort["gutscheine"]["verfallen"] == {}


def test_ohne_verfallene_gutscheine_steht_dort_nichts(tmp_path):
    async def run():
        hub = make_hub(tmp_path)
        await hub.start()
        antwort = await langzeit.erstellen(hub, "monat", heute=date.today())
        await hub.stop()
        return antwort

    assert asyncio.run(run())["gutscheine"] is None


def test_route_liefert_den_rueckblick_und_prueft_den_zeitraum(tmp_path):
    with TestClient(create_app(make_hub(tmp_path))) as client:
        auth = {"Authorization": "Bearer t-owner"}
        antwort = client.get("/api/rueckblick/langzeit?zeitraum=monat", headers=auth)
        assert antwort.status_code == 200
        body = antwort.json()
        assert body["zeitraum"] == "monat"
        assert "fehlt" in body
        assert (
            client.get("/api/rueckblick/langzeit?zeitraum=quartal", headers=auth).status_code
            == 400
        )
        # Gäste dürfen nichts über das Haus erfahren - wie beim Verlauf.
        assert (
            client.get(
                "/api/rueckblick/langzeit",
                headers={"Authorization": "Bearer t-guest"},
            ).status_code
            == 403
        )
