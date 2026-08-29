"""Das Bild vom Moment, in dem die Kamera wirklich jemanden sieht.

Der Fall aus dem Haus: Ein Bewegungsmelder löst aus, die Nachricht kommt
mit Bild – und auf dem Bild ist niemand. Kein Fehler, sondern Physik: Der
Melder steht ein paar Schritte vor der Kamera, und wer ausgelöst hat,
braucht ein paar Sekunden bis ins Bild. Wie viele, hängt davon ab, ob
jemand schlendert oder rennt.

Ein fester Vorlauf löst das nicht – er verzögert auch die Türklingel, wo
der Besucher sofort im Bild steht, und rät beim Rest. Diese Datei nimmt
stattdessen den Zeitpunkt, den die Kamera selbst kennt: UniFi Protect
meldet nicht nur «da war Bewegung», sondern «da ist eine Person», und
dieser Zustand steht als ``detected_person`` längst in der Entität
(siehe ``integrations/unifi_protect.py``). Sie meldet ihn genau dann,
wenn jemand im Bild ist.

Der Handel, der das ohne eine einzige Sekunde Verzögerung möglich macht:
Die Nachricht trägt gar kein Bild, sondern eine **Adresse**, die das
Telefon selbst abruft (siehe ``core/push.py``). Der Hub muss das Bild
also nicht haben, wenn er sendet – nur die Adresse. Also:

  1. Adresse vergeben, Nachricht sofort raus.
  2. Im Hintergrund sofort ein Rückfallbild holen, damit nie gar keines da ist.
  3. Warten, bis die Kamera eine Person meldet – dann noch eines holen.
  4. Ruft das Telefon die Adresse ab, bevor das feststeht, wartet die
     Auslieferung kurz mit (siehe ``core/snapshots.py``).

Der Ton kommt damit so schnell wie zuvor, nur das Bild ist ein paar
Sekunden reifer.

Kann eine Kamera keine Personen erkennen, oder sieht sie gerade schon
eine, bleibt alles beim Alten: ein Bild, sofort.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from . import snapshots
from .entity import Entity

log = logging.getLogger(__name__)

#: Das Feld, unter dem eine Kamera «ich sehe eine Person» meldet.
PERSON_FELD = "detected_person"

#: So lange wird höchstens auf eine Person gewartet. Grosszügig genug für
#: den Weg von der Einfahrt zur Haustür, knapp genug, dass die Geduld der
#: Auslieferung (``snapshots.GEDULD``) darüber liegt – sonst gäbe das
#: Telefon vor dem Hub auf.
FENSTER = 10.0

#: Die laufenden Nachreichungen. Nur, um eine Referenz zu halten:
#: ``create_task`` allein genügt nicht - die Ereignisschleife hält eine
#: Aufgabe nur schwach fest, und der Sammler darf sie mittendrin abräumen.
#: Genau das wäre hier ein Bild, das nie ankommt, und niemand sähe warum.
_laufende: set[asyncio.Task[None]] = set()


def kann_person(entity: Entity | None) -> bool:
    """Meldet diese Kamera Personen? (rein, testbar)

    Gefragt wird der Zustand, nicht ein Modellname: Protect schreibt beim
    Einlesen für jede Erkennung, die eine Kamera beherrscht, ein Feld auf
    ``off`` (``camera_state``). Steht das Feld da, kann sie es – und was
    sie kann, weiss sie besser als eine Liste hier.
    """
    return entity is not None and PERSON_FELD in entity.state


def sieht_person(entity: Entity | None) -> bool:
    """Sieht sie gerade eine? (rein, testbar)"""
    return entity is not None and str(entity.state.get(PERSON_FELD) or "") == "on"


def lohnt_warten(entity: Entity | None) -> bool:
    """Ist es sinnvoll, auf eine Personenmeldung zu warten? (rein, testbar)

    Zwei Fälle sagen nein, und beide aus demselben Grund – es gibt nichts
    zu gewinnen: Eine Kamera ohne Personenerkennung wird nie melden, und
    eine, die gerade schon jemanden sieht, hat den Moment jetzt. Bei der
    Türklingel ist das der Normalfall.
    """
    return kann_person(entity) and not sieht_person(entity)


def ist_personenmeldung(old_state: dict[str, Any], new_state: dict[str, Any]) -> bool:
    """Ist gerade eine Person aufgetaucht? (rein, testbar)

    Die Flanke, nicht der Pegel. Protect setzt das Feld beim Ende des
    Ereignisses wieder auf ``off``; ohne die Flanke würde jede
    Zustandsmeldung während einer laufenden Erkennung erneut zählen,
    und das Bild käme vom letzten Zappeln statt vom Auftauchen.
    """
    return (
        str(new_state.get(PERSON_FELD) or "") == "on"
        and str(old_state.get(PERSON_FELD) or "") != "on"
    )


def fenster(push_config: Any) -> float:
    """Wie lange auf eine Person gewartet werden darf (rein, testbar).

    Aus ``push.person_fenster`` in der config.yaml, sonst ``FENSTER``.
    ``0`` schaltet das Nachreichen ganz ab – dann verhält sich der Hub
    wie vorher. Unsinn im Konfigurationsfile (Text, negative Zahlen)
    fällt auf die Voreinstellung zurück statt den Hub zu stoppen.
    """
    wert = (push_config or {}).get("person_fenster") if push_config else None
    if wert is None:
        return FENSTER
    try:
        zahl = float(wert)
    except (TypeError, ValueError):
        return FENSTER
    return zahl if zahl >= 0 else FENSTER


class Personenwache:
    """Horcht ab sofort, ob eine bestimmte Kamera eine Person meldet.

    Bewusst eine Klasse und kein ``await``-Aufruf: Angemeldet wird im
    Konstruktor, also *bevor* der Aufrufer das Rückfallbild holt. Als
    Coroutine gäbe es zwischen «Auftrag erteilt» und «hört zu» einen
    Durchlauf der Ereignisschleife – und genau darin könnte die Meldung
    liegen, auf die gewartet wird.
    """

    def __init__(self, bus: Any, camera_id: str, dauer: float) -> None:
        self._camera = camera_id
        self._treffer = asyncio.Event()
        self._ende = asyncio.get_running_loop().time() + dauer
        self._abmelden = bus.subscribe("state_changed", self._auf_aenderung)

    def _auf_aenderung(self, _typ: str, daten: dict[str, Any]) -> None:
        if daten.get("entity_id") != self._camera:
            return
        if ist_personenmeldung(
            daten.get("old_state") or {}, daten.get("new_state") or {}
        ):
            self._treffer.set()

    async def warten(self) -> bool:
        """``True``, wenn die Kamera innerhalb des Fensters jemanden meldete.

        Die Frist läuft ab dem Anmelden, nicht ab hier: Was der Aufrufer
        zwischendurch getan hat – etwa auf ein Rückfallbild gewartet –
        gehört zum Fenster dazu, sonst dehnt es sich um genau die Zeit,
        die eine langsame Kamera braucht.
        """
        rest = self._ende - asyncio.get_running_loop().time()
        if rest <= 0:
            return self._treffer.is_set()
        try:
            await asyncio.wait_for(self._treffer.wait(), rest)
        except TimeoutError:
            return False
        return True

    def schliessen(self) -> None:
        self._abmelden()

    def __enter__(self) -> Personenwache:
        return self

    def __exit__(self, *_ausnahme: Any) -> None:
        self.schliessen()


async def _bild(integration: Any, entity: Entity, wartezeit: float, wofuer: str) -> bytes | None:
    """Ein Standbild holen. Jeder Fehlschlag endet still in ``None``.

    Eine Nachricht darf nicht daran scheitern, dass eine Kamera gerade
    schweigt – sie geht dann eben ohne Bild raus.
    """
    try:
        return await asyncio.wait_for(integration.snapshot(entity), wartezeit)
    except TimeoutError:
        # Der Fall, der die Klingel langsam machte: `snapshot()` holt kein
        # fertiges Bild ab, sondern stösst eines an. Bei Ring weckt das die
        # Kamera und fragt in Runden nach.
        log.info(
            "Bild für %s kam nicht in %ss – Nachricht geht ohne raus",
            wofuer,
            wartezeit,
        )
        return None
    except Exception as err:
        log.warning("Kein Bild für %s: %s", wofuer, err)
        return None


async def bild_adresse(
    hub: Any, camera: str | None, wartezeit: float, wofuer: str
) -> str | None:
    """Die Bildadresse für eine Push-Nachricht – oder ``None``.

    Der gemeinsame Weg für Abläufe und Alarmanlage. Er stand zweimal fast
    gleich da, und die Personenerkennung hätte er zweimal fast gleich
    bekommen.

    Ohne ``push.public_url`` in der config.yaml entsteht gar keine
    Adresse; warum, steht in ``core/snapshots.py``.
    """
    public_url = (hub.config.push or {}).get("public_url")
    if not camera or not public_url:
        return None
    entity = hub.registry.get(camera)
    integration = hub.integrations.get(entity.integration) if entity else None
    if entity is None or integration is None:
        return None

    dauer = fenster(hub.config.push)
    if dauer > 0 and lohnt_warten(entity):
        # Adresse jetzt, Bild gleich: Das Nachreichen läuft nebenher, die
        # Nachricht wartet keine Millisekunde darauf.
        token = hub.snapshots.reserve()
        # Die Wache meldet sich hier an und nicht erst in der Aufgabe:
        # dazwischen liegt ein Durchlauf der Ereignisschleife, und darin
        # könnte genau die Meldung stecken, auf die gewartet wird.
        wache = Personenwache(hub.bus, entity.id, dauer)
        aufgabe = asyncio.get_running_loop().create_task(
            _nachreichen(hub, entity, integration, token, wache, wartezeit, wofuer)
        )
        _laufende.add(aufgabe)
        aufgabe.add_done_callback(_laufende.discard)
        return snapshots.image_url(public_url, token)

    bild = await _bild(integration, entity, wartezeit, wofuer)
    if not bild:
        return None
    return snapshots.image_url(public_url, hub.snapshots.put(bild))


async def _nachreichen(
    hub: Any,
    entity: Entity,
    integration: Any,
    token: str,
    wache: Personenwache,
    wartezeit: float,
    wofuer: str,
) -> None:
    """Das Bild zur bereits verschickten Adresse besorgen.

    Erst ein Rückfallbild, damit nie gar keines dasteht – dann warten und,
    wenn jemand auftaucht, ein zweites. Das zweite gewinnt.

    Das ``finally`` ist der wichtige Teil: Egal was hier schiefgeht, der
    Platz wird gefüllt. Sonst hinge die Auslieferung an das Telefon bis
    zur vollen Frist auf ein Bild, das nie kommt.
    """
    bild: bytes | None = None
    try:
        with wache:
            bild = await _bild(integration, entity, wartezeit, wofuer)
            if await wache.warten():
                # Jetzt steht jemand im Bild. Genau dafür der ganze Aufwand.
                bild = await _bild(integration, entity, wartezeit, wofuer) or bild
            else:
                log.debug(
                    "Keine Personenmeldung von %s – Bild vom Auslöser bleibt",
                    entity.id,
                )
    except Exception as err:
        log.warning("Nachgereichtes Bild für %s fehlgeschlagen: %s", wofuer, err)
    finally:
        hub.snapshots.fuellen(token, bild)
