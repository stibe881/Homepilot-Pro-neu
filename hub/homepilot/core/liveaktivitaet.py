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


def token_tot(status: int, text: str) -> bool:
    """Ist dieses Token endgültig hinüber? (rein, testbar)

    Apple unterscheidet zwei Arten von Absage, und nur eine davon ist
    endgültig: Ein Token, das es nicht mehr gibt (410 «Unregistered»,
    400 «BadDeviceToken»), wird auch morgen keines mehr sein. Alles
    andere - überlastet, kaputte Verbindung, abgelaufener Schlüssel -
    ist ein Problem von jetzt und darf kein Telefon austragen.

    Wozu: Eine Zeile mit totem Token fliegt raus. Sonst versucht der Hub
    bei jedem Weggehen weiter, eine Karte auf ein Telefon zu stellen,
    das es so nicht mehr gibt - und die Zeile zählte in der App als
    angemeldetes Gerät mit.
    """
    if status == 410:
        return True
    return status == 400 and "BadDeviceToken" in text


def registrieren(rows: Any, user: str, token: str, label: str = "") -> list[dict[str, Any]]:
    """Ein «push-to-start»-Token eines Telefons ablegen.

    Abgelegt wird je **Telefon**, nicht je Token - und das ist der ganze
    Punkt. Apple stellt das «push-to-start»-Token immer wieder neu aus:
    nach einer Neuinstallation, nach einem App-Update, und von sich aus.
    Nach Token abgelegt blieb die alte Zeile stehen; jede trug ihr
    eigenes «unterwegs», und beim nächsten Weggehen bekam dasselbe
    Telefon einen Start-Push je Zeile. Auf dem Sperrbildschirm lagen
    dann fünf gleiche Karten übereinander - eine je Fassung, die man je
    installiert hatte.

    Das Telefon erkennt der Name, den die App mitschickt (`label`, der
    Gerätename). Fehlt er - eine alte App-Fassung -, bleibt es beim
    Vergleich über das Token: lieber eine Zeile zu viel als die eines
    fremden Geräts überschrieben.
    """
    name = str(label or "")

    def dasselbe_telefon(row: dict[str, Any]) -> bool:
        return bool(
            name
            and str(row.get("user") or "") == user
            and str(row.get("label") or "") == name
        )

    neue = [
        row
        for row in (rows or [])
        if isinstance(row, dict)
        and row.get("start_token") != token
        and not dasselbe_telefon(row)
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


def weit_weg(zustand: str, entfernung: Any) -> bool | None:
    """War diese Person richtig weg? (rein, testbar)

    «Richtig weg» heisst: weiter als NAHE_METER von zuhause. Ohne
    Entfernung (eine Flankenmeldung ohne Koordinaten) entscheidet die
    Zone: Wer weder zuhause noch im Quartier steht, ist draussen.

    None heisst unbekannt - daraus wird nichts gemerkt und nichts
    vergessen.
    """
    if zustand in ("", presence.UNKNOWN):
        return None
    if zustand == presence.HOME:
        return False
    if isinstance(entfernung, (int, float)) and not isinstance(entfernung, bool):
        return float(entfernung) > NAHE_METER
    return zustand != "quartier"


def karte_faellig(zustand: str, entfernung: Any, war_weit: bool) -> bool | None:
    """Soll die Haustür-Karte gerade laufen? (rein, testbar)

    None heisst unbekannt - daraus startet keine Karte, und eine
    laufende verschwindet deswegen auch nicht.

    Die Karte lief zuerst, sobald jemand nicht zuhause war - und lag
    damit den ganzen Arbeitstag auf dem Sperrbildschirm, obwohl ein
    Türöffner ohne Face ID nur in einem Moment nützt: den letzten
    Metern vor der Türe. Also nur noch im Umkreis von NAHE_METER.

    Das genügte nicht: Beim *Weggehen* ist man ebenfalls in diesem
    Umkreis, und die Karte kam damit jedes Mal beim Hinausgehen. Sie
    gehört aber auf den Heimweg. Darum die dritte Bedingung: Man muss
    seit dem letzten Mal zuhause auch wirklich draussen gewesen sein
    (`war_weit`, siehe weit_weg). Wer um den Block geht, bekommt keine;
    wer aus der Stadt zurückkommt, hat sie ab dem Ortseingang.

    Der Preis: Wer ausschliesslich innerhalb von drei Kilometern
    unterwegs ist, bekommt gar keine Karte mehr. Das ist die richtige
    Seite des Irrtums - eine Karte, die man nicht braucht, liegt sonst
    jeden Tag da, und eine, die man einmal vermisst, ersetzt die App
    mit zwei Tippern.
    """
    if zustand in ("", presence.UNKNOWN):
        return None
    if zustand == presence.HOME:
        return False
    if not war_weit:
        return False
    if isinstance(entfernung, (int, float)) and not isinstance(entfernung, bool):
        return float(entfernung) <= NAHE_METER
    return zustand == "quartier"


def kartenstand(
    zustand: str, entfernung: Any, war_weit: bool, laeuft: bool
) -> bool | None:
    """Soll die Karte jetzt liegen? (rein, testbar)

    Anfang und Ende folgen verschiedenen Regeln, und genau das fehlte:
    Angefangen wird nur auf dem Heimweg (karte_faellig), aufgehört wird
    nur zuhause. Dazwischen bleibt die Karte liegen, auch wenn die
    Ortung noch einmal über die Drei-Kilometer-Grenze und zurück
    springt.

    Der gemeldete Fall - fünf gleiche Karten übereinander: Jeder solche
    Sprung beendete die Karte und begann eine neue. Und weil das Beenden
    das Token der laufenden Aktivität braucht, das ein gesperrtes
    Telefon oft nie nachmeldet, verschwand die alte nicht, sondern
    bekam nur Gesellschaft. Aus einem Zittern der Ortung wurde so ein
    Stapel.
    """
    if zustand in ("", presence.UNKNOWN):
        return None
    if zustand == presence.HOME:
        return False
    if laeuft:
        return True
    return karte_faellig(zustand, entfernung, war_weit)


#: Wo steht, wer seit dem letzten Mal zuhause draussen war: [{user, weit}].
#: In der Datendatei, nicht im Kopf: Zwischen Weggehen und Heimkommen
#: liegt ein Arbeitstag, und ein Update dazwischen ist der Normalfall -
#: ohne das Gedächtnis käme nach jedem Neustart des Hubs keine Karte mehr.
WEIT_KEY = "live_weit"


def war_weit(rows: Any, user: str) -> bool:
    """Steht diese Person als «war draussen» vermerkt? (rein, testbar)"""
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("user") or "") == user:
            return bool(row.get("weit"))
    return False


