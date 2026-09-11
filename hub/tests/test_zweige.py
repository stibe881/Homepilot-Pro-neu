"""Die reinen Teile des Zweig-Werkzeugs (deploy/zweige.py).

Warum hier und nicht neben dem Skript: Der Testlauf des Hubs ist der
einzige, der bei jedem Push läuft. Ein Werkzeug, das die Zweige gleich
hält, darf nicht selbst ungeprüft danebenliegen – gerade weil sein
Versagen aussieht wie Erfolg.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_pfad = Path(__file__).resolve().parents[2] / "deploy" / "zweige.py"
_spec = importlib.util.spec_from_file_location("zweige", _pfad)
assert _spec and _spec.loader
zweige = importlib.util.module_from_spec(_spec)
# Vor dem Ausführen eintragen: `@dataclass` schlägt sonst fehl, weil es
# sein eigenes Modul über sys.modules sucht und dort noch nichts steht.
sys.modules["zweige"] = zweige
_spec.loader.exec_module(zweige)


def stand(voraus: int = 0, hinterher: int = 0, da: bool = True, name: str = "claude/beispiel"):
    return zweige.Zweigstand(name, voraus, hinterher, da)


def test_gleichauf_heisst_nichts_zu_tun():
    assert zweige.urteil(stand()) == "gleichauf"
    assert zweige.satz(stand()).endswith("gleichauf")


def test_ein_zweig_dem_etwas_fehlt():
    # Der eigentliche Fall: Hier liegen zwei Commits, dort nicht. Auf dem
    # Auslieferzweig heisst das, dass sie im Haus nicht laufen.
    assert zweige.urteil(stand(hinterher=2)) == "hinterher"
    assert "2 Commit(s) fehlen dort" in zweige.satz(stand(hinterher=2))


def test_ein_zweig_der_etwas_mitbringt():
    assert zweige.urteil(stand(voraus=3)) == "voraus"
    assert "3 Commit(s), die hier fehlen" in zweige.satz(stand(voraus=3))


def test_auseinandergelaufen_braucht_einen_menschen():
    # Beide Seiten haben Eigenes. Welche gewinnt, entscheidet kein Skript.
    beides = stand(voraus=1, hinterher=4)
    assert zweige.urteil(beides) == "auseinander"
    assert "ansehen" in zweige.satz(beides)


def test_ein_zweig_den_es_nicht_gibt():
    assert zweige.urteil(stand(da=False)) == "fehlt"
    assert "gibt es auf dem Server nicht" in zweige.satz(stand(da=False))


def test_alles_gleich_nur_wenn_wirklich_alle():
    assert zweige.alles_gleich([stand(), stand()]) is True
    assert zweige.alles_gleich([stand(), stand(hinterher=1)]) is False
    # Auch «voraus» ist nicht gleichauf: Dort liegt Arbeit, die hier fehlt.
    assert zweige.alles_gleich([stand(voraus=1)]) is False


def test_zweigliste_aus_der_umgebung():
    assert zweige.zweige_aus_umgebung("a,b,c") == ("a", "b", "c")
    # Das abschliessende Komma ist der häufigste Tippfehler in so einer
    # Zeile - ein Zweig namens "" brächte nur eine wirre git-Meldung.
    assert zweige.zweige_aus_umgebung("a, b ,") == ("a", "b")


def test_ohne_umgebung_gilt_die_vorgabe():
    assert zweige.zweige_aus_umgebung(None) == zweige.VORGABE
    assert zweige.zweige_aus_umgebung("   ") == zweige.VORGABE
    # Der erste ist der Auslieferzweig - daran hängt, was im Haus läuft,
    # und der Bau (rebuild-hub.sh, BRANCH) nimmt main. Hier stand einmal
    # ein claude/-Zweig, und das Werkzeug mass gegen einen Zweig, den
    # der Knopf gar nicht baut.
    assert zweige.VORGABE[0] == "main"


def test_geprueft_wird_auch_ein_zweig_der_nicht_auf_der_liste_steht():
    """Der teure Fall: Auf einem ungelisteten Zweig lagen zehn Commits,
    geprüft und grün - und `pruefen` meldete ihn nicht, weil er nicht
    auf der Liste stand. Gemerkt hat es erst der Bau, mit «Nicht
    hineingenommen (Konflikt mit main)»."""
    gelistet = ("main", "claude/bekannt")
    fern = ["claude/bekannt", "claude/vergessen", "main"]
    assert zweige.zum_pruefen(gelistet, fern) == (
        "main",
        "claude/bekannt",
        "claude/vergessen",
    )


def test_der_auslieferzweig_bleibt_vorne():
    """Gegen ihn wird gemessen, und die Meldung «dort wird gebaut»
    hängt an der ersten Stelle (siehe pruefen)."""
    assert zweige.zum_pruefen(("main",), ["aaa", "zzz"])[0] == "main"


def test_ein_gelisteter_zweig_bleibt_drin_auch_ohne_den_server():
    """«Gibt es auf dem Server nicht» ist eine Auskunft - sie fällt weg,
    wenn die Liste stillschweigend durch die Serverliste ersetzt wird."""
    assert "claude/weg" in zweige.zum_pruefen(("main", "claude/weg"), ["main"])


def test_ohne_antwort_vom_server_bleibt_die_liste():
    assert zweige.zum_pruefen(("main", "a"), []) == ("main", "a")


def test_ein_ungestossener_zweig_der_hinterherhinkt_ist_kein_alarm():
    """Seit `pruefen` alle Zweige des Servers misst, hinken die
    ungelisteten naturgemäss hinterher. «Zum Angleichen: stossen» wäre
    dort falsch - stossen fasst sie gar nicht an, und wer es zweimal
    aufruft, glaubt an einen Fehler."""
    staende = [stand(name="main"), stand(name="claude/fremd", hinterher=3)]
    assert zweige.nur_hinterher(staende, ("main",)) is True


def test_arbeit_die_hier_fehlt_bleibt_ein_alarm():
    """Der Fall, wegen dem es das Skript gibt: Auf einem Zweig liegt
    etwas, das der Auslieferzweig nicht hat."""
    staende = [stand(name="main"), stand(name="claude/fremd", voraus=2)]
    assert zweige.nur_hinterher(staende, ("main",)) is False
    # Und ein *gelisteter* Zweig, der hinterherhinkt, auch: Den stösst
    # das Skript, also soll es das auch sagen.
    assert zweige.nur_hinterher([stand(name="a", hinterher=1)], ("a",)) is False
