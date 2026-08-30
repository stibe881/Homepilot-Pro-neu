"""Die Haustür-Live-Aktivität: erscheint, wenn man das Haus verlässt.

Auf dem Sperrbildschirm des iPhones steht dann eine kleine Karte
«unterwegs - Haustüre», und ein Tipp darauf führt in die App direkt zur
Türe (samt der gewohnten Rückfrage). Kein Suchen nach der App, kein
Widget-Platz - die Karte ist da, solange man weg ist, und verschwindet
beim Heimkommen.

Warum das über Apple laufen muss und nicht über Expo wie der übrige
Push: Eine Live-Aktivität kann nur die App selbst starten - und nur im
Vordergrund - oder ein besonderer APNs-Push («push-to-start», ab
iOS 17.2). Im Moment des Weggehens ist die App aber gerade *nicht*
offen; also bleibt nur der Push, und den nimmt Apple ausschliesslich
direkt entgegen, mit eigenem Schlüssel (.p8 aus dem Entwicklerkonto)
und über HTTP/2. Deshalb der eigene kleine Versand hier statt einer
Zeile an Expo.

Der Ablauf:

  - Die App holt sich beim Start das «push-to-start»-Token des Telefons
    und meldet es hier an (/api/liveactivity/register) - je Benutzer.
  - Ein Takt schaut auf die Anwesenheit: Geht ein angemeldeter Benutzer
    weg (seine Zone steht nicht mehr auf «home»), schickt der Hub den
    Start-Push an dessen Telefone. Kommt er heim, beendet ein zweiter
    Push die Aktivität.
  - Zum Beenden braucht es das Token der *laufenden* Aktivität; das
    meldet die App nach, sobald die Aktivität steht
    (/api/liveactivity/activity).

Ohne `apns:`-Block in der config.yaml oder ohne die Bibliotheken
(Extra `apns` im pyproject) bleibt alles still - der Hub läuft normal.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import Any

from . import presence

log = logging.getLogger(__name__)

#: Wie oft der Takt auf die Anwesenheit schaut. Grob genug, um nichts zu
#: kosten; die Ortsmeldung selbst braucht ohnehin länger als das.
TAKT_SEKUNDEN = 30.0

#: Muss wortgleich zum Namen der ActivityAttributes-Struktur in der App
#: sein (targets/widget/index.swift und modules/live-aktivitaet) - Apple
#: ordnet den Start-Push allein über diesen Namen zu.
ATTRIBUTES_TYPE = "TuerAktivitaetAttributes"

#: Nach so vielen Stunden gilt die Karte als abgestanden. iOS beendet
#: Live-Aktivitäten ohnehin nach spätestens zwölf Stunden - wer länger
#: weg ist, bekommt beim nächsten «weg»-Wechsel eine frische.
STALE_STUNDEN = 8

DATA_KEY = "live_activities"


# ── Konfiguration ──────────────────────────────────────────────────────────


def parse_apns(raw: Any) -> dict[str, str] | None:
    """Den apns-Block prüfen (rein, testbar).

    Alles oder nichts: Ein halber Block (Schlüssel ohne team_id) sähe
    beim Start gesund aus und fiele erst beim ersten Versand um - dann
    lieber gleich None und eine Zeile im Protokoll.
    """
    if not isinstance(raw, dict) or not raw:
        return None
    felder = {}
    for name in ("key_file", "key_id", "team_id", "bundle_id"):
        wert = str(raw.get(name) or "").strip()
        if not wert:
            return None
        felder[name] = wert
    felder["sandbox"] = "1" if raw.get("sandbox") else ""
    return felder


# ── Registrierung (rein, testbar) ─────────────────────────────────────────


def registrieren(rows: Any, user: str, token: str, label: str = "") -> list[dict[str, Any]]:
    """Ein «push-to-start»-Token eines Telefons ablegen.

    Nach Token abgelegt: Meldet sich dasselbe Telefon erneut (App-Start),
    wird der Eintrag ersetzt statt verdoppelt - wie bei den Push-Geräten.
    """
    neue = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("start_token") != token
    ]
    neue.append(
        {
            "user": user,
            "start_token": token,
            "label": label,
            "activity_token": None,
            # Ob für dieses Telefon gerade eine Aktivität laufen müsste.
            "unterwegs": False,
        }
    )
    return neue


def abmelden(rows: Any, token: str) -> list[dict[str, Any]]:
    """Ein Telefon austragen (rein, testbar)."""
    return [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("start_token") != token
    ]


def aktivitaet_merken(rows: Any, user: str, token: str) -> list[dict[str, Any]]:
    """Das Token der laufenden Aktivität nachtragen (rein, testbar).

    Es gehört zu genau einer Aktivität, aber die App weiss nicht, aus
    welchem Start-Token sie entstand. Darum bekommt es jede laufende
    Zeile des Benutzers, die noch keines hat - im Haushalt hat eine
    Person selten mehr als ein Telefon, und ein doppelt beendetes
    Beenden ist harmlos.
    """
    neue = []
    for row in rows or []:
        if (
            isinstance(row, dict)
            and row.get("user") == user
            and row.get("unterwegs")
            and not row.get("activity_token")
        ):
            row = {**row, "activity_token": token}
        neue.append(row)
    return neue


# Näher als so viele Meter gilt als «im Anmarsch» - derselbe Umkreis wie
# die Quartier-Zone des Geofence: weit genug für den Vorlauf, eng genug,
# dass die Karte nicht den ganzen Arbeitstag auf dem Sperrbildschirm
# liegt.
NAHE_METER = 3000.0


def karte_faellig(zustand: str, entfernung: Any) -> bool | None:
    """Soll die Haustür-Karte gerade laufen? (rein, testbar)

    None heisst unbekannt - daraus startet keine Karte, und eine
    laufende verschwindet deswegen auch nicht.

    Die Karte lief bisher, sobald jemand nicht zuhause war - und lag
    damit den ganzen Arbeitstag auf dem Sperrbildschirm, obwohl ein
    Türöffner ohne Face ID nur in einem Moment nützt: den letzten
    Metern vor der Türe. Jetzt läuft sie nur im Anmarsch: nicht
    zuhause, aber näher als NAHE_METER. Ohne Entfernung (eine
    Flankenmeldung ohne Koordinaten) entscheidet die Zone - «quartier»
    ist genau dieser Umkreis.
    """
    if zustand in ("", presence.UNKNOWN):
        return None
    if zustand == presence.HOME:
        return False
    if isinstance(entfernung, (int, float)) and not isinstance(entfernung, bool):
        return float(entfernung) <= NAHE_METER
    return zustand == "quartier"


def wechsel(
    rows: Any, weg: dict[str, bool]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Wer bekommt einen Start-, wer einen Ende-Push? (rein, testbar)

    `weg` sagt je Benutzer, ob er gerade ausdrücklich nicht zuhause ist.
    Wer darin nicht vorkommt (keine Zone, Zustand unbekannt), bleibt wie
    er ist - aus Nichtwissen startet keine Karte, und eine laufende
    verschwindet deswegen auch nicht.

    Zurück kommen die neue Liste, die Zeilen für den Start-Push und die
    Zeilen für den Ende-Push.
    """
    neue: list[dict[str, Any]] = []
    starten: list[dict[str, Any]] = []
    beenden: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        user = str(row.get("user") or "")
        if user not in weg:
            neue.append(row)
            continue
        if weg[user] and not row.get("unterwegs"):
            row = {**row, "unterwegs": True, "activity_token": None}
            starten.append(row)
        elif not weg[user] and row.get("unterwegs"):
            beenden.append(row)
            row = {**row, "unterwegs": False, "activity_token": None}
        neue.append(row)
    return neue, starten, beenden


