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


# ── Der zweite Weg: über die Bauzeit ───────────────────────────────────
#
# Der Basis-Commit ist der genauere Weg, aber er hängt daran, dass sich
# rebuild-hub.sh zuerst selbst aufgefrischt hat - das kostet einen
# zusätzlichen Update-Lauf. Die Bauzeit steht dagegen in jedem Abbild.


def test_die_frage_nennt_stand_und_bauzeit():
    from homepilot.api.routes.system import vorschau_frage

    frage = vorschau_frage("a1b2c3", "2026-09-09T04:34:11Z")
    assert "ab=a1b2c3" in frage
    # Als Parameter kodiert - der Doppelpunkt gehört nicht roh in eine URL.
    assert "gebaut=2026-09-09T04%3A34%3A11Z" in frage


def test_ohne_bauzeit_bleibt_die_frage_wie_bisher():
    """Ein Abbild von vor dieser Änderung schickt nichts mit - dann darf
    auch kein leeres Feld mitgehen, das der Dienst deuten müsste."""
    from homepilot.api.routes.system import vorschau_frage

    assert vorschau_frage("a1b2c3", None) == "ab=a1b2c3"
    assert vorschau_frage("a1b2c3", "") == "ab=a1b2c3"
    # «unbekannt» ist der Vorgabewert des Dockerfiles, kein Zeitpunkt.
    assert vorschau_frage("a1b2c3", "unbekannt") == "ab=a1b2c3"
