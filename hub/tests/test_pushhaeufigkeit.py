"""Wie oft eine Meldung kommt – nicht nur, ob sie kommt.

Der Prüfstand dazu steht in `pushstand.py`; hier stehen die Zusagen, die
er absichert. Alle stammen aus einer Meldung, die im Haus zu oft kam
oder zu oft hätte kommen können.
"""

from __future__ import annotations

import time

from homepilot.core import personen

from .pushstand import Pushstand, entitaet


def telefon(prozent=None, gesehen=None):
    """Eine Anwesenheits-Entität, wie der Geofence sie schreibt."""
    zustand = {
        "state": "home",
        "device_class": "presence",
        "last_seen": gesehen if gesehen is not None else time.time(),
        "changed_at": time.time(),
    }
    if prozent is not None:
        zustand["battery"] = prozent
    return entitaet(
        "geofence.bine",
        name="Bine",
        integration="geofence",
        kind="binary_sensor",
        **zustand,
    )


async def test_ein_leerer_akku_wird_genau_einmal_gemeldet(hub):
    stand = Pushstand(hub)
    handy = telefon(prozent=9)
    stand.welt([handy])
    stand.geofence({"bine": "geofence.bine"})

    await stand.runden(5)

    assert stand.wie_oft("Telefon fast leer") == 1


async def test_ein_wert_der_kommt_und_geht_meldet_nicht_jedes_mal(hub):
    """Der Fehler von gestern, in einer Zeile.

    Life360 schickt für ein Telefon, über das es nichts weiss, den Wert
    «0» – und zwar mitten zwischen richtigen Ständen. Der Merker
    «schon gesagt» fiel bei jeder Meldung ohne brauchbaren Wert weg, und
    beim nächsten Fehlwert ging dieselbe Push wieder raus. So kam sie
    alle paar Minuten, während in der App 65 % standen.
    """
    stand = Pushstand(hub)
    handy = telefon(prozent=9)
    stand.welt([handy])
    stand.geofence({"bine": "geofence.bine"})

    def wechselspiel(runde: int) -> None:
        if runde % 2:
            handy.state["battery"] = 9
        else:
            handy.state.pop("battery", None)

    await stand.runden(8, wechselspiel)

    # Ohne Auskunft ist der Akku nicht plötzlich voll: Ein fehlender Wert
    # darf die Warnung nicht zurücksetzen.
    assert stand.wie_oft("Telefon fast leer") == 1


async def test_erst_ein_geladenes_telefon_darf_wieder_warnen(hub):
    """Die Gegenprobe: Wer lädt, soll beim nächsten Mal wieder gewarnt
    werden. Ein Merker, der nie fällt, wäre genauso falsch wie einer, der
    bei jeder Kleinigkeit fällt."""
    stand = Pushstand(hub)
    handy = telefon(prozent=9)
    stand.welt([handy])
    stand.geofence({"bine": "geofence.bine"})

    def laden_und_leeren(runde: int) -> None:
        if runde == 3:
            handy.state["battery"] = 80
        elif runde > 3:
            handy.state["battery"] = 7

    await stand.runden(6, laden_und_leeren)

    assert stand.wie_oft("Telefon fast leer") == 2


async def test_eine_null_meldet_gar_nicht(hub):
    """Null Prozent ist keine Messung, sondern eine fehlende Auskunft –
    und ein Telefon mit wirklich null Prozent meldet ohnehin keine
    Position mehr."""
    stand = Pushstand(hub)
    handy = telefon(prozent=0)
    stand.welt([handy])
    stand.geofence({"bine": "geofence.bine"})

    await stand.runden(4)

    assert stand.wie_oft("Telefon fast leer") == 0


async def test_wer_die_meldung_abgestellt_hat_bekommt_sie_auch_spaeter_nicht(hub):
    """Der Schalter je Person (Einstellungen → Familie und Freunde).

    Wichtig ist hier die *zweite* Hälfte: Der Vermerk «schon gesagt» wird
    auch dann gesetzt, wenn niemand die Meldung will. Sonst käme sie
    geballt, sobald jemand den Schalter wieder umlegt.
    """
    stand = Pushstand(hub)
    handy = telefon(prozent=9)
    stand.welt([handy])
    stand.geofence({"bine": "geofence.bine"})
    hub.data.set(personen.LADE, [{"zone": "bine", "meldungen": {"battery": False}}])

    await stand.runden(3)
    assert stand.wie_oft("Telefon fast leer") == 0

    hub.data.set(personen.LADE, [{"zone": "bine", "meldungen": {"battery": True}}])
    await stand.runden(3)
    assert stand.wie_oft("Telefon fast leer") == 0


async def test_ein_stummes_telefon_wird_auch_nur_einmal_gemeldet(hub):
    """Dieselbe Frage für die Funkstille – der Prüfstand taugt für jede
    Meldung, nicht nur für die eine, die aufgefallen ist."""
    stand = Pushstand(hub)
    # Seit Stunden nichts gehört, Akku in Ordnung: Nur die Funkstille
    # soll melden.
    handy = telefon(prozent=80, gesehen=time.time() - 24 * 3600)
    stand.welt([handy])
    stand.geofence({"bine": "geofence.bine"})

    await stand.runden(5)

    assert stand.wie_oft("Meldet sich nicht mehr") == 1