def weit_merken(rows: Any, user: str, weit: bool) -> list[dict[str, Any]]:
    """Den Vermerk setzen - je Person eine Zeile (rein, testbar)."""
    andere = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and str(row.get("user") or "") != user
    ]
    return [*andere, {"user": user, "weit": bool(weit)}]


def weit_nachfuehren(zustand: str, entfernung: Any) -> bool | None:
    """Wie der «war draussen»-Vermerk nachzieht (rein, testbar).

    Drei Ausgänge: True (jetzt richtig draussen - vormerken), False
    (zuhause angekommen - der Vermerk fängt von vorn an), None (nichts
    ändern).

    None ist der ganze Punkt, und er ist einmal falsch gebaut worden:
    Der Takt setzte den Vermerk direkt auf weit_weg() - und das wird
    beim Heimkommen schon am Ortsrand False, drei Kilometer vor der
    Türe. Im selben Takt fragte karte_faellig dann «war der weit weg?»,
    bekam Nein - und die Karte, für die es den Vermerk überhaupt gibt,
    erschien auf keinem einzigen Heimweg. Wer im Anmarsch ist (nah,
    aber nicht zuhause), behält den Vermerk deshalb, bis er wirklich
    durch die Tür ist.
    """
    if zustand == presence.HOME:
        return False
    if weit_weg(zustand, entfernung) is True:
        return True
    return None


#: So lange nach einem Start kommt kein zweiter - auch dann nicht, wenn
#: die Ortung zwischendurch behauptet, die Karte gehöre weg und wieder
#: her. Der letzte Riegel vor einem Stapel: Selbst wenn alles andere
#: versagt, liegt danach höchstens eine Karte je halbe Stunde.
START_SPERRE = 1800.0


