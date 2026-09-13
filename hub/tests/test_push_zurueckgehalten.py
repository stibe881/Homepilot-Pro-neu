"""Was der Hub zurückhält, steht trotzdem auf dem Zettel.

Der Fehler, den man hier bauen kann, ist ein stilles Loch: Die
Ruhezeit sortiert die Empfänger aus, ``send`` findet keine Tokens und
kehrt um - und die Meldung ist nirgends. Nicht auf dem Telefon, nicht
im Nachlesen, nirgends. Von aussen sieht das aus wie eine Meldung, die
es nie gab.

Deshalb steht die Kette hier als Ganzes: Empfänger aussortieren,
Meldung vermerken, Grund mitschreiben, beim Nachlesen als «verpasst»
wiederfinden.
"""

from __future__ import annotations

import asyncio
from typing import Any

from homepilot.core import pushruhe, pushverlauf
from homepilot.core.push import PushService
from homepilot.core.users import Role


class Benutzer:
    def __init__(self, name: str, role: str = Role.RESIDENT) -> None:
        self.name = name
        self.role = role


def dienst(*namen: str) -> tuple[PushService, list[dict[str, Any]]]:
    service = PushService()
    for name in namen:
        service.register(f"ExponentPushToken[{name}]", name)
    zettel: list[dict[str, Any]] = []
    service.on_sent = zettel.append
    return service, zettel


def test_in_der_ruhezeit_bekommt_niemand_die_batteriewarnung() -> None:
    service, _ = dienst("Stefan")
    service.ruhe = {"Stefan": {"enabled": True, "from": 0, "to": 24}}
    tokens = service.recipients([Benutzer("Stefan")], "all", "battery")
    assert tokens == []


def test_der_wasseralarm_kommt_auch_in_der_ruhezeit() -> None:
    """Die Zusage, wegen der es die Liste IMMER_DURCH gibt."""
    service, _ = dienst("Stefan")
    service.ruhe = {"Stefan": {"enabled": True, "from": 0, "to": 24}}
    assert service.recipients([Benutzer("Stefan")], "all", "leak")


def test_eine_zurueckgehaltene_meldung_steht_auf_dem_zettel() -> None:
    service, zettel = dienst("Stefan")
    service.ruhe = {"Stefan": {"enabled": True, "from": 0, "to": 24}}
    tokens = service.recipients([Benutzer("Stefan")], "all", "battery")

    ergebnis = asyncio.run(
        service.send(tokens, title="Batterie schwach", body="Flur", category="battery")
    )

    assert ergebnis.zurueckgehalten == pushruhe.GRUND_RUHE
    assert len(zettel) == 1
    assert zettel[0]["held"] == pushruhe.GRUND_RUHE
    assert zettel[0]["held_for"] == ["Stefan"]


def test_beim_nachlesen_ist_sie_als_verpasst_gekennzeichnet() -> None:
    """Der Unterschied zwischen «ich habe es übersehen» und «das Haus
    hat mich schlafen lassen»."""
    service, zettel = dienst("Stefan")
    service.ruhe = {"Stefan": {"enabled": True, "from": 0, "to": 24}}
    tokens = service.recipients([Benutzer("Stefan")], "all", "battery")
    asyncio.run(service.send(tokens, title="Batterie schwach", body="Flur", category="battery"))

    rows: list[dict[str, Any]] = []
    for eintrag in zettel:
        rows = pushverlauf.anhaengen(rows, eintrag, 1_000_000.0)

    verpasst = pushverlauf.verpasst(rows, "Stefan")
    assert [zeile["title"] for zeile in verpasst] == ["Batterie schwach"]
    # Und für jemand anderen ist es keine verpasste Meldung.
    assert pushverlauf.verpasst(rows, "Bine") == []


