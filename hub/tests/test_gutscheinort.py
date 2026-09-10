"""Der Gutschein, der im Laden liegt, während man davorsteht.

Die Verfalls-Erinnerung hilft gegen den vergessenen Gutschein. Sie
hilft nicht gegen den Fehler, der öfter vorkommt: Man steht bei Ochsner
Sport, kauft Turnschuhe, und der Gutschein liegt zuhause in der App.
"""

from __future__ import annotations

from homepilot.core import gutscheinort as go

JETZT = 1_800_000_000.0


def gutschein(**felder):
    return {"title": "Gutschein", "shop": "Ochsner Sport", **felder}


def test_derselbe_laden_mit_filiale() -> None:
    """«Ochsner Sport Sursee» und «Ochsner Sport» sind derselbe Laden -
    und wer eine Kette meint, meint sie überall."""
    assert go.passt("Ochsner Sport", "Ochsner Sport Sursee")
    assert go.passt("Ochsner Sport Sursee", "Ochsner Sport")


def test_gross_und_kleinschreibung_zaehlt_nicht() -> None:
    assert go.passt("MIGROS", "migros")


def test_rechtsform_und_beiwerk_zaehlen_nicht() -> None:
    assert go.passt("Meier AG", "Meier")
    assert go.passt("Coop (Filiale)", "Coop")


def test_zwei_laeden_bleiben_zwei_laeden() -> None:
    """Wer zu viel wegwirft, führt «Coop» und «Coop Bau+Hobby»
    zusammen - und das sind zwei Läden mit verschiedenen Gutscheinen."""
    assert not go.passt("Coop", "Migros")


def test_ohne_namen_passt_nichts() -> None:
    """Sonst hinge an einem Gutschein ohne Laden jede Erinnerung im
    Haus."""
    assert not go.passt("", "Migros")
    assert not go.passt("Migros", None)


def test_eingeloeste_bleiben_draussen() -> None:
    """Eine Erinnerung an einen eingelösten Gutschein ist ein Weg zur
    Kasse und wieder zurück."""
    liste = [gutschein(), gutschein(redeemed=True), gutschein(balance=0)]
    assert len(go.offene(liste, JETZT)) == 1


def test_nur_was_hier_gilt() -> None:
    liste = [gutschein(), gutschein(shop="Migros")]
    treffer = go.hier_gueltig(liste, "Ochsner Sport Sursee", JETZT)
    assert len(treffer) == 1
    assert treffer[0]["shop"] == "Ochsner Sport"


def test_der_betrag_steht_dabei() -> None:
    """«Du hast hier 50 Franken liegen» ist eine andere Nachricht als
    «du hast hier einen Gutschein»."""
    titel, text = go.satz([gutschein(balance=50)], "Ochsner Sport")
    assert titel == "Du hast hier einen Gutschein"
    assert "50 CHF" in text


def test_mehrere_werden_gezaehlt() -> None:
    titel, text = go.satz([gutschein() for _ in range(5)], "Migros")
    assert "5 Gutscheine" in titel
    assert "und 2 weitere" in text


def test_die_karte_wird_erwaehnt() -> None:
    """Im Laden zu stehen und die Nummer vorzulesen, während die Karte
    zuhause liegt, ist genau die Fahrt, die man sich sparen wollte
    (Punkt 267)."""
    _, text = go.satz([gutschein(physical=True)], "Ochsner Sport")
    assert "Karte" in text


def test_ohne_karte_kein_hinweis_darauf() -> None:
    _, text = go.satz([gutschein()], "Ochsner Sport")
    assert "Karte" not in text
