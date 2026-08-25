"""Was die Musik im Haus sich merkt.

Vier Dinge, die die Kachel allein nicht leisten kann, weil sie ein
Gedächtnis brauchen:

**Favoriten.** «Die Playlist von gestern Abend» ist in der App eine
Suche durch drei Listen. Ein Favorit ist ein Name, eine Box und ein
Tipp - egal, ob dahinter eine Spotify-Playlist oder ein Radiosender
steckt.

**Was lief zuletzt.** Die Kachel zeigt, was läuft. «Wie hiess das Lied
vorhin?» war nirgends zu beantworten, obwohl der Hub jeden Titelwechsel
sieht.

**Schlummer-Timer.** Musik zum Einschlafen, die von selbst aufhört -
und zwar leiser werdend, nicht mitten im Takt.

**Musikwecker.** Der Wecker, der nicht piepst. Er blendet ein (siehe
`ton.einblenden`), damit er weckt und nicht erschreckt.

Alles Rechnen steht als reine Funktion oben. Der Rest ist ein Takt, der
einmal pro Minute schaut, ob ein Wecker dran ist.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from typing import TYPE_CHECKING, Any

from .errors import HomePilotError

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

FAVORITEN_KEY = "musik_favoriten"
VERLAUF_KEY = "musik_verlauf"
WECKER_KEY = "musik_wecker"

#: So viele Titel bleiben im Verlauf. Zwanzig sind ein Abend.
VERLAUF_LIMIT = 20
#: Und so viele Favoriten - darüber ist es keine Auswahl mehr.
FAVORITEN_LIMIT = 30
#: So viele Wecker. Mehr als einer je Person wäre eine Kalenderfrage.
WECKER_LIMIT = 10
#: Wie lange ein Wecker einblendet, wenn nichts anderes dasteht.
EINBLEND_STANDARD = 20.0

#: Womit sich ein Favorit abspielen lässt: die Art, das Kommando und das
#: Feld, in dem der Name steht.
FAVORIT_ARTEN = {
    "playlist": ("play_playlist", "name"),
    "station": ("play_radio", "station"),
}

#: Wochentage, wie die App sie schickt (0 = Montag).
WOCHE = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def _text(wert: Any, laenge: int = 80) -> str:
    return str(wert or "").strip()[:laenge]


def favorit_pruefen(werte: dict[str, Any]) -> dict[str, Any]:
    """Eine Eingabe aus der App zu einem Favoriten machen (rein, testbar)."""
    art = _text(werte.get("kind"), 20).lower()
    if art not in FAVORIT_ARTEN:
        moeglich = ", ".join(sorted(FAVORIT_ARTEN))
        raise HomePilotError(f"«{art or 'nichts'}» ist keine Art - erwartet: {moeglich}.")
    name = _text(werte.get("name"))
    if not name:
        raise HomePilotError("Ein Favorit ohne Namen wäre eine leere Kachel.")
    return {
        "id": _text(werte.get("id"), 24) or secrets.token_urlsafe(6),
        "kind": art,
        "name": name,
        # Die Box ist freiwillig: «Diese Playlist» ist ein Favorit,
        # «diese Playlist in der Küche» ein anderer.
        "player": _text(werte.get("player")),
        "device": _text(werte.get("device")),
        "image": _text(werte.get("image"), 400),
    }


def verlauf_eintragen(
    verlauf: list[dict[str, Any]], eintrag: dict[str, Any], limit: int = VERLAUF_LIMIT
) -> list[dict[str, Any]] | None:
    """Einen Titel in den Verlauf legen (rein, testbar).

    None heisst «nichts zu tun». Das ist der häufige Fall: Der Hub sieht
    denselben Titel bei jeder Lautstärkeänderung erneut, und ein Verlauf,
    in dem ein Lied zwanzigmal steht, ist keiner.
    """
    titel = _text(eintrag.get("track"))
    if not titel:
        return None
    if verlauf and _text(verlauf[0].get("track")) == titel:
        return None
    neu = [
        {
            "track": titel,
            "artist": _text(eintrag.get("artist")),
            "player": _text(eintrag.get("player")),
            "image": _text(eintrag.get("image"), 400),
            "at": eintrag.get("at") or time.time(),
        }
    ]
    # Denselben Titel weiter unten herausnehmen: Wer ein Lied zweimal
    # hört, will es einmal in der Liste haben, oben.
    neu += [zeile for zeile in verlauf if _text(zeile.get("track")) != titel]
    return neu[:limit]


def uhrzeit(hhmm: Any) -> int | None:
    """«07:15» → 435 (rein, testbar)."""
    from .ton import minuten

    return minuten(hhmm)


def wecker_pruefen(werte: dict[str, Any]) -> dict[str, Any]:
    """Eine Weckereingabe prüfen und normen (rein, testbar)."""
    zeit = _text(werte.get("time"), 5)
    if uhrzeit(zeit) is None:
        raise HomePilotError(f"«{zeit or 'nichts'}» ist keine Uhrzeit - erwartet wird HH:MM.")
    tage = werte.get("days")
    if tage is None:
        # Kein Tag genannt heisst jeden Tag - nicht «nie».
        gewaehlt = list(range(7))
    else:
        gewaehlt = sorted({int(tag) for tag in tage if str(tag).lstrip("-").isdigit() and 0 <= int(tag) <= 6})
    if not gewaehlt:
        raise HomePilotError("Ein Wecker ohne Tag würde nie klingeln.")
    player = _text(werte.get("player"))
    if not player:
        raise HomePilotError("Auf welcher Box denn? Der Wecker braucht ein Ziel.")
    try:
        laut = int(werte.get("volume", 35))
    except (TypeError, ValueError):
        raise HomePilotError("Die Lautstärke ist eine Zahl zwischen 0 und 100.") from None
    try:
        blende = float(werte.get("fade", EINBLEND_STANDARD))
    except (TypeError, ValueError):
        blende = EINBLEND_STANDARD
    return {
        "id": _text(werte.get("id"), 24) or secrets.token_urlsafe(6),
        "on": bool(werte.get("on", True)),
        "time": zeit,
        "days": gewaehlt,
        "player": player,
        "device": _text(werte.get("device")),
        "volume": max(0, min(100, laut)),
        # Wie lange das Einblenden dauert. Wer hart geweckt werden will,
        # setzt sie auf Null - das ist eine Entscheidung, kein Defekt.
        "fade": max(0.0, min(300.0, blende)),
        "kind": _text(werte.get("kind"), 20).lower() or "station",
        "name": _text(werte.get("name")),
        "label": _text(werte.get("label")),
    }


def faellig(wecker: dict[str, Any], jetzt: int, wochentag: int, zuletzt: str | None) -> bool:
    """Ist dieser Wecker in dieser Minute dran? (rein, testbar)

    `zuletzt` ist die Marke des letzten Auslösens («2026-08-25 07:15»).
    Ohne sie würde ein Wecker in derselben Minute mehrfach losgehen -
    der Takt schaut öfter als einmal pro Minute nach.
    """
    if not wecker.get("on"):
        return False
    if wochentag not in (wecker.get("days") or []):
        return False
    ziel = uhrzeit(wecker.get("time"))
    if ziel is None or ziel != jetzt:
        return False
    return zuletzt != f"{wochentag}:{ziel}"


class Musikbuch:
    """Favoriten, Verlauf, Schlummer und Wecker."""

    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        #: wecker_id → Marke des letzten Auslösens.
        self._gelaufen: dict[str, str] = {}
        #: entity_id → laufender Schlummer-Timer.
        self._schlummer: dict[str, dict[str, Any]] = {}
        self._takt: asyncio.Task[None] | None = None

    # ── Verlauf ────────────────────────────────────────────────────────

    def start(self) -> None:
        self.hub.bus.subscribe("state_changed", self._on_state)
        self._takt = asyncio.create_task(self._wecker_takt())

    async def stop(self) -> None:
        if self._takt is not None:
            self._takt.cancel()
            self._takt = None
        for eintrag in list(self._schlummer.values()):
            eintrag["task"].cancel()
        self._schlummer.clear()

    def _on_state(self, _event_type: str, data: dict[str, Any]) -> None:
        from .entity import EntityKind

        neu = data.get("new_state") or {}
        if not isinstance(neu, dict) or str(neu.get("state")) != "playing":
            return
        entity = data.get("entity") if isinstance(data.get("entity"), dict) else {}
        if str(entity.get("kind") or "") not in ("media_player", EntityKind.MEDIA_PLAYER):
            return
        eintrag = {
            "track": neu.get("track"),
            "artist": neu.get("artist"),
            "player": entity.get("name") or data.get("entity_id"),
            "image": neu.get("image"),
        }
        gewandelt = verlauf_eintragen(list(self.hub.data.get(VERLAUF_KEY)), eintrag)
        if gewandelt is not None:
            self.hub.data.set(VERLAUF_KEY, gewandelt)

    def verlauf(self) -> list[dict[str, Any]]:
        return [zeile for zeile in self.hub.data.get(VERLAUF_KEY) if isinstance(zeile, dict)]

    # ── Favoriten ──────────────────────────────────────────────────────

    def favoriten(self) -> list[dict[str, Any]]:
        return [zeile for zeile in self.hub.data.get(FAVORITEN_KEY) if isinstance(zeile, dict)]

    def favorit_setzen(self, werte: dict[str, Any]) -> dict[str, Any]:
        eintrag = favorit_pruefen(werte)
        liste = [zeile for zeile in self.favoriten() if zeile.get("id") != eintrag["id"]]
        if len(liste) >= FAVORITEN_LIMIT:
            raise HomePilotError(
                f"Mehr als {FAVORITEN_LIMIT} Favoriten sind keine Auswahl mehr."
            )
        liste.append(eintrag)
        self.hub.data.set(FAVORITEN_KEY, liste)
        return eintrag

    def favorit_entfernen(self, favorit_id: str) -> bool:
        liste = self.favoriten()
        rest = [zeile for zeile in liste if zeile.get("id") != favorit_id]
        if len(rest) == len(liste):
            return False
        self.hub.data.set(FAVORITEN_KEY, rest)
        return True

    async def favorit_abspielen(self, favorit_id: str, device: str = "") -> dict[str, Any]:
        eintrag = next((z for z in self.favoriten() if z.get("id") == favorit_id), None)
        if eintrag is None:
            raise HomePilotError("Diesen Favoriten gibt es nicht mehr.")
        await self.abspielen(eintrag, device or str(eintrag.get("device") or ""))
        return eintrag

    async def abspielen(self, eintrag: dict[str, Any], device: str = "") -> None:
        """Eine Playlist oder einen Sender starten.

        Der Unterschied zwischen beiden ist ein Kommando und ein
        Feldname; alles andere ist gleich.
        """
        art = str(eintrag.get("kind") or "")
        if art not in FAVORIT_ARTEN:
            raise HomePilotError(f"Mit «{art}» kann der Hub nichts anfangen.")
        befehl, feld = FAVORIT_ARTEN[art]
        spieler = self._spieler(str(eintrag.get("player") or ""), befehl)
        daten: dict[str, Any] = {feld: eintrag.get("name")}
        if device:
            daten["device"] = device
        await self.hub.integrations.dispatch_command(spieler.id, befehl, daten)

    def _spieler(self, gewuenscht: str, befehl: str) -> Any:
        """Wer diesen Befehl ausführen kann - genannt oder gefunden."""
        if gewuenscht:
            entity = self.hub.registry.get(gewuenscht)
            if entity is not None and befehl in entity.commands:
                return entity
        for entity in self.hub.registry.all():
            if befehl in entity.commands:
                return entity
        fehlt = "Spotify" if befehl == "play_playlist" else "Radio"
        raise HomePilotError(
            f"Dafür bräuchte es {fehlt} - im Haus ist nichts eingerichtet, das "
            f"«{befehl}» kann."
        )

    # ── Schlummer ──────────────────────────────────────────────────────

    def schlummer_stand(self) -> list[dict[str, Any]]:
        return [
            {"entity_id": entity_id, "ends_at": eintrag["ends_at"]}
            for entity_id, eintrag in self._schlummer.items()
        ]

    def schlummer(self, entity_id: str, minutes: float) -> dict[str, Any]:
        if not 0 < minutes <= 480:
            raise HomePilotError("Zwischen einer Minute und acht Stunden.")
        if self.hub.registry.get(entity_id) is None:
            raise HomePilotError("Diese Box kennt der Hub nicht.")
        self.schlummer_abbrechen(entity_id)
        eintrag: dict[str, Any] = {"ends_at": time.time() + minutes * 60}
        eintrag["task"] = asyncio.create_task(self._schlummer_lauf(entity_id, minutes))
        self._schlummer[entity_id] = eintrag
        return {"entity_id": entity_id, "ends_at": eintrag["ends_at"]}

    def schlummer_abbrechen(self, entity_id: str) -> bool:
        eintrag = self._schlummer.pop(entity_id, None)
        if eintrag is None:
            return False
        eintrag["task"].cancel()
        return True

    async def _schlummer_lauf(self, entity_id: str, minutes: float) -> None:
        try:
            await asyncio.sleep(max(0.0, minutes * 60 - 30))
            # Die letzten dreissig Sekunden leiser werden - Musik, die
            # mitten im Takt abbricht, weckt eher, als dass sie einschlafen
            # lässt.
            await self.hub.ton.ausblenden(entity_id, dauer=30.0)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            log.warning("Schlummer-Timer für %s: %s", entity_id, err)
        finally:
            self._schlummer.pop(entity_id, None)

    # ── Wecker ─────────────────────────────────────────────────────────

    def wecker(self) -> list[dict[str, Any]]:
        return [zeile for zeile in self.hub.data.get(WECKER_KEY) if isinstance(zeile, dict)]

    def wecker_setzen(self, werte: dict[str, Any]) -> dict[str, Any]:
        eintrag = wecker_pruefen(werte)
        liste = [zeile for zeile in self.wecker() if zeile.get("id") != eintrag["id"]]
        if len(liste) >= WECKER_LIMIT:
            raise HomePilotError(f"Mehr als {WECKER_LIMIT} Wecker sind ein Kalender.")
        liste.append(eintrag)
        self.hub.data.set(WECKER_KEY, liste)
        return eintrag

    def wecker_entfernen(self, wecker_id: str) -> bool:
        liste = self.wecker()
        rest = [zeile for zeile in liste if zeile.get("id") != wecker_id]
        if len(rest) == len(liste):
            return False
        self.hub.data.set(WECKER_KEY, rest)
        return True

    async def _wecker_takt(self) -> None:
        while True:
            try:
                await asyncio.sleep(20)
                await self.wecker_pruefung()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Musikwecker-Takt")

    async def wecker_pruefung(self, jetzt: float | None = None) -> list[str]:
        """Alle fälligen Wecker starten. Gibt die Kennungen zurück."""
        stand = time.localtime(jetzt) if jetzt is not None else time.localtime()
        minute = stand.tm_hour * 60 + stand.tm_min
        gelaufen: list[str] = []
        for eintrag in self.wecker():
            kennung = str(eintrag.get("id") or "")
            if not faellig(eintrag, minute, stand.tm_wday, self._gelaufen.get(kennung)):
                continue
            self._gelaufen[kennung] = f"{stand.tm_wday}:{minute}"
            gelaufen.append(kennung)
            try:
                await self._wecken(eintrag)
            except Exception as err:
                log.warning("Musikwecker «%s» ging nicht los: %s", eintrag.get("label"), err)
        return gelaufen

    async def _wecken(self, eintrag: dict[str, Any]) -> None:
        box = str(eintrag.get("device") or "")
        await self.abspielen(eintrag, box)
        ziel = self.hub.registry.get(str(eintrag.get("player") or ""))
        # Eingeblendet wird auf der Box, nicht auf dem Player: Der Player
        # ist eine Fernbedienung, laut wird die Box.
        box_entity = self.hub.registry.get(box) if box else None
        if box_entity is None and box:
            box_entity = next(
                (e for e in self.hub.registry.all() if e.name == box), None
            )
        laut_auf = box_entity or ziel
        if laut_auf is not None and "set_volume" in laut_auf.commands:
            await self.hub.ton.einblenden(
                laut_auf.id,
                int(eintrag.get("volume", 35)),
                float(eintrag.get("fade", EINBLEND_STANDARD)),
            )
