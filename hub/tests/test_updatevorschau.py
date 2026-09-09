"""Von welchem Stand aus «was bringt das Update?» gerechnet wird.

Der Fall aus dem Haus, dreimal dieselbe Frage an einem Morgen: «Ich habe
das Update gemacht, trotzdem steht noch das Alte.» Sie war nicht zu
beantworten - der Dialog listete immer «die jüngsten Änderungen (der
laufende Stand liess sich nicht genau vergleichen)», und diese Liste
sieht gleich aus, ob die Änderungen schon laufen oder nicht.

Der Grund: Der laufende Stand entsteht beim Bauen aus dem Zweig plus
allen anderen Zweigen des Repos (HOMEPILOT_MERGE_ALL). Diesen Commit
kennt GitHub nicht, also kann GitHub auch nicht sagen, was seither dazu
kam.
"""

from homepilot.api.routes.system import vergleichsstand


def test_der_stand_von_github_zaehlt_und_nicht_der_zusammengefuehrte():
    # Genau der Unterschied, um den es geht: «a86c69e» ist der örtliche
    # Zusammenführungs-Commit, «4e49c5a» steht auf GitHub.
    assert vergleichsstand("4e49c5a", "a86c69e") == "4e49c5a"


def test_ohne_basis_bleibt_es_beim_bisherigen_verhalten():
    """Ein Abbild von vor dieser Änderung kennt die Basis nicht. Dann
    lieber die alte, ungenaue Auskunft als gar keine."""
    assert vergleichsstand(None, "a86c69e") == "a86c69e"
    assert vergleichsstand("", "a86c69e") == "a86c69e"
    # «unbekannt» ist der Vorgabewert des Dockerfiles, kein Commit.
    assert vergleichsstand("unbekannt", "a86c69e") == "a86c69e"


def test_ganz_ohne_angaben_wird_nichts_erfunden():
    assert vergleichsstand(None, None) == "unbekannt"
    assert vergleichsstand("unbekannt", "unbekannt") == "unbekannt"
