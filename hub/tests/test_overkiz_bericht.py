"""Der rohe Gateway-Bericht, der zwischen «alt» und «falsch» entscheidet.

Der Fall aus dem Haus, zum zweiten Mal: «Dies stimmt nicht, es sind alle
6 Storen offen» - während der Hub bei fünf von ihnen ``Pos 0`` und
``angenommen nein`` zeigte. «Angenommen nein» heisst nur, dass irgendwann
eine Zahl vom Gateway kam; wie alt sie ist und aus welchem Zustandsnamen
sie gerechnet wurde, stand nirgends. Genau das steht jetzt im Bericht,
und zwar zweimal: vor und nach dem Nachlesen.
"""

from homepilot.integrations.overkiz import (
    geraete_zeilen,
    nachlese_unterschiede,
    protokoll,
    roh_zustaende,
)


class FakeState:
    def __init__(self, name, value):
        self.name = name
        self.value = value


class FakeDefinition:
    def __init__(self, *commands):
        self.commands = [type("C", (), {"command_name": c})() for c in commands]


class FakeDevice:
    def __init__(self, label, url, widget="RollerShutter", states=None,
                 available=True, commands=()):
        self.label = label
        self.device_url = url
        self.widget = widget
        self.ui_class = widget
        self.states = [FakeState(n, v) for n, v in (states or {}).items()]
        self.available = available
        self.definition = FakeDefinition(*commands) if commands else None


def test_rts_ist_am_schema_der_geraete_url_erkennbar():
    """Der Unterschied, der die halbe Diagnose ist: RTS meldet nie zurück."""
    assert protokoll("rts://1234-5678-9012/16744000") == "RTS"
    assert protokoll("io://1234-5678-9012/10912345") == "IO"


def test_eine_url_ohne_schema_wird_nicht_geraten():
    assert protokoll("") == "?"
    assert protokoll(None) == "?"
    assert protokoll("1234-5678") == "?"


def test_zustaende_kommen_als_name_zu_wert_heraus():
    device = FakeDevice("Küche", "io://a/1", states={"core:ClosureState": 100})
    assert roh_zustaende(device) == {"core:ClosureState": 100}


def test_ein_geraet_ohne_zustaende_ergibt_nichts():
    assert roh_zustaende(FakeDevice("Küche", "io://a/1")) == {}


def test_der_bericht_nennt_art_funkstandard_und_erreichbarkeit():
    zeilen = geraete_zeilen(
        [FakeDevice("Esszimmer", "rts://a/2", widget="ExteriorVenetianBlind",
                    available=False)]
    )
    kopf = next(z for z in zeilen if "Esszimmer" in z)
    assert "ExteriorVenetianBlind" in kopf
    assert "RTS" in kopf
    assert "meldet sich nicht" in kopf


def test_der_bericht_zeigt_den_zustandsnamen_und_was_daraus_wird():
    """Das fehlte beim ersten Anlauf: Aus «Pos 0» allein ist nicht zu
    sehen, ob ein ClosureState von 100 oder ein DeploymentState von 0
    dahintersteht - und die beiden haben verschiedene Fehler."""
    zeilen = geraete_zeilen(
        [FakeDevice("Küche", "io://a/1", states={"core:ClosureState": 100})]
    )
    text = "\n".join(zeilen)
    assert "core:ClosureState = 100" in text
    assert "'position': 0" in text


def test_die_drei_zustaende_um_die_es_geht_sind_markiert():
    zeilen = geraete_zeilen(
        [FakeDevice("Küche", "io://a/1", states={
            "core:ClosureState": 0, "core:RSSILevelState": 70,
        })]
    )
    assert any(z.strip().startswith("→ core:ClosureState") for z in zeilen)
    assert any(z.strip().startswith("core:RSSILevelState") for z in zeilen)


def test_kommandos_stehen_dabei_wenn_es_welche_gibt():
    zeilen = geraete_zeilen(
        [FakeDevice("Küche", "io://a/1", commands=("open", "close", "setClosure"))]
    )
    assert any("Kommandos: close, open, setClosure" in z for z in zeilen)


def test_ein_wert_der_sich_beim_nachlesen_aendert_war_bloss_alt():
    vorher = [FakeDevice("Küche", "io://a/1", states={"core:ClosureState": 100})]
    nachher = [FakeDevice("Küche", "io://a/1", states={"core:ClosureState": 0})]
    zeilen = nachlese_unterschiede(vorher, nachher)
    assert len(zeilen) == 1
    assert "Küche" in zeilen[0]
    assert "core:ClosureState" in zeilen[0]
    assert "100" in zeilen[0] and "0" in zeilen[0]


def test_aendert_sich_nichts_bleibt_der_vergleich_leer():
    """Und das ist die Aussage, auf die es ankommt: Dann meint das Gateway
    es wirklich so, und der Fehler sitzt nicht im Zwischenspeicher."""
    zustand = {"core:ClosureState": 100}
    vorher = [FakeDevice("Küche", "io://a/1", states=zustand)]
    nachher = [FakeDevice("Küche", "io://a/1", states=dict(zustand))]
    assert nachlese_unterschiede(vorher, nachher) == []


def test_ein_neu_aufgetauchter_zustand_zaehlt_als_unterschied():
    vorher = [FakeDevice("Küche", "io://a/1", states={})]
    nachher = [FakeDevice("Küche", "io://a/1", states={"core:ClosureState": 0})]
    assert len(nachlese_unterschiede(vorher, nachher)) == 1


def test_ein_geraet_das_vorher_fehlte_wird_nicht_uebersehen():
    nachher = [FakeDevice("Neu", "io://a/9", states={"core:ClosureState": 50})]
    zeilen = nachlese_unterschiede([], nachher)
    assert len(zeilen) == 1
    assert "Neu" in zeilen[0]