def test_der_tagesdeckel_haelt_zurueck_und_vermerkt_es() -> None:
    service, zettel = dienst("Stefan")
    service.bremse = lambda category: pushruhe.GRUND_DECKEL

    ergebnis = asyncio.run(
        service.send(
            service.recipients([Benutzer("Stefan")], "all", "battery"),
            title="Batterie schwach",
            body="Flur",
            category="battery",
        )
    )

    assert ergebnis.zurueckgehalten == pushruhe.GRUND_DECKEL
    assert zettel[0]["held"] == pushruhe.GRUND_DECKEL


def test_ohne_angemeldetes_geraet_kommt_kein_zettel() -> None:
    """Ein Zettel, den niemand lesen kann, hilft niemandem."""
    service, zettel = dienst()
    asyncio.run(service.send([], title="Batterie schwach", body="Flur", category="battery"))
    assert zettel == []


# ── Je Gerät, nicht je Person (Fehler aus der Runde 579) ──────────────────
#
# ``recipients`` rechnet seit Punkt 471 je Gerät; der Zettel rechnete
# noch je Person. Zwei Löcher: Die Ruhezeit nur auf dem Telefon fand
# keinen Grund und die Meldung stand nirgends - und ein abbestelltes
# iPad neben einer Ruhezeit der Person vermerkte «verpasst», obwohl das
# Telefon gebrummt hatte.


def test_die_ruhezeit_allein_auf_dem_telefon_steht_auf_dem_zettel() -> None:
    service, zettel = dienst("Stefan")
    service.geraete_ruhe = {"ExponentPushToken[Stefan]": {"enabled": True, "from": 0, "to": 24}}
    tokens = service.recipients([Benutzer("Stefan")], "all", "battery")
    assert tokens == []

    ergebnis = asyncio.run(
        service.send(tokens, title="Batterie schwach", body="Flur", category="battery")
    )

    assert ergebnis.zurueckgehalten == pushruhe.GRUND_RUHE
    assert zettel[0]["held_for"] == ["Stefan"]


def test_wer_auf_dem_telefon_gebrummt_hat_gilt_nicht_als_verpasst() -> None:
    """Das iPad hat die Batterie abbestellt, die Person schläft nachts -
    aber das Telefon hat eine eigene, ausgeschaltete Ruhezeit und bekommt
    die Meldung. Dann hat Stefan nichts verpasst."""
    service, zettel = dienst("Stefan")
    service.register("ExponentPushToken[Stefan-iPad]", "Stefan", "iPad")
    service.ruhe = {"Stefan": {"enabled": True, "from": 0, "to": 24}}
    service.geraete_ruhe = {"ExponentPushToken[Stefan]": {"enabled": False}}
    service.geraete_muted = {"ExponentPushToken[Stefan-iPad]": {"battery"}}
    tokens = service.recipients([Benutzer("Stefan")], "all", "battery")
    assert tokens == ["ExponentPushToken[Stefan]"]

    asyncio.run(
        service.send(tokens, title="Batterie schwach", body="Flur", category="battery")
    )

    assert zettel[0]["held"] is None
    assert zettel[0]["held_for"] == []


def test_das_zweite_geraet_in_der_ruhezeit_macht_die_person_nicht_zur_verpasserin() -> None:
    """Ohne eigene Abbestellung fällt das iPad auf die Ruhezeit der Person
    zurück - trotzdem hat Stefan die Meldung auf dem Telefon."""
    service, zettel = dienst("Stefan")
    service.register("ExponentPushToken[Stefan-iPad]", "Stefan", "iPad")
    service.ruhe = {"Stefan": {"enabled": True, "from": 0, "to": 24}}
    service.geraete_ruhe = {"ExponentPushToken[Stefan]": {"enabled": False}}
    tokens = service.recipients([Benutzer("Stefan")], "all", "battery")

    asyncio.run(
        service.send(tokens, title="Batterie schwach", body="Flur", category="battery")
    )

    assert zettel[0]["held_for"] == []
