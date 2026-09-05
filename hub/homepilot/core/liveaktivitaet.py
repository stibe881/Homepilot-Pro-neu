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

    Meldet sich ein Konto dagegen MIT Namen an, fliegen auch seine
    namenlosen Zeilen raus. Sie stammen aus Fassungen vor den
    Gerätenamen und sind fast sicher dasselbe Telefon von früher - und
    Apple hält ihre Start-Tokens am Leben: Jede solche Zeile war eine
    weitere gleiche Karte samt Meldung auf demselben Sperrbildschirm.
    Der Namens-Abgleich oben stoppte nur neue Doppel; die alten Zeilen
    räumte nichts weg, und aus «fünf Karten» wurde so bloss «immer noch
    zwei». Der denkbare Verlust - ein Zweitgerät desselben Kontos, das
    seit Monaten keine App-Fassung mit Namen sah - heilt sich beim
    nächsten Öffnen der App von selbst.
    """
    name = str(label or "")

    def dasselbe_telefon(row: dict[str, Any]) -> bool:
        return bool(
            name
            and str(row.get("user") or "") == user
            and str(row.get("label") or "") == name
        )

    def alte_fassung(row: dict[str, Any]) -> bool:
        return bool(
            name
            and str(row.get("user") or "") == user
            and not str(row.get("label") or "")
        )

    neue = [
        row
        for row in (rows or [])
        if isinstance(row, dict)
        and row.get("start_token") != token
        and not dasselbe_telefon(row)
        and not alte_fassung(row)
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
    Zeile des Benutzers - im Haushalt hat eine Person selten mehr als
    ein Telefon, und ein doppelt beendetes Beenden ist harmlos.

    Auch eine Zeile, die schon ein Token trägt, bekommt das neue: Apple
    stellt Aktivitäts-Tokens gelegentlich frisch aus, und die App meldet
    beim Öffnen zudem die Tokens *liegender* Karten nach. Das jüngste
    ist das, mit dem sich die Karte wirklich beenden lässt - am alten
    festzuhalten hiesse, mit einem abgelaufenen Schlüssel zu winken.
    """
    neue = []
    for row in rows or []:
        if (
            isinstance(row, dict)
            and row.get("user") == user
            and row.get("unterwegs")
        ):
            row = {**row, "activity_token": token}
        neue.append(row)
    return neue


def karte_laeuft(rows: Any, user: str) -> bool:
    """Sollte für diese Person gerade eine Karte liegen? (rein, testbar)"""
    return any(
        isinstance(row, dict) and row.get("user") == user and row.get("unterwegs")
        for row in rows or []
    )


#: Aktivitäts-Tokens von Karten, die nicht liegen dürften: [{user, token}].
#:
#: Der Fall dahinter, gemeldet als «hier kommen immer noch 2 Karten»: Die
#: App meldet das Aktivitäts-Token oft erst nach, wenn das Telefon längst
#: wieder entsperrt ist. Bis dahin ist die Person heimgekommen, der Takt
#: wollte beenden, hatte kein Token - und übersprang das Ende. Die Karte
#: blieb liegen, und die nächste Fahrt legte eine zweite darüber. Meldet
#: die App später ein Token, obwohl laut Hub gar keine Karte liegen
#: sollte, gehört genau diese Karte beendet - der Takt holt das nach.
VERWAIST_KEY = "live_verwaist"


def verwaist_merken(rows: Any, user: str, token: str) -> list[dict[str, Any]]:
    """Ein Token zum Nach-Beenden vormerken (rein, testbar)."""
    neue = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("token") != token
    ]
    return [*neue, {"user": user, "token": token}]


# Zwei verschiedene Fragen, zwei verschiedene Zahlen - sie eine Zeit
# lang zu einer zu machen war bequem und falsch.
#
# WEIT_METER beantwortet «war der wirklich weg?». Der Umkreis der
# Quartier-Zone: Wer um den Block geht, war nicht weg.
WEIT_METER = 3000.0

