"""Ein teuer geholtes Bild eine Weile behalten (rein, testbar).

Die Saugerkarte ist der teuerste Aufruf der Roborock-Bibliothek: eine
Runde in die Wolke, dann das Neuzeichnen der ganzen Karte als PNG. Die
App fragt dieses Bild aber jedes Mal neu an, wenn die Kachel erscheint –
beim Öffnen der Startseite, nach jedem Wechsel zurück, auf iPhone und
iPad getrennt. Sekundenlang blieb die Fläche leer, für ein Bild, das sich
seit dem letzten Mal um nichts geändert hatte.

Deshalb hier ein Vorrat: Wer fragt, bekommt das zuletzt gezeichnete Bild,
solange es jung genug ist. Wie jung «jung genug» ist, entscheidet der
Aufrufer bei jeder Frage neu – ein stehender Sauger darf eine Weile mit
demselben Bild auskommen, ein fahrender nicht.

Die Uhr steckt bewusst nicht darin, sondern kommt bei jedem Aufruf mit.
So kann ein Test springen, statt zu warten, und die Klasse hat keine
Meinung darüber, ob jemand Wanduhr oder Betriebsdauer misst (für den
Ablauf hier gehört die Betriebsdauer hin: Sie läuft nicht rückwärts,
wenn jemand die Uhr des Rechners stellt).
"""

from __future__ import annotations


class Bildspeicher:
    """Je Schlüssel ein Bild mit dem Zeitpunkt, an dem es entstand."""

    def __init__(self) -> None:
        self._stand: dict[str, tuple[float, bytes]] = {}

    def hole(self, key: str, jetzt: float, hoechstalter: float) -> bytes | None:
        """Das gespeicherte Bild, falls es nicht älter als `hoechstalter` ist.

        `hoechstalter` von 0 heisst «immer neu holen» – damit lässt sich
        der Vorrat abschalten, ohne den Aufrufer zu verzweigen.
        """
        eintrag = self._stand.get(key)
        if eintrag is None or hoechstalter <= 0:
            return None
        entstanden, bild = eintrag
        # Läuft die Uhr doch einmal rückwärts, gilt das Bild als alt und
        # wird neu geholt. Lieber einmal zu viel als für immer eingefroren.
        alter = jetzt - entstanden
        if alter < 0 or alter > hoechstalter:
            return None
        return bild

    def lege(self, key: str, jetzt: float, bild: bytes | None) -> None:
        """Ein frisch geholtes Bild merken. `None` löscht den Eintrag –
        ein fehlgeschlagener Abruf darf keinen alten Stand festhalten."""
        if bild is None:
            self._stand.pop(key, None)
        else:
            self._stand[key] = (jetzt, bild)

    def vergiss(self, key: str) -> None:
        """Nach einem Befehl an das Gerät: Was jetzt kommt, ist anders."""
        self._stand.pop(key, None)

    def alter(self, key: str, jetzt: float) -> float | None:
        """Wie alt der gespeicherte Stand ist – für Protokoll und Test."""
        eintrag = self._stand.get(key)
        return None if eintrag is None else jetzt - eintrag[0]
