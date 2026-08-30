"""Eine Verbindung, die dauernd neu aufgebaut wird (alle rein, testbar).

Der Wächter kennt bisher zwei Zustände: erreichbar oder nicht. Die
Zwischenstufe fehlt, und die ist die häufigste – der Fernseher, der
alle paar Minuten die Verbindung verliert und wieder aufbaut; die
Wolke, die jede dritte Anfrage abweist; das Funkgerät am Rand der
Reichweite.

Nach aussen sieht das aus wie Betrieb. Der Ausfallmelder greift nicht,
weil er eine Karenz von Minuten hat und die Verbindung vorher wieder
steht. Trotzdem kostet es Batterie und Bandbreite, Befehle gehen in
einer gerade zumachenden Leitung verloren – genau so verschwanden
monatelang die Tastendrücke an den Fernseher –, und dem endgültigen
Ausfall geht es wochenlang voraus.

Gezählt werden Flanken, nicht Pegel: jedes Mal, wenn ein Gerät nach
einer Unterbrechung wieder erreichbar wird. Wer zwei Stunden weg ist
und einmal zurückkommt, flattert nicht. Wer in einer Stunde achtmal
zurückkommt, schon.
"""

from __future__ import annotations

# Wie weit zurück gezählt wird. Eine Stunde: kurz genug, dass die Meldung
# etwas mit jetzt zu tun hat, lang genug, dass ein Gerät mit einem
# Wackelkontakt sie erreicht.
FENSTER = 3600.0

# Ab wie vielen Rückkehrern im Fenster es flattert. Sechs, nicht zwei:
# Zwei Aussetzer in einer Stunde hat jedes Funknetz einmal, und eine
# Meldung, die bei jedem Gewitter kommt, schaltet man ab.
SCHWELLE = 6


def merken(zeiten: list[float], jetzt: float, fenster: float = FENSTER) -> list[float]:
    """Eine Rückkehr eintragen und Altes vergessen (rein, testbar).

    Das Vergessen gehört hierher und nicht in den Melder: Sonst wüchse
    die Liste eines wackeligen Geräts über Tage, und die Meldung käme
    irgendwann wegen einer Stunde von vorgestern.
    """
    frisch = [zeit for zeit in zeiten if jetzt - zeit < fenster]
    frisch.append(jetzt)
    return frisch


def flattert(zeiten: list[float], schwelle: int = SCHWELLE) -> bool:
    """Sind es genug Rückkehrer, um es eine Meldung wert zu sein?"""
    return len(zeiten) >= schwelle


def beruhigt(zeiten: list[float], jetzt: float, fenster: float = FENSTER) -> bool:
    """Ist seit einem ganzen Fenster Ruhe? (rein, testbar)

    Erst dann darf dieselbe Integration wieder gemeldet werden. Ohne
    diesen Abstand käme die Meldung im Wechsel mit jeder einzelnen
    Rückkehr – der Fehler, den die Akku-Warnung schon einmal gemacht hat.
    """
    if not zeiten:
        return True
    return (jetzt - max(zeiten)) >= fenster


def satz(name: str, anzahl: int, fenster: float = FENSTER) -> str:
    """Was in der Meldung steht (rein, testbar).

    Die Zahl gehört hinein: «flattert» allein sagt nicht, ob man
    heute Abend nachsehen muss oder nächste Woche. Und der Satz nennt
    die drei Ursachen, die es fast immer sind – sonst steht man vor
    einer Meldung, die ein Problem benennt und keinen Griff dazu.
    """
    stunden = max(1, round(fenster / 3600))
    zeitraum = "einer Stunde" if stunden == 1 else f"{stunden} Stunden"
    return (
        f"Die Anbindung '{name}' hat sich in {zeitraum} {anzahl}-mal neu "
        "verbunden. Das sieht von aussen aus wie Betrieb, kostet aber "
        "Batterie und verschluckt Befehle. Meist: schlechter Empfang, ein "
        "überlastetes Gerät oder eine Wolke, die abweist."
    )