# KARTE_METER beantwortet «ist er jetzt da?» - und zwar als Breite des
# Rings, der aussen an der Zone «zuhause» anliegt (kartenradius).
#
# Warum nicht hundert Meter, wie es sich anhört: Die Ortung meldet alle
# dreissig Sekunden, und wer mit fünfzig heimfährt, legt in dieser Zeit
# gut vierhundert Meter zurück. Ein Ring von hundert Metern liegt dann
# zwischen zwei Meldungen und wird nie betreten - die Karte käme nicht,
# und niemand sähe, warum. Dreihundert Meter überspringt auch ein
# schneller Wagen nicht; vor der Türe ist man damit immer noch, statt
# wie früher auf dem halben Heimweg.
KARTE_METER = 300.0

#: So lange bleibt die Karte nach der Ankunft noch liegen.
#:
#: Der Grund ist die Geometrie: Die Haustüre steht *innerhalb* der Zone
#: «zuhause» - man gilt also schon als daheim, während man vom Auto zur
#: Türe geht. Genau dann nützt ein Öffner ohne Face ID, und genau dann
#: verschwand die Karte bisher. Zehn Minuten decken den Weg vom Wagen
#: bis in die Wohnung ab und sind kurz genug, dass niemand sie als
#: liegengebliebene Karte wahrnimmt.
HEIM_GNADE = 600.0


def heimradius(places: Any) -> float | None:
    """Der Radius des Ortes «zuhause» in Metern (rein, testbar)."""
    for ort in places or []:
        if not isinstance(ort, dict) or str(ort.get("id")) != presence.HOME:
            continue
        try:
            return float(ort["radius"])
        except (KeyError, TypeError, ValueError):
            return None
    return None


def kartenradius(radius: float | None, nah: float = KARTE_METER) -> float:
    """Ab welcher Entfernung die Karte kommt, in Metern (rein, testbar).

    Die hundert Meter gehören *ausserhalb* der Zone «zuhause», nicht ab
    der Hausmitte - und das ist der Unterschied zwischen «kommt kurz vor
    der Türe» und «kommt nie».

    Gemessen wird nämlich bis zur Mitte des Ortes, und als zuhause gilt
    man ab seinem Radius; die Karte kommt also im Ring zwischen beidem.
    Stand dort die nackte Zahl, war dieser Ring bei einem Ort mit 150 m
    Radius nicht bloss schmal, sondern leer: Man war schon zuhause,
    bevor die Karte fällig wurde, und sie erschien auf keinem Heimweg -
    ohne dass irgendwo etwas falsch eingetragen gewesen wäre. Zwei
    Zahlen, die nichts voneinander wussten.

    Jetzt legt sich der Ring immer aussen an die Zone an, wie weit sie
    auch reicht.
    """
    if radius is None:
        return nah
    return float(radius) + nah