def abbestellte(prefs_rows: Any) -> dict[str, set[str]]:
    """Wer welche Kartenarten abbestellt hat (rein, testbar).

    Feinregelung unter dem grossen Schalter, nach dem Modell der
    Benachrichtigungen: In den persönlichen Einstellungen liegt eine
    Liste `liveAus` mit Kartenarten («timer», «grill», «tuer», …), die
    diese Person nicht will. Bewusst als «abbestellen» statt
    «bestellen» - eine neue Kartenart kommt damit erst einmal an,
    statt unbemerkt zu fehlen.
    """
    ergebnis: dict[str, set[str]] = {}
    for row in prefs_rows or []:
        if not isinstance(row, dict):
            continue
        prefs = row.get("prefs")
        if not isinstance(prefs, dict) or not isinstance(prefs.get("liveAus"), list):
            continue
        name = str(row.get("user") or "")
        if name:
            ergebnis[name] = {str(art) for art in prefs["liveAus"]}
    return ergebnis


def abgeschaltet(prefs_rows: Any) -> set[str]:
    """Wer die Live-Aktivität in seinem Profil abgeschaltet hat (rein, testbar).

    Der Schalter liegt in den persönlichen Einstellungen der App
    (user_prefs, Schlüssel `liveTuer`) - je Person, wie die
    Benachrichtigungen. Fehlt der Schlüssel, gilt an: Wer die Funktion
    eingerichtet hat, will sie, und Abschalten ist die Ausnahme.
    """
    aus = set()
    for row in prefs_rows or []:
        if not isinstance(row, dict):
            continue
        prefs = row.get("prefs")
        if isinstance(prefs, dict) and prefs.get("liveTuer") is False:
            name = str(row.get("user") or "")
            if name:
                aus.add(name)
    return aus


