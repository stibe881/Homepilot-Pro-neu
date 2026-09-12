"""Push-Einstellungen je Gerät statt je Person (Punkt 471 der Werkbank).

Wer sich mit Telefon *und* iPad anmeldet, bekam auf beiden dasselbe -
auch die Ruhezeit galt für beide gleich. Das iPad liegt nachts im
Wohnzimmer und darf klingeln; das Telefon liegt neben dem Bett. Umgekehrt
will man den Timer der Küche auf dem Wandpanel und nicht in der Hosentasche.

Die Ablage bleibt, wie sie war: eine Zeile je Person in ``push_prefs``,
mit ``muted``, ``ruhe`` und ``still``. Dazu kommt ``geraete`` - ein
Verzeichnis Token → Abweichungen. Zwei Entscheidungen dahinter:

- **Abweichung, nicht Kopie.** Ein Gerät ohne Eintrag folgt der Person;
  ein Gerät mit Eintrag überschreibt nur, was darin steht. Sonst müsste
  man jede neue Kategorie an drei Orten abbestellen, und die Geräte
  liefen mit der Zeit auseinander, ohne dass es jemand merkt.
- **Am Token, nicht am Namen.** Der Anzeigename eines Geräts ändert
  sich («iPhone von Stefan» → «Stefans iPhone»), der Token nicht.
  Meldet sich dasselbe Gerät mit neuem Token an, beginnt es bei der
  Vorgabe - das ist richtig so: Es ist für den Hub ein neues Gerät.

Reines Rechnen über Zeilen; wer schreibt, ist api/routes/push.py, und
wer die Auswahl trifft, ist der Push-Dienst.
"""

from __future__ import annotations

from typing import Any

#: Wo die Abweichungen in der Push-Zeile stehen.
FELD = "geraete"


def lesen(zeile: Any) -> dict[str, dict[str, Any]]:
    """Die Geräte-Abweichungen einer Person (rein, testbar).

    Defensiv: Eine kaputte Zeile im Datenspeicher soll den Hub nicht am
    Melden hindern, sondern nur dazu führen, dass alle Geräte der Person
    folgen - also so, wie es vor Punkt 471 war.
    """
    if not isinstance(zeile, dict):
        return {}
    roh = zeile.get(FELD)
    if not isinstance(roh, dict):
        return {}
    sauber: dict[str, dict[str, Any]] = {}
    for token, wert in roh.items():
        if isinstance(wert, dict) and str(token):
            sauber[str(token)] = wert
    return sauber


def fuer_geraet(zeile: Any, token: str) -> dict[str, Any]:
    """Was für dieses eine Gerät gilt (rein, testbar).

    Die Zeile der Person, überschrieben von dem, was am Gerät steht -
    Feld für Feld, nicht als Ganzes. Wer am iPad nur die Ruhezeit
    ausschaltet, behält dort die Abbestellungen der Person.
    """
    grund = zeile if isinstance(zeile, dict) else {}
    abweichung = lesen(grund).get(str(token), {})
    zusammen = dict(grund)
    zusammen.pop(FELD, None)
    for feld, wert in abweichung.items():
        if wert is not None:
            zusammen[feld] = wert
    return zusammen


def setzen(zeile: Any, token: str, felder: dict[str, Any]) -> dict[str, Any]:
    """Eine Abweichung setzen oder wegnehmen (rein, testbar).

    Ein Feld auf ``None`` nimmt es aus der Abweichung - das Gerät folgt
    dann wieder der Person. Eine leere Abweichung fliegt ganz heraus:
    Ein Eintrag, der nichts abweicht, ist im Speicher nur Ballast und in
    der App eine Zeile, die «eigene Einstellung» behauptet.
    """
    grund = dict(zeile) if isinstance(zeile, dict) else {}
    geraete = {k: dict(v) for k, v in lesen(grund).items()}
    eintrag = geraete.get(str(token), {})
    for feld, wert in felder.items():
        if wert is None:
            eintrag.pop(feld, None)
        else:
            eintrag[feld] = wert
    if eintrag:
        geraete[str(token)] = eintrag
    else:
        geraete.pop(str(token), None)
    if geraete:
        grund[FELD] = geraete
    else:
        grund.pop(FELD, None)
    return grund


def weicht_ab(zeile: Any, token: str) -> bool:
    """Hat dieses Gerät eine eigene Einstellung? (rein, testbar)"""
    return str(token) in lesen(zeile)


def aufraeumen(zeile: Any, tokens: Any) -> dict[str, Any] | None:
    """Abweichungen zu Geräten wegwerfen, die es nicht mehr gibt (rein).

    Ein abgemeldetes Telefon hinterliesse sonst für immer eine Zeile,
    und nach zwei Jahren stünden dort acht Geräte, von denen zwei noch
    existieren. ``None``, wenn nichts zu tun war - dann muss auch nichts
    geschrieben werden.
    """
    grund = dict(zeile) if isinstance(zeile, dict) else {}
    geraete = lesen(grund)
    lebend = {str(token) for token in tokens or []}
    uebrig = {token: wert for token, wert in geraete.items() if token in lebend}
    if len(uebrig) == len(geraete):
        return None
    if uebrig:
        grund[FELD] = uebrig
    else:
        grund.pop(FELD, None)
    return grund