def weit_weg(zustand: str, entfernung: Any) -> bool | None:
    """War diese Person richtig weg? (rein, testbar)

    «Richtig weg» heisst: weiter als WEIT_METER von zuhause. Ohne
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
        return float(entfernung) > WEIT_METER
    return zustand != "quartier"


def karte_faellig(
    zustand: str, entfernung: Any, war_weit: bool, nah: float = KARTE_METER
) -> bool | None:
    """Soll die Haustür-Karte gerade laufen? (rein, testbar)

    None heisst unbekannt - daraus startet keine Karte, und eine
    laufende verschwindet deswegen auch nicht.

    Die Karte lief zuerst, sobald jemand nicht zuhause war - und lag
    damit den ganzen Arbeitstag auf dem Sperrbildschirm, obwohl ein
    Türöffner ohne Face ID nur in einem Moment nützt: den letzten
    Metern vor der Türe. Also nur noch im Umkreis von KARTE_METER.

    Das genügte nicht: Beim *Weggehen* ist man ebenfalls in diesem
    Umkreis, und die Karte kam damit jedes Mal beim Hinausgehen. Sie
    gehört aber auf den Heimweg. Darum die zweite Bedingung: Man muss
    seit dem letzten Mal zuhause auch wirklich draussen gewesen sein
    (`war_weit`, siehe weit_weg). Wer um den Block geht, bekommt keine;
    wer aus der Stadt zurückkommt, hat sie vor der Türe.

    KARTE_METER ist bewusst eng (100 m): Der Umkreis war zuerst
    derselbe wie der für «war weg», drei Kilometer - und damit lag die
    Karte den halben Heimweg lang da, statt in dem Moment zu kommen, in
    dem man aussteigt. `nah` ist die Entfernung von der Hausmitte, ab der
    sie fällig wird - der Takt rechnet sie aus dem Radius der Zone aus,
    damit der Ring wirklich draussen an ihr anliegt (kartenradius).

    Ohne Entfernung - eine Flankenmeldung ohne Koordinaten - bleibt nur
    die Zone. Dann ist «quartier» das Beste, was zu haben ist: näher
    weiss der Hub es in diesem Fall nicht.
    """
    if zustand in ("", presence.UNKNOWN):
        return None
    if zustand == presence.HOME:
        return False
    if not war_weit:
        return False
    if isinstance(entfernung, (int, float)) and not isinstance(entfernung, bool):
        return float(entfernung) <= nah
    return zustand == "quartier"


def kartenstand(
    zustand: str,
    entfernung: Any,
    war_weit: bool,
    laeuft: bool,
    nah: float = KARTE_METER,
    heim_vor: float | None = None,
) -> bool | None:
    """Soll die Karte jetzt liegen? (rein, testbar)

    Anfang und Ende folgen verschiedenen Regeln, und genau das fehlte:
    Angefangen wird auf dem Heimweg (karte_faellig), aufgehört wird erst
    zuhause. Dazwischen bleibt die Karte liegen, auch wenn die Ortung
    noch einmal über die Grenze und zurück springt.

    Der gemeldete Fall - fünf gleiche Karten übereinander: Jeder solche
    Sprung beendete die Karte und begann eine neue. Und weil das Beenden
    das Token der laufenden Aktivität braucht, das ein gesperrtes
    Telefon oft nie nachmeldet, verschwand die alte nicht, sondern
    bekam nur Gesellschaft. Aus einem Zittern der Ortung wurde so ein
    Stapel.

    `heim_vor` sagt, wie viele Sekunden die Ankunft her ist (None: nicht
    zuhause oder unbekannt). Für die Nachfrist, und die hat einen
    handfesten Grund: Die Haustüre steht *innerhalb* der Zone «zuhause».
    Man gilt also als daheim, während man vom Auto zur Türe geht - und
    genau in diesem Moment verschwand die Karte, der man den Türöffner
    verdankt. Sie bleibt jetzt HEIM_GNADE lang liegen.

    Zwei Wege führen zur Karte, und der zweite ist ein Netz: der Ring
    vor der Zone (das Übliche) und die Ankunft selbst. Der Ring ist eine
    Strecke von dreihundert Metern, und zwischen zwei Ortsmeldungen
    liegen dreissig Sekunden - wer schnell fährt, kann ihn trotzdem
    überspringen. Dann fängt die Ankunft die Karte auf, und man hat sie
    für den Weg zur Türe. Beide Male gilt: nur, wer wirklich draussen
    war.
    """
    if zustand in ("", presence.UNKNOWN):
        return None
    if zustand == presence.HOME:
        # Nach der Ankunft noch kurz - aber nur, wenn sie zu einer
        # Heimkehr gehört. Wer den ganzen Tag zuhause sitzt, bekommt
        # deswegen keine Karte.
        if not (laeuft or war_weit):
            return False
        return heim_vor is not None and heim_vor < HEIM_GNADE
    if laeuft:
        return True
    return karte_faellig(zustand, entfernung, war_weit, nah)


def diagnose(
    *,
    eingerichtet: bool,
    telefone: int,
    abgestellt: bool,
    zone: str | None,
    zustand: str,
    entfernung: Any,
    nah: float,
    draussen_gewesen: bool,
    laeuft: bool,
    token_da: bool,
    heim_vor: float | None,
) -> str:
    """Warum gerade keine Karte auf dem Sperrbildschirm liegt (rein, testbar).

    Zwischen «der Schalter steht an» und «die Karte liegt da» hängen acht
    Glieder, und sieben davon schweigen, wenn sie fehlen: kein
    apns-Block, kein angemeldetes Telefon, keine Zone zu diesem
    Benutzer, keine Ortung, kein Vermerk «war draussen», zu weit weg,
    schon zuhause. Von aussen sieht jedes davon gleich aus - es passiert
    nichts.

    Das hat drei Runden Raten gekostet. Diese Funktion nennt das erste
    Glied, das nicht trägt, in einem Satz, den die App unter dem
    Schalter anzeigt.
    """
    if not eingerichtet:
        return (
            "Der Hub hat keinen apns-Block in der config.yaml - ohne "
            "Apple-Schlüssel kann er keine Karte stellen."
        )
    if telefone == 0:
        return (
            "Dieses Konto hat kein angemeldetes Telefon. Die App meldet "
            "ihr Token beim Start an; kommt es nie an, liegt es an iOS "
            "(vor 17.2 gibt es keine Karte per Push) oder daran, dass die "
            "App seit der Installation nicht offen war."
        )
    if abgestellt:
        return "Im Profil abgeschaltet - weder «Live-Aktivitäten» noch die Haustür-Karte."
    if zone is None:
        return (
            "Zu diesem Konto gibt es keine Geofence-Zone. Der Hub findet "
            "die Zone über den Namen; heisst sie anders, weiss er nicht, "
            "wo du bist."
        )
    if zustand in ("", presence.UNKNOWN):
        return "Die Ortung weiss gerade nicht, wo du bist - daraus startet nichts."
    if laeuft:
        offen = "" if token_da else (
            " Das Token der Aktivität hat die App nie nachgemeldet - "
            "beenden lässt sie sich damit nicht, iOS räumt sie selbst weg."
        )
        return f"Eine Karte läuft gerade.{offen}"
    if zustand == presence.HOME:
        if heim_vor is not None and heim_vor >= HEIM_GNADE:
            return (
                f"Du bist seit {heim_vor / 60:.0f} Minuten zuhause - die "
                f"Nachfrist von {HEIM_GNADE / 60:.0f} Minuten ist vorbei."
            )
        return "Du bist zuhause. Die Karte kommt auf dem Heimweg."
    if not draussen_gewesen:
        return (
            f"Kein Vermerk «war draussen». Der Hub setzt ihn erst weiter "
            f"als {WEIT_METER:.0f} m vom Haus - wer nur im Quartier "
            f"unterwegs war, bekommt keine Karte."
        )
    if isinstance(entfernung, (int, float)) and not isinstance(entfernung, bool):
        if float(entfernung) > nah:
            return (
                f"Noch {float(entfernung):.0f} m von der Hausmitte entfernt; "
                f"die Karte kommt ab {nah:.0f} m."
            )
        return "Die Karte müsste jetzt kommen - der nächste Takt stellt sie."
    return (
        f"Die Ortung meldet keine Entfernung, nur die Zone «{zustand}». "
        "Dann entscheidet allein sie, und die Karte kommt erst im Quartier."
    )


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


def _zeile(rows: Any, user: str) -> dict[str, Any]:
    """Die Zeile dieser Person, oder eine leere (rein)."""
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("user") or "") == user:
            return row
    return {}


def weit_merken(rows: Any, user: str, weit: bool) -> list[dict[str, Any]]:
    """Den Vermerk setzen - je Person eine Zeile (rein, testbar).

    Die übrigen Felder der Zeile bleiben stehen: Dort wohnt seit der
    Nachfrist auch die Ankunftszeit, und die darf ein Wechsel des
    Vermerks nicht mitnehmen.
    """
    andere = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and str(row.get("user") or "") != user
    ]
    return [*andere, {**_zeile(rows, user), "user": user, "weit": bool(weit)}]


def heim_seit(rows: Any, user: str) -> float | None:
    """Seit wann diese Person zuhause ist, als Zeitstempel (rein, testbar)."""
    wert = _zeile(rows, user).get("heim_seit")
    if isinstance(wert, (int, float)) and not isinstance(wert, bool):
        return float(wert)
    return None


def heim_merken(rows: Any, user: str, seit: float | None) -> list[dict[str, Any]]:
    """Die Ankunftszeit setzen oder löschen (rein, testbar)."""
    andere = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and str(row.get("user") or "") != user
    ]
    return [*andere, {**_zeile(rows, user), "user": user, "heim_seit": seit}]


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
            # Bewusst ohne Wartefrist. Es stand hier eine halbe Stunde
            # Sperre gegen den Kartenstapel - sie war der falsche Riegel
            # am falschen Ort: Wer kurz zum Briefkasten fährt und
            # zurückkommt, soll seine Karte bekommen. Gegen den Stapel
            # steht jetzt, dass eine Karte nur zuhause endet
            # (kartenstand) und eine neue erst nach einer echten
            # Auswärtsfahrt fällig wird (war_weit) - beides an der
            # Ursache statt an der Uhr.
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
    # Aus dem Radius der Zone, nicht als nackte Zahl: siehe kartenradius.
    nah = kartenradius(heimradius(getattr(geofence, "places", None)))
    stand: dict[str, bool] = {}
    for name in benutzer:
        zone_id = presence.zone_fuer(name, namen)
        if zone_id is None:
            continue
        entity = hub.registry.get(zones[zone_id])
        zustand_roh = (entity.state if entity else {})
        zustand = str(zustand_roh.get("state") or presence.UNKNOWN)
        entfernung = zustand_roh.get("distance")

        # Der Vermerk von *vor* dieser Runde. Er entscheidet, denn die
        # Ankunft löscht ihn im selben Takt - und die Ankunft ist genau
        # der Moment, in dem die Karte fällig sein kann.
        vorher_weit = war_weit(weit_rows, name)

        # Erst merken, dann entscheiden: Wer gerade draussen ist, ist
        # damit für den Heimweg vorgemerkt; erst wer zuhause ankommt,
        # fängt von vorn an. Der Anmarsch (nah, aber nicht zuhause) und
        # Unbekanntes lassen den Vermerk, wie er war - sonst wäre er
        # genau in dem Takt weg, in dem die Karte ihn braucht
        # (weit_nachfuehren erzählt den Fehler).
        weit = weit_nachfuehren(zustand, entfernung)
        if weit is not None and weit != vorher_weit:
            weit_rows = weit_merken(weit_rows, name, weit)
            hub.data.set(WEIT_KEY, weit_rows)

        # Die Ankunftszeit: gesetzt, sobald jemand zuhause auftaucht,
        # gelöscht, sobald er wieder weg ist. Daran hängt die Nachfrist,
        # in der die Karte den Weg vom Auto zur Türe überlebt.
        angekommen = heim_seit(weit_rows, name)
        if zustand == presence.HOME and angekommen is None:
            angekommen = time.time()
            weit_rows = heim_merken(weit_rows, name, angekommen)
            hub.data.set(WEIT_KEY, weit_rows)
        elif zustand not in (presence.HOME, "", presence.UNKNOWN) and angekommen:
            angekommen = None
            weit_rows = heim_merken(weit_rows, name, None)
            hub.data.set(WEIT_KEY, weit_rows)

        faellig = kartenstand(
            zustand,
            entfernung,
            vorher_weit,
            name in laufend,
            nah,
            None if angekommen is None else time.time() - angekommen,
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
    geofence = hub.integrations.get("geofence") if hub.integrations else None
    radius = heimradius(getattr(geofence, "places", None))
    # Einmal beim Start hinschreiben, mit welchen Metern gerechnet wird.
    # Es sind zwei Zahlen aus zwei Quellen, und wenn keine Karte kommt,
    # ist das die erste Frage - vorher musste man sie aus dem Quelltext
    # und der config.yaml zusammensuchen.
    log.info(
        "Live-Aktivität: Die Türkarte kommt ab %.0f m von der Hausmitte "
        "(Zone «zuhause» %s + %.0f m).",
        kartenradius(radius),
        f"{radius:.0f} m" if radius is not None else "unbekannt",
        KARTE_METER,
    )
    while True:
        await asyncio.sleep(TAKT_SEKUNDEN)
        try:
            await _runde(hub, versand)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Live-Aktivität: Runde fehlgeschlagen")


async def _runde(hub: Any, versand: ApnsVersand) -> None:
    # Zuerst die verwaisten Karten wegräumen: liegen gebliebene, deren
    # Token die App erst nachgemeldet hat, als der Hub sie längst für
    # beendet hielt (siehe VERWAIST_KEY). Vor allem anderen, damit auf
    # dem Sperrbildschirm nie zwei gleiche Karten übereinander liegen.
    verwaiste = hub.data.get(VERWAIST_KEY)
    if verwaiste:
        jetzt = time.time()
        for eintrag in verwaiste:
            if not isinstance(eintrag, dict) or not eintrag.get("token"):
                continue
            await versand.senden(str(eintrag["token"]), end_payload(jetzt))
            log.info(
                "Live-Aktivität: liegen gebliebene Karte von %s beendet",
                eintrag.get("user"),
            )
        hub.data.set(VERWAIST_KEY, [])
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