# ── Push-Inhalte (rein, testbar) ──────────────────────────────────────────


def start_payload(jetzt_s: float, tuer: str = "Haustüre") -> dict[str, Any]:
    """Der APNs-Inhalt, der die Aktivität startet."""
    return {
        "aps": {
            "timestamp": int(jetzt_s),
            "event": "start",
            "content-state": {"text": ""},
            "attributes-type": ATTRIBUTES_TYPE,
            "attributes": {"tuer": tuer},
            # Das alert ist beim Start-Ereignis PFLICHT: Ohne es nimmt
            # Apple den Push zwar an (200), aber iOS verwirft ihn still
            # und stellt nie eine Karte auf - wochenlang «angenommen» im
            # Log, und auf keinem Sperrbildschirm lag je etwas. Sichtbar
            # wird der Text kaum (die Karte selbst ist die Anzeige, und
            # auf der Watch eine Zeile), aber fehlen darf er nicht.
            "alert": {
                "title": tuer,
                "body": "Zum Öffnen bereit - die Karte liegt auf dem Sperrbildschirm.",
            },
            "stale-date": int(jetzt_s + STALE_STUNDEN * 3600),
            "relevance-score": 75,
        }
    }


def end_payload(jetzt_s: float) -> dict[str, Any]:
    """Der APNs-Inhalt, der die Aktivität sofort wegräumt."""
    return {
        "aps": {
            "timestamp": int(jetzt_s),
            "event": "end",
            "content-state": {"text": ""},
            # Sofort weg statt der üblichen Gnadenfrist: Wer heimkommt,
            # braucht die Karte keine vier Stunden mehr im Rückblick.
            "dismissal-date": int(jetzt_s),
        }
    }


def apns_jwt(key_pem: bytes, key_id: str, team_id: str, jetzt_s: float) -> str:
    """Das Anmelde-Token für Apple bauen (rein, testbar).

    ES256 über Header und Claims - bewusst von Hand statt einer
    JWT-Bibliothek: Es sind zwölf Zeilen, und die Abhängigkeit bliebe
    sonst nur für genau diesen einen Aufruf im Abbild.
    """
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import (
        decode_dss_signature,
    )

    def b64(raw: bytes) -> bytes:
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    kopf = b64(json.dumps({"alg": "ES256", "kid": key_id}).encode())
    inhalt = b64(json.dumps({"iss": team_id, "iat": int(jetzt_s)}).encode())
    zu_signieren = kopf + b"." + inhalt
    key = serialization.load_pem_private_key(key_pem, password=None)
    der = key.sign(zu_signieren, ec.ECDSA(hashes.SHA256()))  # type: ignore[union-attr, call-arg, arg-type]
    # Apple erwartet die rohe r||s-Form, nicht das DER-Gerüst.
    r, s = decode_dss_signature(der)
    signatur = b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return (zu_signieren + b"." + signatur).decode()


# ── Der Versand ────────────────────────────────────────────────────────────


class ApnsVersand:
    """Der direkte Draht zu Apple - klein, faul und leise.

    Faul: Verbindung und Anmelde-Token entstehen erst beim ersten
    Versand. Leise: Ein Fehler landet im Protokoll, nicht im Takt - die
    Anwesenheit soll nicht an einem Zertifikat hängen.
    """

    def __init__(self, config: dict[str, str]) -> None:
        self.config = config
        self._client: Any = None
        self._jwt: str | None = None
        self._jwt_alter = 0.0

    def _token(self, jetzt_s: float) -> str:
        # Apple akzeptiert ein Token 20 bis 60 Minuten; nach 40 ein
        # frisches, dann liegt man nie am Rand.
        if self._jwt is None or jetzt_s - self._jwt_alter > 2400:
            with open(self.config["key_file"], "rb") as datei:
                pem = datei.read()
            self._jwt = apns_jwt(
                pem, self.config["key_id"], self.config["team_id"], jetzt_s
            )
            self._jwt_alter = jetzt_s
        return self._jwt

    async def senden(self, geraete_token: str, payload: dict[str, Any]) -> bool:
        try:
            import httpx
        except ImportError:
            log.warning(
                "Live-Aktivität: httpx[h2] fehlt - Extra 'apns' installieren"
            )
            return False
        jetzt = time.time()
        host = (
            "https://api.sandbox.push.apple.com"
            if self.config.get("sandbox")
            else "https://api.push.apple.com"
        )
        if self._client is None:
            self._client = httpx.AsyncClient(http2=True, timeout=10.0)
        try:
            antwort = await self._client.post(
                f"{host}/3/device/{geraete_token}",
                content=json.dumps(payload),
                headers={
                    "authorization": f"bearer {self._token(jetzt)}",
                    "apns-topic": f"{self.config['bundle_id']}.push-type.liveactivity",
                    "apns-push-type": "liveactivity",
                    "apns-priority": "10",
                    "apns-expiration": str(int(jetzt + 600)),
                },
            )
        except Exception as err:
            log.warning("Live-Aktivität: Apple nicht erreichbar (%s)", err)
            return False
        if antwort.status_code == 200:
            return True
        # Der Grund steht bei Apple im Body («BadDeviceToken», «ExpiredToken»).
        log.warning(
            "Live-Aktivität: Apple lehnt ab (%s): %s",
            antwort.status_code,
            antwort.text[:200],
        )
        return False