def wechsel(
    rows: Any, weg: dict[str, bool], jetzt: float | None = None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Wer bekommt einen Start-, wer einen Ende-Push? (rein, testbar)

    `weg` sagt je Benutzer, ob er gerade ausdrücklich nicht zuhause ist.
    Wer darin nicht vorkommt (keine Zone, Zustand unbekannt), bleibt wie
    er ist - aus Nichtwissen startet keine Karte, und eine laufende
    verschwindet deswegen auch nicht.

    Zurück kommen die neue Liste, die Zeilen für den Start-Push und die
    Zeilen für den Ende-Push.
    """
    uhr = time.time() if jetzt is None else jetzt
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
            letzter = row.get("letzter_start")
            frisch = (
                isinstance(letzter, (int, float))
                and not isinstance(letzter, bool)
                and uhr - float(letzter) < START_SPERRE
            )
            if frisch:
                # Die vorige Karte liegt mit grosser Wahrscheinlichkeit
                # noch da: Ein Ende-Push ohne Aktivitäts-Token kommt nicht
                # an, und iOS räumt von selbst erst Stunden später. Also
                # gilt sie als laufend, statt eine zweite danebenzulegen -
                # und ihr Token bleibt erhalten, damit das Beenden bei der
                # Ankunft noch möglich ist.
                row = {**row, "unterwegs": True}
            else:
                row = {
                    **row,
                    "unterwegs": True,
                    "activity_token": None,
                    "letzter_start": uhr,
                }
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
        #: Tokens, die Apple endgültig abgelehnt hat. Der Takt trägt sie
        #: danach aus - siehe token_tot.
        self.tote: set[str] = set()

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
        if token_tot(antwort.status_code, antwort.text):
            self.tote.add(geraete_token)
        return False


# ── Der Takt ───────────────────────────────────────────────────────────────


def _weg_stand(hub: Any, benutzer: set[str], laufend: set[str]) -> dict[str, bool]:
    """Je Benutzer: soll seine Haustür-Karte gerade liegen?

    «Unbekannt» fehlt bewusst im Ergebnis: Aus Nichtwissen soll weder
    eine Karte entstehen noch eine verschwinden. Wann eine anfängt und
    wann sie endet, entscheidet kartenstand - `laufend` sagt, für wen
    gerade eine liegt.
    """
    geofence = hub.integrations.get("geofence") if hub.integrations else None
    zones = getattr(geofence, "_zones", None) or {}
    namen = {
        zone_id: getattr(hub.registry.get(entity_id), "label", zone_id)
        for zone_id, entity_id in zones.items()
    }
    weit_rows = hub.data.get(WEIT_KEY)
    stand: dict[str, bool] = {}
    for name in benutzer:
        zone_id = presence.zone_fuer(name, namen)
        if zone_id is None:
            continue
        entity = hub.registry.get(zones[zone_id])
        zustand_roh = (entity.state if entity else {})
        zustand = str(zustand_roh.get("state") or presence.UNKNOWN)
        entfernung = zustand_roh.get("distance")

        # Erst merken, dann entscheiden: Wer gerade draussen ist, ist
        # damit für den Heimweg vorgemerkt; erst wer zuhause ankommt,
        # fängt von vorn an. Der Anmarsch (nah, aber nicht zuhause) und
        # Unbekanntes lassen den Vermerk, wie er war - sonst wäre er
        # genau in dem Takt weg, in dem die Karte ihn braucht
        # (weit_nachfuehren erzählt den Fehler).
        weit = weit_nachfuehren(zustand, entfernung)
        if weit is not None and weit != war_weit(weit_rows, name):
            weit_rows = weit_merken(weit_rows, name, weit)
            hub.data.set(WEIT_KEY, weit_rows)
        faellig = kartenstand(
            zustand, entfernung, war_weit(weit_rows, name), name in laufend
        )
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
    laufend = {
        str(row.get("user") or "")
        for row in rows
        if isinstance(row, dict) and row.get("unterwegs")
    }
    weg = _weg_stand(hub, benutzer, laufend)
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
    # Telefone, deren Token Apple endgültig abgelehnt hat, fliegen raus.
    # Sonst schickt der Hub bei jedem Weggehen weiter an ein Gerät, das
    # es so nicht mehr gibt.
    if versand.tote:
        vorher = len(neue)
        neue = [row for row in neue if row.get("start_token") not in versand.tote]
        if len(neue) < vorher:
            log.info(
                "Live-Aktivität: %d Telefon(e) ausgetragen - Apple kennt "
                "das Token nicht mehr",
                vorher - len(neue),
            )
        versand.tote.clear()
    hub.data.set(DATA_KEY, neue)
