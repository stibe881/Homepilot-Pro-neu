"""Ton: einblenden, dämpfen, deckeln, verschieben.

Vier Dinge, die alle am selben Ort hängen - der Lautstärke einer Box -
und die vorher entweder gar nicht gingen oder an vier Stellen halb.

**Einblenden.** Eine Box, die um sieben Uhr mit 60 % losbrüllt, weckt
falsch. Der Weg von Null auf die Zielstärke dauert hier ein paar
Sekunden; das ist der Unterschied zwischen «geweckt» und «erschreckt».

**Dämpfen.** Wenn es an der Türe klingelt, soll die Musik kurz leiser
werden - nicht aus. Danach steht sie wieder, wo sie war. Ohne das
Gedächtnis für das Davor wäre Dämpfen ein Einweg-Weg.

**Deckeln.** Nachts hat 80 % nichts verloren, auch nicht aus Versehen.
Der Deckel greift an der einen Stelle, an der alle Lautstärkewünsche
vorbeikommen - nicht in jeder Integration einzeln.

**Verschieben.** «Das läuft in der Küche, ich gehe ins Wohnzimmer» ist
kein neuer Wunsch, sondern derselbe an einem anderen Ort. Spotify und
Radio können ihre Wiedergabe umziehen; eine Box, auf der jemand direkt
vom Handy castet, kann es nicht - und dann sagt der Hub das auch.

Alles Rechnen steht als reine Funktion oben und ist ohne Hub prüfbar.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from .errors import HomePilotError

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

#: Wo die Nachtruhe in der Datendatei steht.
NACHTRUHE_KEY = "ton_nachtruhe"

#: Wo eine laufende Dämpfung liegt. Ohne diesen Eintrag bliebe eine Box
#: leise, wenn der Hub genau zwischen «leiser» und «wieder lauter» neu
#: startet - und niemand wüsste, warum.
DUCK_STAND_KEY = "ton_daempfung_laeuft"

#: Und wo der Schalter fürs Dämpfen beim Klingeln steht. Er ist an:
#: Musik, die das Klingeln übertönt, ist genau der Fall, für den es
#: das Dämpfen gibt.
DUCK_KEY = "ton_daempfen"

#: Aus, bis jemand sie einschaltet. Ein Deckel, den niemand bestellt hat,
#: ist aus Sicht des Bedienenden ein Defekt.
STANDARD_NACHTRUHE: dict[str, Any] = {
    "on": False,
    "from": "22:00",
    "to": "07:00",
    "max": 30,
}

#: So viele Stufen hat das Einblenden. Zehn sind fein genug, dass man
#: keine Sprünge hört, und grob genug, dass es keine Befehlsflut wird.
EINBLEND_STUFEN = 10
#: Voreingestellte Dauer fürs Einblenden.
EINBLEND_DAUER = 6.0

#: Beim Klingeln geht die Musik auf ein Viertel zurück …
DUCK_ANTEIL = 0.25
#: … aber nie unter diesen Wert: Ganz weg wäre «aus», nicht «leiser».
DUCK_MINIMUM = 5
#: So lange bleibt sie leise. Lang genug, um die Gegensprechanlage zu
#: hören, kurz genug, dass niemand nach der Fernbedienung greift.
DUCK_DAUER = 25.0


def minuten(hhmm: Any) -> int | None:
    """«22:00» → 1320 (rein, testbar). Unsinn ergibt None."""
    text = str(hhmm or "").strip()
    if ":" not in text:
        return None
    stunde, _, minute = text.partition(":")
    try:
        h, m = int(stunde), int(minute)
    except ValueError:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h * 60 + m


def im_fenster(jetzt: int, von: int, bis: int) -> bool:
    """Liegt `jetzt` im Fenster von…bis? (rein, testbar)

    Der interessante Fall ist der über Mitternacht: 22:00 bis 07:00 ist
    kein Zahlenbereich, sondern zwei. Ein naives ``von <= jetzt < bis``
    hätte die Nachtruhe genau nachts nicht angewandt.
    """
    if von == bis:
        # Ein Fenster ohne Breite ist keines - sonst wäre «22:00 bis
        # 22:00» entweder nie oder immer, und beides überrascht.
        return False
    if von < bis:
        return von <= jetzt < bis
    return jetzt >= von or jetzt < bis


def deckel_jetzt(einstellung: dict[str, Any] | None, jetzt: int) -> int | None:
    """Der geltende Deckel in Prozent - oder None (rein, testbar).

    `jetzt` sind Minuten seit Mitternacht. None heisst: kein Deckel,
    weder weil die Nachtruhe aus ist noch weil die Zeiten unlesbar sind.
    Ein unleserlicher Eintrag darf nicht stillschweigend alles deckeln.
    """
    if not einstellung or not einstellung.get("on"):
        return None
    von = minuten(einstellung.get("from"))
    bis = minuten(einstellung.get("to"))
    if von is None or bis is None:
        return None
    if not im_fenster(jetzt, von, bis):
        return None
    try:
        grenze = int(einstellung.get("max", STANDARD_NACHTRUHE["max"]))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, grenze))


def gedeckelt(prozent: Any, deckel: int | None) -> int | None:
    """Einen Lautstärkewunsch auf den Deckel bringen (rein, testbar)."""
    try:
        wert = int(round(float(prozent)))
    except (TypeError, ValueError):
        return None
    wert = max(0, min(100, wert))
    if deckel is None:
        return wert
    return min(wert, deckel)


def rampe(start: int, ziel: int, stufen: int = EINBLEND_STUFEN) -> list[int]:
    """Die Lautstärkestufen vom Start zum Ziel (rein, testbar).

    Der Startwert steht mit dabei: Das Einblenden fängt hörbar bei Null
    an, nicht bei der ersten Stufe darüber. Das Ziel ist immer der
    letzte Wert - auch wenn die Rechnung dazwischen rundet.
    """
    start = max(0, min(100, int(start)))
    ziel = max(0, min(100, int(ziel)))
    stufen = max(1, int(stufen))
    if start == ziel:
        return [ziel]
    werte: list[int] = []
    for schritt in range(stufen + 1):
        wert = round(start + (ziel - start) * schritt / stufen)
        if not werte or wert != werte[-1]:
            werte.append(int(wert))
    if werte[-1] != ziel:
        werte.append(ziel)
    return werte


def duck_ziel(
    aktuell: Any, anteil: float = DUCK_ANTEIL, minimum: int = DUCK_MINIMUM
) -> int | None:
    """Wie leise beim Klingeln? (rein, testbar)

    None heisst «nichts zu tun»: Wer schon leiser ist als das Ziel, wird
    nicht künstlich lauter gemacht, und ohne bekannte Lautstärke wird
    nicht geraten.
    """
    try:
        wert = int(round(float(aktuell)))
    except (TypeError, ValueError):
        return None
    ziel = max(minimum, int(round(wert * anteil)))
    return None if ziel >= wert else ziel


def nachtruhe_pruefen(werte: dict[str, Any]) -> dict[str, Any]:
    """Eine Eingabe aus der App prüfen und normen (rein, testbar)."""
    ergebnis = dict(STANDARD_NACHTRUHE)
    ergebnis["on"] = bool(werte.get("on"))
    for feld in ("from", "to"):
        if feld in werte:
            if minuten(werte[feld]) is None:
                raise HomePilotError(
                    f"«{werte[feld]}» ist keine Uhrzeit - erwartet wird HH:MM."
                )
            ergebnis[feld] = str(werte[feld]).strip()
    if "max" in werte:
        try:
            grenze = int(werte["max"])
        except (TypeError, ValueError):
            raise HomePilotError("Der Deckel ist eine Zahl zwischen 0 und 100.") from None
        if not 0 <= grenze <= 100:
            raise HomePilotError("Der Deckel ist eine Zahl zwischen 0 und 100.")
        ergebnis["max"] = grenze
    return ergebnis


#: Befehle, die eine Lautstärke setzen und deshalb am Deckel vorbeimüssen.
LAUT_BEFEHLE = ("set_volume", "volume_up", "play_url")


class Tonmeister:
    """Der Teil des Hubs, der weiss, wie laut gerade richtig ist."""

    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        #: entity_id → Lautstärke vor dem Dämpfen.
        self._davor: dict[str, int] = {}
        #: Läuft gerade eine Dämpfung? Dann keine zweite obendrauf.
        self._daempfung: asyncio.Task[None] | None = None
        #: entity_id → laufendes Einblenden, damit zwei sich nicht in die
        #: Quere kommen.
        self._blenden: dict[str, asyncio.Task[None]] = {}

    # ── Nachtruhe ──────────────────────────────────────────────────────

    def nachtruhe(self) -> dict[str, Any]:
        """Die gespeicherte Einstellung, ergänzt um die Vorgaben."""
        gespeichert = self.hub.data.get(NACHTRUHE_KEY)
        eintrag = gespeichert[0] if gespeichert and isinstance(gespeichert[0], dict) else {}
        werte = dict(STANDARD_NACHTRUHE)
        werte.update({k: v for k, v in eintrag.items() if k in STANDARD_NACHTRUHE})
        return werte

    def nachtruhe_setzen(self, werte: dict[str, Any]) -> dict[str, Any]:
        geprueft = nachtruhe_pruefen({**self.nachtruhe(), **(werte or {})})
        self.hub.data.set(NACHTRUHE_KEY, [geprueft])
        return geprueft

    def deckel(self, jetzt: float | None = None) -> int | None:
        """Der geltende Deckel - None, wenn gerade keiner gilt."""
        stunde = time.localtime(jetzt) if jetzt is not None else time.localtime()
        return deckel_jetzt(self.nachtruhe(), stunde.tm_hour * 60 + stunde.tm_min)

    def wunsch_deckeln(
        self, entity: Any, command: str, data: dict[str, Any]
    ) -> tuple[str, dict[str, Any]]:
        """Einen Befehl vor dem Absenden auf den Deckel bringen.

        Zwei Fälle. Kommt eine Zahl mit, wird sie begrenzt - das ist der
        einfache. Der andere ist «Lauter» ohne Zahl: Hier stand einmal,
        der Hub kenne den aktuellen Wert nicht. Er kennt ihn - er steht
        im Zustand der Box. Also wird aus einem Lauter, das über den
        Deckel führen würde, ein Setzen auf den Deckel. Ein Knopf, der
        nichts mehr tut, ist ehrlicher als einer, der die Nachtruhe
        umgeht.

        Zurück kommen Befehl und Daten, denn der erste kann sich ändern.
        """
        grenze = self.deckel()
        if grenze is None or command not in LAUT_BEFEHLE:
            return command, data

        if "volume" in data:
            gewuenscht = data.get("volume")
            gedrosselt = gedeckelt(gewuenscht, grenze)
            if gedrosselt is None or gedrosselt == gewuenscht:
                return command, data
            log.info("Nachtruhe: Lautstärke %s auf %s gedeckelt", gewuenscht, gedrosselt)
            return command, {**data, "volume": gedrosselt}

        if command != "volume_up":
            return command, data
        jetzt = entity.state.get("volume") if entity is not None else None
        if jetzt is None or "set_volume" not in getattr(entity, "commands", ()):
            # Ohne bekannte Lautstärke oder ohne Setzbefehl bleibt es beim
            # Lauter: Raten wäre schlimmer als die Lücke.
            return command, data
        try:
            stand = int(jetzt)
        except (TypeError, ValueError):
            return command, data
        if stand < grenze:
            return command, data
        log.info("Nachtruhe: «Lauter» auf %s begrenzt", grenze)
        return "set_volume", {**data, "volume": grenze}

    # ── Einblenden ─────────────────────────────────────────────────────

    async def einblenden(
        self, entity_id: str, ziel: int, dauer: float = EINBLEND_DAUER
    ) -> None:
        """Von Null auf `ziel` - langsam genug, um nicht zu erschrecken."""
        ziel = gedeckelt(ziel, self.deckel()) or 0
        stufen = rampe(0, ziel)
        pause = max(0.05, float(dauer) / max(1, len(stufen)))
        laufend = self._blenden.pop(entity_id, None)
        if laufend is not None:
            laufend.cancel()

        async def lauf() -> None:
            try:
                for wert in stufen:
                    await self.hub.integrations.dispatch_command(
                        entity_id, "set_volume", {"volume": wert}
                    )
                    await asyncio.sleep(pause)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                log.warning("Einblenden auf %s abgebrochen: %s", entity_id, err)
            finally:
                self._blenden.pop(entity_id, None)

        aufgabe = asyncio.create_task(lauf())
        self._blenden[entity_id] = aufgabe

    async def ausblenden(self, entity_id: str, dauer: float = EINBLEND_DAUER) -> None:
        """Leiser werden und dann pausieren - für den Schlummer-Timer.

        Am Ende steht die alte Lautstärke wieder da, ohne dass etwas
        spielt. Sonst wäre die Box beim nächsten Einschalten stumm, und
        man suchte den Fehler bei der Musik.
        """
        entity = self.hub.registry.get(entity_id)
        if entity is None:
            raise HomePilotError("Diese Box kennt der Hub nicht.")
        davor = entity.state.get("volume")
        stufen = list(reversed(rampe(0, int(davor)))) if davor is not None else []
        pause = max(0.05, float(dauer) / max(1, len(stufen) or 1))
        for wert in stufen:
            try:
                await self.hub.integrations.dispatch_command(
                    entity_id, "set_volume", {"volume": wert}
                )
            except Exception as err:
                log.debug("Ausblenden auf %s: %s", entity_id, err)
                break
            await asyncio.sleep(pause)
        try:
            await self.hub.integrations.dispatch_command(entity_id, "pause", {})
        except Exception as err:
            log.info("Schlummer: %s liess sich nicht pausieren: %s", entity_id, err)
        if davor is not None:
            try:
                await self.hub.integrations.dispatch_command(
                    entity_id, "set_volume", {"volume": int(davor)}
                )
            except Exception as err:  # pragma: no cover - nur Kosmetik
                log.debug("Lautstärke nach dem Schlummern: %s", err)

    # ── Dämpfen ────────────────────────────────────────────────────────

    def _spielende(self) -> list[Any]:
        """Boxen, auf denen gerade etwas läuft und die leiser können."""
        from .entity import EntityKind

        return [
            entity
            for entity in self.hub.registry.all()
            if entity.kind == EntityKind.MEDIA_PLAYER
            and entity.available
            and "set_volume" in entity.commands
            and str(entity.state.get("state")) in ("playing", "buffering")
            and entity.state.get("volume") is not None
        ]

    async def daempfen(self, dauer: float = DUCK_DAUER) -> list[str]:
        """Kurz leiser stellen und danach zurück. Gibt die Namen zurück."""
        if self._daempfung is not None and not self._daempfung.done():
            # Zweimal klingeln heisst nicht zweimal leiser - das Davor
            # von der ersten Dämpfung wäre sonst verloren.
            return []
        betroffen: list[str] = []
        for entity in self._spielende():
            ziel = duck_ziel(entity.state.get("volume"))
            if ziel is None:
                continue
            self._davor[entity.id] = int(entity.state["volume"])
            self._stand_sichern()
            try:
                await self.hub.integrations.dispatch_command(
                    entity.id, "set_volume", {"volume": ziel}
                )
                betroffen.append(entity.label)
            except Exception as err:
                self._davor.pop(entity.id, None)
                log.debug("Dämpfen von %s ging nicht: %s", entity.id, err)
        if betroffen:
            self._daempfung = asyncio.create_task(self._zurueck(dauer))
        return betroffen

    async def _zurueck(self, dauer: float) -> None:
        try:
            await asyncio.sleep(max(1.0, float(dauer)))
        except asyncio.CancelledError:
            raise
        await self.lauter_stellen()

    def _stand_sichern(self) -> None:
        """Die laufende Dämpfung auf die Platte schreiben."""
        self.hub.data.set(
            DUCK_STAND_KEY,
            [{"entity_id": eid, "volume": wert} for eid, wert in self._davor.items()],
        )

    async def _daempfung_nachholen(self) -> None:
        """Nach einem Neustart: Stand einer unterbrochenen Dämpfung.

        Der Hub kann zwischen «leiser» und «wieder lauter» neu starten -
        ein Update reicht dafür. Ohne das hier bliebe die Box leise, und
        die Ursache stünde nirgends.
        """
        offen = [
            zeile
            for zeile in self.hub.data.get(DUCK_STAND_KEY)
            if isinstance(zeile, dict) and zeile.get("entity_id")
        ]
        if not offen:
            return
        log.info("Dämpfung vom letzten Lauf gefunden - Lautstärke wird zurückgestellt")
        self._davor = {
            str(zeile["entity_id"]): int(zeile.get("volume") or 0) for zeile in offen
        }
        await self.lauter_stellen()

    async def lauter_stellen(self) -> None:
        """Die gemerkten Lautstärken wiederherstellen."""
        davor, self._davor = self._davor, {}
        self._stand_sichern()
        for entity_id, wert in davor.items():
            try:
                await self.hub.integrations.dispatch_command(
                    entity_id, "set_volume", {"volume": wert}
                )
            except Exception as err:
                log.debug("Lautstärke von %s nicht zurückgestellt: %s", entity_id, err)

    # ── Verschieben ────────────────────────────────────────────────────

    def _umzugsfaehig(self, entity: Any) -> Any:
        """Wer die Wiedergabe dieser Box umziehen kann.

        Entweder die Box selbst (Radio, Spotify - beides sind Player mit
        einem Ziel) oder der Player, der gerade auf sie spielt.
        """
        if "play_on" in entity.commands:
            return entity
        name = entity.state.get("device") or entity.name
        for kandidat in self.hub.registry.all():
            if "play_on" not in kandidat.commands:
                continue
            if str(kandidat.state.get("device") or "") in (entity.name, name):
                return kandidat
        return None

    async def verschieben(self, entity_id: str, ziel: str) -> dict[str, Any]:
        """Dieselbe Wiedergabe auf einer anderen Box weiterlaufen lassen."""
        entity = self.hub.registry.get(entity_id)
        if entity is None:
            raise HomePilotError("Diese Box kennt der Hub nicht.")
        ziel_name = (ziel or "").strip()
        if not ziel_name:
            raise HomePilotError("Wohin denn? Es fehlt die Zielbox.")
        ziel_entity = self.hub.registry.get(ziel_name)
        if ziel_entity is not None:
            ziel_name = ziel_entity.name
        traeger = self._umzugsfaehig(entity)
        if traeger is None:
            raise HomePilotError(
                f"«{entity.label}» spielt direkt von einem Gerät im Haus - das "
                "kann der Hub nicht umziehen. Verschieben geht, was der Hub "
                "selbst gestartet hat (Spotify oder Radio)."
            )
        await self.hub.integrations.dispatch_command(
            traeger.id, "play_on", {"device": ziel_name}
        )
        return {"from": entity.name, "to": ziel_name, "player": traeger.name}

    # ── Durchsagen ─────────────────────────────────────────────────────

    def zustand_merken(self, entity_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Was auf diesen Boxen lief, bevor die Durchsage kam (rein genug).

        Nur Lautstärke und Zustand - der Titel selbst interessiert nicht,
        denn wiederaufnehmen kann ohnehin nur der Player, der ihn
        gestartet hat.
        """
        gemerkt: dict[str, dict[str, Any]] = {}
        for entity_id in entity_ids:
            entity = self.hub.registry.get(entity_id)
            if entity is None:
                continue
            traeger = self._umzugsfaehig(entity)
            gemerkt[entity_id] = {
                "volume": entity.state.get("volume"),
                "state": str(entity.state.get("state") or ""),
                "player": traeger.id if traeger is not None and traeger.id != entity_id else None,
            }
        return gemerkt

    async def durchsage_zurueck(
        self, gemerkt: dict[str, dict[str, Any]], frist: float = 60.0
    ) -> None:
        """Nach der Durchsage den alten Zustand wiederherstellen.

        Vorher blieb die Box auf der Lautstärke der Durchsage stehen und
        die Musik aus - eine Ansage um sieben Uhr hinterliess bis abends
        eine Box auf 70 %.

        Gewartet wird, bis die Ansage durch ist: Der Zustand geht auf
        «standby», sobald der Empfänger fertig ist. Die Frist ist die
        Notbremse für den Fall, dass diese Meldung nie kommt.
        """
        ende = time.monotonic() + max(2.0, float(frist))
        while time.monotonic() < ende:
            await asyncio.sleep(0.5)
            if all(
                str(self.hub.registry.get(eid).state.get("state") if self.hub.registry.get(eid) else "")
                not in ("playing", "buffering")
                for eid in gemerkt
            ):
                break
        for entity_id, davor in gemerkt.items():
            try:
                if davor.get("volume") is not None:
                    await self.hub.integrations.dispatch_command(
                        entity_id, "set_volume", {"volume": int(davor["volume"])}
                    )
                if davor.get("state") == "playing":
                    # Weiterspielen kann nur, wer die Wiedergabe gestartet
                    # hat. Bei einer Box, auf die jemand direkt castet, ist
                    # die Sitzung mit der Ansage weg - dann bleibt es beim
                    # Zurückstellen der Lautstärke.
                    weiter = davor.get("player") or entity_id
                    ziel = self.hub.registry.get(str(weiter))
                    if ziel is not None and "play" in ziel.commands:
                        await self.hub.integrations.dispatch_command(str(weiter), "play", {})
            except Exception as err:
                log.debug("Nach der Durchsage: %s liess sich nicht zurückstellen: %s", entity_id, err)

    # ── Klingeln ───────────────────────────────────────────────────────

    def start(self) -> None:
        """Auf das Klingeln horchen, um die Musik kurz zu dämpfen."""
        self.hub.bus.subscribe("doorbell", self._on_klingeln)
        # Erst, wenn die Geräte da sind - deshalb als eigene Aufgabe.
        asyncio.create_task(self._daempfung_nachholen())

    def daempfen_an(self) -> bool:
        """Soll beim Klingeln gedämpft werden? Vorgabe: ja."""
        eintraege = self.hub.data.get(DUCK_KEY)
        if not eintraege or not isinstance(eintraege[0], dict):
            return True
        return bool(eintraege[0].get("on", True))

    def daempfen_setzen(self, an: bool) -> bool:
        self.hub.data.set(DUCK_KEY, [{"on": bool(an)}])
        return bool(an)

    def _on_klingeln(self, _event_type: str, _data: dict[str, Any]) -> None:
        """Der Bus ruft synchron - hier nur den Sprung anstossen."""
        if not self.daempfen_an():
            return
        asyncio.create_task(self.daempfen())
