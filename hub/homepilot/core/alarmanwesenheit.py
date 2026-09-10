"""Die Anlage an die Anwesenheit koppeln - vorsichtig.

Der häufigste Fehler an einer Alarmanlage ist nicht ein Fehlalarm,
sondern eine Anlage, die niemand scharf geschaltet hat. Man geht aus dem
Haus, denkt an die Einkaufsliste, und die Anlage steht auf unscharf -
acht Stunden lang.

Das lässt sich koppeln: Wenn alle weg sind, scharf; wenn jemand kommt,
unscharf. Beides ist verlockend und beides hat eine scharfe Kante:

- **Automatisch scharf** ist die harmlose Richtung. Schlimmstenfalls
  löst sie aus, wenn jemand zurückkommt, dessen Telefon nicht meldet -
  und dafür gibt es die Eingangsverzögerung. Trotzdem nicht sofort: Der
  Nachlauf verhindert, dass ein kurzer Aussetzer der Ortung die Anlage
  scharf schaltet, während jemand im Garten steht.
- **Automatisch unscharf** ist die gefährliche. Ein Telefon in einer
  fremden Hand hebt damit die Anlage auf. Deshalb ist die Vorgabe
  «vorschlagen»: eine Nachricht, die zur Anlage führt, kein stilles
  Entschärfen. Wer es anders will, legt den Schalter um - und weiss
  dann, was er tut.

Was hier bewusst **nicht** steht: die Prüfung, ob überhaupt scharf
geschaltet werden kann (offene Fenster, blinde Sensoren). Die macht
``alarm.arm`` selbst, und sie soll auch für die selbsttätige Schaltung
gelten - eine Anlage, die sich selbst scharf schaltet und dabei ein
offenes Fenster übergeht, wäre schlechter als gar keine Kopplung.

Reines Rechnen über Zustände; wer schaltet, ist die Integration.
"""

from __future__ import annotations

from typing import Any

from . import presence

#: Die drei Stufen, in denen sich beide Richtungen einstellen lassen.
AUS = "aus"
VORSCHLAGEN = "vorschlagen"
AUTOMATISCH = "automatisch"
STUFEN = (AUS, VORSCHLAGEN, AUTOMATISCH)

#: Wie lange nach dem Weggehen gewartet wird, bevor scharf geschaltet
#: wird.
#:
#: Der Fall dahinter: Man steht mit dem Velo vor der Garage, das Telefon
#: hat die Zone gerade verlassen, und drei Minuten später geht man noch
#: einmal hinein. Ohne Nachlauf stünde die Anlage dann scharf und die
#: Eingangsverzögerung liefe - für einen Gang in den Keller.
NACHLAUF_SEKUNDEN = 600.0

#: Der Modus, in den selbsttätig geschaltet wird.
#:
#: Nie «urlaub»: Der überwacht auch Innenräume und hat keine Karenz für
#: Bewohner - das ist eine Entscheidung, die jemand treffen soll, nicht
#: eine, die aus einer Ortung folgt.
MODUS = "ausser_haus"


def stufe_lesen(wert: Any, ersatz: str = VORSCHLAGEN) -> str:
    """Eine gespeicherte Stufe einlesen (rein, testbar).

    Unbekanntes wird zur Vorgabe und nicht zu einem Fehler: Eine
    kaputte Zeile darf die Anlage nicht am Schalten hindern - in beide
    Richtungen nicht.
    """
    text = str(wert or "").strip().lower()
    return text if text in STUFEN else ersatz


def alle_weg(zustaende: Any) -> bool:
    """Ist ausdrücklich niemand mehr zuhause? (rein, testbar)

    Über ``presence.anyone_home_state``, damit hier keine zweite
    Auslegung von «unbekannt» entsteht. Dort steht auch, warum ein Haus
    voller unbekannter Telefone als «jemand da» gilt: Sonst schaltete
    sich die Anlage nach jedem Neustart scharf, während die Familie am
    Tisch sitzt.
    """
    return presence.anyone_home_state(zustaende) == "off"


def soll_scharf(
    zustaende: Any,
    *,
    stufe: str,
    state: str,
    weg_seit: float | None,
    jetzt: float,
    nachlauf: float = NACHLAUF_SEKUNDEN,
) -> bool:
    """Jetzt selbsttätig scharf schalten? (rein, testbar)

    Nur aus dem unscharfen Zustand: Wer im Nachtmodus ist, hat sich
    etwas dabei gedacht, und «ausser Haus» wäre dann eine Abstufung
    nach unten, nicht nach oben.
    """
    if stufe == AUS or state != "unscharf":
        return False
    if not alle_weg(zustaende):
        return False
    if weg_seit is None:
        return False
    return jetzt - weg_seit >= nachlauf


def soll_unscharf(zustaende: Any, *, stufe: str, state: str) -> bool:
    """Jetzt selbsttätig unscharf schalten? (rein, testbar)

    Ohne Nachlauf, im Gegensatz zum Scharfschalten: Wer heimkommt, steht
    in der Eingangsverzögerung, und die läuft. Zehn Minuten zu warten
    hiesse, die Sirene abzuwarten.

    Auch aus ``eintritt`` und ``ausgeloest`` heraus - gerade dann: Der
    Fall, für den man das einschaltet, ist die heulende Sirene, während
    man mit den Einkäufen in der Tür steht.
    """
    if stufe == AUS:
        return False
    if state == "unscharf":
        return False
    return not alle_weg(zustaende)


def satz(richtung: str, stufe: str) -> str:
    """Was in der Nachricht steht (rein, testbar).

    Zwei Formulierungen je Richtung: «vorschlagen» fragt, «automatisch»
    berichtet. Ein Vorschlag, der wie eine Meldung klingt, wird
    weggewischt, und dann steht das Haus offen.
    """
    if richtung == "scharf":
        return (
            "Niemand mehr zuhause – die Anlage scharf schalten?"
            if stufe == VORSCHLAGEN
            else "Niemand mehr zuhause – die Anlage ist scharf."
        )
    return (
        "Jemand ist heimgekommen – die Anlage abschalten?"
        if stufe == VORSCHLAGEN
        else "Jemand ist heimgekommen – die Anlage ist unscharf."
    )
