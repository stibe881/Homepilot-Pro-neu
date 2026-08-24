"""Die Gegensprechanlage hat kein Netz unter dem Ereigniskanal.

Der Fall aus dem Haus: eine Ring-Gegensprechanlage, keine Kamera-Klingel.
Die Hausklingel selbst läuft ohne Ring, die Ring-Anlage hängt dazwischen.

Was dabei herauskam: ``dings/active`` – die Liste, aus der die
Ersatz-Abfrage ihre Meldungen zieht – ist der Endpunkt der Türklingeln
und Kameras. Die Gegensprechanlage hängt an einer eigenen Adressfamilie
(``/commands/v1/devices/…``) und steht dort nicht drin. Der
System-Bildschirm versprach trotzdem «Klingeln wird ersatzweise alle 10 s
abgefragt» – für eine Türklingel wahr, für dieses Gerät nicht.

Diese Tests halten den Unterschied fest, damit ihn niemand wegräumt.
"""

from __future__ import annotations

from homepilot.integrations.ring import (
    DING_POLL_SECONDS,
    ersatz_hinweis,
    health_detail,
)


def test_ohne_betroffene_geraete_kein_zusatz() -> None:
    """Wer nur Türklingeln hat, soll den Satz nie zu sehen bekommen."""
    assert ersatz_hinweis([]) == ""


def test_die_gegensprechanlage_wird_benannt() -> None:
    hinweis = ersatz_hinweis(["Gegensprechanlage"])
    assert "Gegensprechanlage" in hinweis
    # Der entscheidende Teil: nicht «später», sondern «gar nicht».
    assert "gar nicht" in hinweis


def test_mehrere_geraete_in_einem_satz() -> None:
    hinweis = ersatz_hinweis(["Hintertür", "Haustür"])
    # Alphabetisch, damit die Reihenfolge nicht bei jedem Neustart wechselt.
    assert hinweis.index("Haustür") < hinweis.index("Hintertür")
    assert "sind" in hinweis


def test_bei_totem_kanal_steht_die_einschraenkung_dabei() -> None:
    """Genau der Bildschirm, auf den man schaut, wenn nichts ankommt."""
    text = health_detail(
        False,
        "mtalk.google.com:5228 ist gesperrt",
        anlaeufe=3,
        ohne_ersatz=["Gegensprechanlage"],
    )
    assert f"alle {DING_POLL_SECONDS} s" in text
    assert "Gegensprechanlage" in text


def test_auch_bei_abgeschaltetem_kanal() -> None:
    """`events: false` macht die Abfrage zum Hauptweg – und der trägt
    dieses Gerät nicht. Wer das einstellt, muss es erfahren."""
    text = health_detail(False, None, abgeschaltet=True, ohne_ersatz=["Türöffner"])
    assert "Türöffner" in text


def test_ohne_gegensprechanlage_bleibt_der_text_wie_er_war() -> None:
    """Kein neuer Lärm für Häuser, die das Problem nicht haben."""
    text = health_detail(False, None, anlaeufe=3)
    assert "Achtung" not in text


def test_ein_stehender_kanal_braucht_keinen_hinweis() -> None:
    """Solange er steht, ist der fehlende Ersatzweg belanglos."""
    text = health_detail(True, None, ohne_ersatz=["Gegensprechanlage"])
    assert "Gegensprechanlage" not in text
    assert "sofort" in text