# ── Der Takt ───────────────────────────────────────────────────────────────


def _weg_stand(hub: Any, benutzer: set[str]) -> dict[str, bool]:
    """Je Benutzer: soll seine Haustür-Karte gerade laufen?

    «Unbekannt» fehlt bewusst im Ergebnis: Aus Nichtwissen soll weder
    eine Karte entstehen noch eine verschwinden. Ob sie fällig ist,
    entscheidet karte_faellig - nah, aber nicht zuhause.
    """
    geofence = hub.integrations.get("geofence") if hub.integrations else None
    zones = getattr(geofence, "_zones", None) or {}
    namen = {
        zone_id: getattr(hub.registry.get(entity_id), "label", zone_id)
        for zone_id, entity_id in zones.items()
    }
    stand: dict[str, bool] = {}
    for name in benutzer:
        zone_id = presence.zone_fuer(name, namen)
        if zone_id is None:
            continue
        entity = hub.registry.get(zones[zone_id])
        zustand_roh = (entity.state if entity else {})
        zustand = str(zustand_roh.get("state") or presence.UNKNOWN)
        faellig = karte_faellig(zustand, zustand_roh.get("distance"))
        if faellig is None:
            continue
        stand[name] = faellig
    return stand


async def tuer_loop(hub: Any) -> None:
    """Alle TAKT_SEKUNDEN: Karten starten und beenden, wo nötig."""
    config = parse_apns(getattr(hub.config, "apns", None))
    if config is None:
        # Einmal sagen und schweigen: Ohne apns-Block ist das kein
        # Fehler, sondern schlicht nicht eingerichtet.
        log.info("Live-Aktivität: kein apns-Block in der config.yaml - aus")
        return
    versand = ApnsVersand(config)
    while True:
        await asyncio.sleep(TAKT_SEKUNDEN)
        try:
            await _runde(hub, versand)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Live-Aktivität: Runde fehlgeschlagen")


async def _runde(hub: Any, versand: ApnsVersand) -> None:
    rows = hub.data.get(DATA_KEY)
    if not rows:
        return
    benutzer = {str(row.get("user") or "") for row in rows if isinstance(row, dict)}
    weg = _weg_stand(hub, benutzer)
    # Wer den Schalter im Profil ausgestellt hat - ganz oder nur für die
    # Haustür-Karte -, gilt hier als zuhause: Es startet nichts Neues,
    # und eine gerade laufende Karte wird im selben Zug beendet. Der
    # Schalter wirkt sofort, nicht erst beim nächsten Heimkommen.
    prefs_rows = hub.data.get("user_prefs")
    aus = abgeschaltet(prefs_rows)
    einzeln = abbestellte(prefs_rows)
    for name in benutzer:
        if name in aus or "tuer" in einzeln.get(name, set()):
            weg[name] = False
    neue, starten, beenden = wechsel(rows, weg)
    if not starten and not beenden:
        return
    jetzt = time.time()
    for row in starten:
        ging = await versand.senden(str(row["start_token"]), start_payload(jetzt))
        log.info(
            "Live-Aktivität: Start an %s (%s) - %s",
            row.get("user"),
            row.get("label") or "Telefon",
            "angenommen" if ging else "fehlgeschlagen",
        )
    for row in beenden:
        token = row.get("activity_token")
        if not token:
            # Die App hat das Aktivitäts-Token nie nachgemeldet - dann
            # räumt iOS die Karte spätestens über das stale-date weg.
            continue
        await versand.senden(str(token), end_payload(jetzt))
        log.info("Live-Aktivität: Ende an %s", row.get("user"))
    hub.data.set(DATA_KEY, neue)
