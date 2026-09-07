"""Der Anrufbeantworter des Hauses (Punkt 259 der Werkbank).

Eine Sprachnotiz «fürs nächste Heimkommen»: Wer geht, spricht sie ins
Durchsage-Blatt («Lasagne im Ofen, bin um sechs zurück») - und wer als
Nächstes ankommt, hört sie auf der gewählten Box. Danach ist sie
verbraucht: Ein Anrufbeantworter wiederholt sich nicht von allein.

Drei Regeln, alle aus dem Alltag:

* **Es gibt genau eine Nachricht.** Ein Band, keine Warteschlange - wer
  eine zweite hinterlegt, überspielt die erste. Eine Liste hiesse, dass
  der Ankommende drei alte Zurufe nacheinander hört, und spätestens der
  zweite ist keiner mehr.
* **Der Hinterleger verbraucht sie nicht selbst.** Wer die Nachricht
  gesprochen hat, weiss, was drin ist - kommt er selbst zuerst heim,
  bleibt sie liegen und wartet auf den nächsten *anderen* Ankömmling.
* **Sie verfällt.** Eine Nachricht, die zwei Tage liegt, ist kalt
  geworden: «Lasagne im Ofen» stimmt dann nicht mehr, und wer sie am
  Donnerstag hört, erschrickt eher, als dass er sich freut. 48 Stunden
  decken ein Wochenende ab, an dem niemand heimkommt, und sind kurz
  genug, dass nie eine Nachricht aus einer anderen Woche spielt.

Der Ton selbst liegt nicht im Datenbestand, sondern als Datei daneben
(wie der Durchsage-Vorrat in say.py): Eine Minute Opus sind bis zu zwei
Megabyte, und die gehören nicht in eine JSON-Datei, die bei jedem
Schreiben ganz auf die Platte geht und in die Sicherung wandert.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import nachtruhe, say
from .errors import HomePilotError

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

#: Schlüssel im Datenbestand - eine Liste mit höchstens einem Eintrag,
#: wie house_prefs (der DataStore speichert Listen).
KEY = "heimgruss"

#: Nach so vielen Stunden gilt die Nachricht als kalt (siehe Kopf).
VERFALL_STUNDEN = 48

#: Der Ton neben der Datendatei. Eine feste Endung ohne Format-Behauptung:
#: Was drinsteckt (WebM, MP4, …), sagt der gespeicherte Medientyp.
AUDIO_NAME = "heimgruss.ton"

# Die Antworten von `entscheidung` - als Konstanten, damit Tippfehler im
# Aufrufer nicht still zu «nie abspielen» werden.
KEINE = "keine"
ABGELAUFEN = "abgelaufen"
EIGENE = "eigene"
NACHTRUHE = "nachtruhe"
SPIELEN = "spielen"


def neuer_eintrag(
    wer: str,
    zone: str,
    speakers: list[str],
    volume: int | None,
    typ: str,
    now: float,
) -> dict[str, Any]:
    """Was zu einer hinterlegten Nachricht gespeichert wird (rein, testbar).

    `zone` ist die Geofence-Kennung des Hinterlegers - gespeichert wird
    sie hier und nicht erst beim Abspielen verglichen, weil der Kern
    nicht von der Geofence-Integration importieren darf: Die Route kennt
    beide Seiten und rechnet sie einmal aus.
    """
    return {
        "wer": str(wer or ""),
        "zone": str(zone or ""),
        "speakers": [str(s) for s in speakers or []],
        "volume": volume,
        "typ": str(typ or ""),
        "at": float(now),
    }


def ablegen(rows: Any, eintrag: dict[str, Any]) -> list[dict[str, Any]]:
    """Die Nachricht aufs Band legen (rein, testbar).

    Ersetzt, was liegt: ein Band, eine Nachricht (siehe Kopf). `rows`
    wird nur der Signatur wegen angenommen - wer ablegt, überspielt.
    """
    del rows
    return [eintrag]


def offen(rows: Any, now: float) -> dict[str, Any] | None:
    """Die liegende, noch nicht verfallene Nachricht - oder None.

    (rein, testbar)
    """
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            at = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        if at and (now - at) <= VERFALL_STUNDEN * 3600:
            return row
    return None


def oeffentlich(eintrag: dict[str, Any]) -> dict[str, Any]:
    """Was die App über die liegende Nachricht erfährt (rein, testbar).

    Ohne den Ton und ohne die Zonenkennung - die App braucht den Namen
    («Nachricht von Stefan»), den Zeitpunkt und wann sie verfällt.
    """
    at = float(eintrag.get("at") or 0)
    return {
        "by": str(eintrag.get("wer") or ""),
        "at": at,
        "until": at + VERFALL_STUNDEN * 3600,
        "speakers": [str(s) for s in eintrag.get("speakers") or []],
    }


def entscheidung(rows: Any, ankunft_zone: str, now: float, still: bool) -> str:
    """Was mit der Nachricht passiert, wenn diese Person ankommt.

    (rein, testbar)

    * ``eigene``: Der Hinterleger selbst - er weiss, was drin ist, und
      verbraucht sie nicht. Ohne Zonenkennung (die Route konnte keine
      ausrechnen) spielt sie für jeden: lieber einmal die eigene Stimme
      hören als eine Nachricht, die nie abläuft, weil niemand «anders
      genug» ist.
    * ``nachtruhe``: Gerade still - nicht abspielen und **nicht
      verbrauchen**. Wer um halb zwölf heimkommt, soll das Haus nicht
      wecken; die Nachricht wartet auf die nächste Ankunft bei Tag und
      verfällt sonst von selbst.
    """
    eintrag = offen(rows, now)
    if eintrag is None:
        return ABGELAUFEN if rows else KEINE
    if eintrag.get("zone") and str(eintrag["zone"]) == str(ankunft_zone):
        return EIGENE
    if still:
        return NACHTRUHE
    return SPIELEN


# ── Der Ton auf der Platte ───────────────────────────────────────────────


def audio_datei(hub: Hub) -> Path | None:
    """Wo der Ton liegt: neben der Datendatei, wie der Durchsage-Vorrat.

    Ohne Datendatei (Tests, Demo im Speicher) auch keine Datei - dann
    hält `audio_ablegen` den Ton im Arbeitsspeicher des Hubs.
    """
    if not hub.config.data_file:
        return None
    return Path(hub.config.data_file).parent / AUDIO_NAME


def audio_ablegen(hub: Hub, audio: bytes) -> None:
    """Den Ton festhalten - auf der Platte, wo es eine gibt.

    Zusätzlich immer im Speicher: Das Abspielen kommt dann ohne Platte
    aus, und die Datei ist nur das Gedächtnis über den Neustart.
    """
    hub.heimgruss_audio = audio
    pfad = audio_datei(hub)
    if pfad is None:
        return
    try:
        pfad.write_bytes(audio)
    except OSError as err:
        # Kein Fehler nach aussen: Die Nachricht spielt trotzdem - sie
        # überlebt nur keinen Neustart, und das ist die kleinere Panne.
        log.warning("Heimgruss: Ton nicht auf die Platte gekommen: %s", err)


def audio_lesen(hub: Hub) -> bytes | None:
    """Den Ton zurückholen - aus dem Speicher, sonst von der Platte."""
    ton = getattr(hub, "heimgruss_audio", None)
    if ton:
        return ton
    pfad = audio_datei(hub)
    if pfad is None:
        return None
    try:
        return pfad.read_bytes()
    except OSError:
        return None


def entfernen(hub: Hub) -> None:
    """Band löschen: Eintrag und Ton - für «verbraucht» und «zurückgezogen»."""
    hub.data.set(KEY, [])
    hub.heimgruss_audio = None
    pfad = audio_datei(hub)
    if pfad is not None:
        try:
            pfad.unlink(missing_ok=True)
        except OSError:
            pass


# ── Das Abspielen beim Ankommen ──────────────────────────────────────────


async def bei_ankunft(hub: Hub, zone_id: str, name: str) -> None:
    """Jemand ist zuhause angekommen - liegt etwas auf dem Band?

    Gerufen von der Geofence-Integration an derselben Stelle wie die
    «ist angekommen»-Nachricht (geofence._sagen) - dort ist die
    Neustart-Welle unknown→home schon ausgesiebt, sonst spielte die
    Nachricht nach jedem Update für jemanden, der längst dasitzt.

    Fehler bleiben hier: Eine Box, die nicht antwortet, darf die Ortung
    nicht anhalten - der Zustand der Person ist längst geschrieben.
    """
    jetzt = time.time()
    rows = hub.data.get(KEY)
    lage = entscheidung(rows, zone_id, jetzt, nachtruhe.still(jetzt))
    if lage == ABGELAUFEN:
        # Kalt geworden: still wegräumen, damit der Ton nicht als Leiche
        # neben der Datendatei liegen bleibt.
        entfernen(hub)
        return
    if lage != SPIELEN:
        return
    eintrag = offen(rows, jetzt) or {}
    audio = audio_lesen(hub)
    if audio is None:
        # Der Eintrag hat den Ton überlebt (Datendatei umgezogen, Platte
        # geputzt). Wegräumen - ein Band ohne Ton spielt auch morgen nicht.
        log.warning("Heimgruss: Eintrag ohne Ton - weggeräumt")
        entfernen(hub)
        return
    address = say.base_url(hub)
    if not address:
        # Ohne Hub-Adresse erreicht keine Box den Ton. Liegen lassen:
        # Die nächste App-Anfrage bringt die Adresse, die nächste Ankunft
        # den zweiten Versuch.
        log.warning("Heimgruss: Hub-Adresse unbekannt - Nachricht bleibt liegen")
        return
    try:
        ergebnis = await say.play_audio(
            hub,
            audio,
            address,
            speakers=[str(s) for s in eintrag.get("speakers") or []] or None,
            volume=eintrag.get("volume"),
        )
    except HomePilotError as err:
        # Nicht verbraucht: Was nicht gespielt hat, ist nicht gehört -
        # die nächste Ankunft versucht es wieder.
        log.warning("Heimgruss: nicht abgespielt (%s)", err)
        return
    if not ergebnis.get("sent"):
        log.warning("Heimgruss: keine Box erreicht - Nachricht bleibt liegen")
        return
    entfernen(hub)
    log.info(
        "Heimgruss: Nachricht von %s abgespielt (%s ist angekommen)",
        eintrag.get("wer"),
        name,
    )
    # Der Hinterleger soll wissen, dass sie durch ist - sonst fragt er
    # sich den ganzen Abend, ob jemand die Lasagne gefunden hat. Über die
    # bestehende Kategorie «presence»: Es ist eine Nachricht übers
    # Ankommen, und ihr Ziel (Familie und Freunde) passt (core/pushziel.py).
    try:
        tokens = hub.push.recipients(
            hub.users.users, to=str(eintrag.get("wer") or ""), category="presence"
        )
        if tokens:
            await hub.push.send(
                tokens,
                "Nachricht abgespielt",
                f"Deine Nachricht wurde abgespielt - {name} ist angekommen.",
                category="presence",
            )
    except Exception as err:
        log.debug("Heimgruss: Hinterleger nicht benachrichtigt (%s)", err)
