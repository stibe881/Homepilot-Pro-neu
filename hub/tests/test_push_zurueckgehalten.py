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
