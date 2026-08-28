"""Der UV-Hinweis am Morgen - nur an Tagen, an denen er etwas sagt."""

from homepilot.core import uvwarnung
from homepilot.core.morgen import zeilen


def test_die_stufen_sind_die_der_who():
    assert uvwarnung.wort(2) is None
    assert uvwarnung.wort(4) == "mässig"
    assert uvwarnung.wort(6) == "hoch"
    assert uvwarnung.wort(9) == "sehr hoch"
    assert uvwarnung.wort(11) == "extrem"
    assert uvwarnung.wort("wolkig") is None


def test_der_hinweis_kommt_erst_ab_hoch():
    """«UV 2, alles gut» wäre eine Meldung, die man abbestellt."""
    assert uvwarnung.hinweis(4) is None
    assert uvwarnung.hinweis(None) is None
    satz = uvwarnung.hinweis(7.4)
    assert satz is not None
    assert "hoch" in satz and "7" in satz and "eincremen" in satz


def test_die_morgenzeile_steht_zuletzt():
    """Das offene Fenster ist der Handgriff vor der Haustüre - die
    Sonnencreme kommt danach."""
    liste = zeilen(
        offen=["Küchenfenster"],
        schwach=[],
        stumm=[],
        nacht=0,
        stille_ablaeufe=[],
        uv="UV heute hoch (7) - eincremen, Mittagssonne meiden",
    )
    assert liste[0].startswith("Noch offen")
    assert liste[-1].startswith("UV heute")
