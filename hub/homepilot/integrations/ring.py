"""Ring – Türklingeln und Kameras über die (inoffizielle) Cloud-API.

Konfiguration:
  - integration: ring
    # token_file: /etc/homepilot/ring-token.json   # optional
    # scan_interval: 300
    # events: false   # Ereigniskanal (läuft über Googles Push-Dienst)
    #                 # gar nicht erst versuchen - siehe unten

Voraussetzung:  pip install "homepilot[ring]"  bzw.  pip install ring-doorbell

Einrichtung (einmalig, Ring schickt einen 2FA-Code per Mail/SMS):
  1. Den Block oben in die config.yaml eintragen.
  2. Im Hub ausführen (im Container, dort liegt ring-doorbell):
         docker exec -it homepilot-hub \
             python -m homepilot.integrations.ring -c /config/config.yaml
     E-Mail, Passwort und den zugeschickten Code eingeben.
  3. Hub (neu) starten.

Das Passwort wird nirgends gespeichert – nur das dabei ausgestellte Token
(ring-token.json neben der homepilot-data.json, nur für den eigenen
Benutzer lesbar). Der Hub frischt es selbst auf und schreibt es zurück.

Klingeln und Bewegung kommen als Push über den Ereigniskanal der Ring-App
(Firebase); Gerätestatus und Akku werden zusätzlich alle scan_interval
Sekunden abgefragt. Die Kacheln benutzen dieselben Felder wie UniFi
Protect (state/motion/last_motion/last_ring) – die App kennt sie schon.

Kommt der Ereigniskanal nicht zustande, ist das die eine Störung, die man
nie bemerkt: Nichts stürzt ab, die Kacheln stehen da wie immer, es
klingelt bloss niemand mehr in der App. Deshalb zwei Dinge – der Hub
versucht es immer wieder statt einmal beim Start, und solange der Kanal
fehlt, fragt er die aktiven Meldungen alle paar Sekunden selbst ab. Wie
es gerade steht, sagt health() und damit der System-Bildschirm.

Der Ereigniskanal läuft technisch über Googles Push-Dienst (FCM) - das
ist Rings Wahl, nicht unsere. Wer Google im Heimnetz bewusst aussperrt,
setzt ``events: false``: Dann übernimmt die 10-Sekunden-Abfrage von
vornherein, ohne Warnung im System-Bildschirm und ohne vergebliche
Anläufe alle halbe Stunde.

Klemmt er, sagt das der System-Bildschirm - und seit push_diagnose()
auch, *woran*: Der Hub prüft dann die drei Google-Adressen (siehe
PUSH_ENDPOINTS) und schreibt mit, was die Push-Bibliothek unterwegs
meldet. Aus «RuntimeError: Unable to establish subscription with Google
Cloud Messaging» wird so entweder «mtalk.google.com:5228 nicht
erreichbar - Firewall?» oder «Google lehnt die Anmeldung ab
(PHONE_REGISTRATION_ERROR)». Von Hand nachsehen:

    docker exec homepilot-hub \
        python -m homepilot.integrations.ring -c /config/config.yaml --diagnose

Im Container, nicht auf dem Host: Dort gelten andere Netzregeln, und wer
auf dem Host misst, misst das falsche Netz.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ..core import tokenstore
from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

USER_AGENT = "HomePilot/1.0"

# Ersatzweg: Ring führt eine Liste der gerade laufenden Meldungen – die
# gleiche, aus der auch die Ring-App ihre Nachricht baut.
#
# Fünf Sekunden, solange der Push-Kanal nichts liefert. Zehn waren es
# vorher - «die Grenze des Erträglichen» stand als Begründung daneben,
# und das ist sie auch. Nur ist sie bei einer Gegensprechanlage, für die
# Ring gar nichts pusht, keine Notlösung mehr, sondern der Normalfall:
# Dann zählt jede Sekunde, und ein Aufruf alle fünf Sekunden für ein
# einzelnes Gerät ist nichts, was Ring in Verlegenheit bringt.
DING_POLL_SECONDS = 5
# Dreissig Sekunden, während er steht. Nicht aus Misstrauen gegen den
# Push-Kanal an sich, sondern gegen das, was er im Fehlerfall meldet: Er
# gilt als «gestartet», bis ihn jemand stoppt. Reisst die Verbindung
# darunter weg, sieht von aussen alles gut aus und es kommt bloss nichts
# mehr an. Diese Abfrage ist das Netz darunter; doppelt gemeldete
# Ereignisse fallen ohnehin heraus.
DING_POLL_BACKUP_SECONDS = 30

# Abstände zwischen den Anläufen für den Ereigniskanal. Erst rasch,
# danach ruhiger: Wenn Ring den Dienst verweigert, hilft es niemandem,
# alle dreissig Sekunden anzuklopfen.
RETRY_SECONDS = [30, 60, 300, 900, 1800]


def retry_delay(attempt: int) -> float:
    """Wartezeit vor dem nächsten Anlauf (rein, testbar)."""
    if attempt < 1:
        return RETRY_SECONDS[0]
    return RETRY_SECONDS[min(attempt, len(RETRY_SECONDS)) - 1]


def alert_key(event: Any) -> tuple[int, int, str]:
    """Kennung einer Meldung – dieselbe Klingel zweimal ist einmal."""
    return (int(event.doorbot_id), int(event.id), str(event.kind))


def new_alerts(
    alerts: list[Any], seen: dict[tuple[int, int, str], float], now: float
) -> tuple[list[Any], dict[tuple[int, int, str], float]]:
    """Welche Meldungen neu sind, und was man sich merken muss (rein, testbar).

    Eine Meldung bleibt bei Ring ein paar Minuten «aktiv». Ohne Gedächtnis
    käme dieselbe Klingel bei jeder Abfrage erneut - alle zehn Sekunden
    eine Nachricht, bis sie abläuft. Gemerkt wird bis zum Ablauf und
    keinen Moment länger, sonst wächst die Liste mit jedem Besucher.
    """
    frisch = []
    behalten = {key: bis for key, bis in seen.items() if bis > now}
    for event in alerts:
        try:
            key = alert_key(event)
        except (TypeError, ValueError, AttributeError):
            continue
        if key in behalten:
            continue
        begonnen = float(getattr(event, "now", None) or now)
        dauer = float(getattr(event, "expires_in", None) or 60)
        behalten[key] = begonnen + dauer
        frisch.append(event)
    return frisch, behalten


# Wie lange ein frisch aufgebauter Kanal Zeit bekommt, bevor über ihn
# geurteilt wird. start() kehrt zurück, sobald die Anmeldung durch ist;
# der Push-Client darunter meldet sich erst danach als «läuft».
STARTUP_GRACE_SECONDS = 30

# Wie oft der Kanal hintereinander tot aussehen muss, bevor er als tot
# gilt. Eine FCM-Verbindung baut sich von selbst neu auf – während dieser
# Sekunden meldet der Empfänger «nicht gestartet», obwohl alles in
# Ordnung ist. Beim ersten Blick zu urteilen hiess: den gesunden Kanal
# abreissen, neu registrieren, wieder abreissen. Von aussen sah das aus
# wie ein Kanal, der ewig startet – und die Klingel kam derweil über die
# Abfrage, also Sekunden zu spät.
TOT_BESTAETIGUNGEN = 3

# Abstand zwischen zwei Blicken auf den stehenden Kanal.
KANAL_BLICK_SECONDS = 15


def channel_alive(listener: Any) -> bool:
    """Steht der Ereigniskanal wirklich noch? (rein, testbar)

    «started» am Zuhörer heisst bloss, dass ihn niemand gestoppt hat. Der
    Push-Client darunter schaltet sich bei einem Fehler selbst ab - genau
    das passiert bei einer beschädigten Anmeldung, eine Sekunde nach dem
    «erfolgreich angemeldet». Von aussen sah dann alles gut aus, und es
    klingelte bloss nie.

    Fehlt der Einblick (ältere Fassung der Bibliothek), gilt der Kanal als
    in Ordnung: Lieber einen toten Kanal übersehen als einen gesunden
    ständig neu aufbauen - die Abfrage fängt den Fall ohnehin auf.
    """
    if not getattr(listener, "started", False):
        return False
    receiver = getattr(listener, "_receiver", None)
    pruefen = getattr(receiver, "is_started", None)
    if not callable(pruefen):
        return True
    try:
        return bool(pruefen())
    except Exception:
        return True


# Die drei Adressen, über die Rings Ereigniskanal läuft. Sie gehören
# Google, nicht Ring – wer sie im Netz sperrt (Gäste-VLAN, Pi-hole,
# Firewall-Regel «kein Google»), sperrt damit die Türklingel aus, ohne
# dass irgendwo «Türklingel» steht. Genau darum stehen sie hier
# namentlich: Die Meldung soll sagen, welche fehlt.
PUSH_ENDPOINTS: list[tuple[str, int, str]] = [
    ("android.clients.google.com", 443, "Anmeldung (GCM-Checkin)"),
    ("fcm.googleapis.com", 443, "Registrierung (FCM)"),
    ("mtalk.google.com", 5228, "Dauerverbindung (MCS)"),
]

# So lange darf ein Erreichbarkeitstest dauern. Kurz: Es geht nicht um
# eine Messung, sondern um «kommt überhaupt etwas durch».
REACH_TIMEOUT = 4.0

# Wessen Log beim Anlauf mitgeschrieben wird. Beide, weil der
# entscheidende Satz mal hier und mal dort steht: Googles Absage kommt
# aus firebase_messaging, Rings Absage («Unable to checkin to listen
# service, response was 401 …») aus ring_doorbell.
PUSH_LOGGER = ("firebase_messaging", "ring_doorbell")


def push_diagnose(erreichbar: dict[str, bool], meldungen: list[str]) -> str:
    """Aus Erreichbarkeit und Bibliotheks-Log einen brauchbaren Satz machen.

    (rein, testbar)

    «RuntimeError: Unable to establish subscription with Google Cloud
    Messaging» ist wahr und hilft niemandem: Der Satz nennt weder, was
    fehlgeschlagen ist, noch was man dagegen tun könnte. Der eigentliche
    Grund steht im Log von firebase_messaging – oder er steht nirgends,
    weil schon die Verbindung nicht zustande kam.

    Die Reihenfolge ist Absicht: Erst das, was man selbst ändern kann
    (ein gesperrter Weg im eigenen Netz), dann das, was man aussitzen
    muss (Google lehnt ab).
    """
    fehlend = [
        f"{host}:{port}"
        for host, port, _zweck in PUSH_ENDPOINTS
        if erreichbar.get(host) is False
    ]
    if fehlend:
        return (
            ", ".join(fehlend)
            + " ist vom Hub aus gesperrt – Firewall, Pi-hole oder VLAN?"
        )
    text = " ".join(meldungen)
    if "PHONE_REGISTRATION_ERROR" in text:
        return (
            "Google lehnt die Anmeldung ab (PHONE_REGISTRATION_ERROR) – "
            "das ist Googles Seite, der Hub versucht es weiter"
        )
    if "AUTHENTICATION_FAILED" in text or "401" in text:
        return "Google weist die Anmeldung zurück (Authentifizierung)"
    if "TOO_MANY_REGISTRATIONS" in text or "429" in text:
        return "zu viele Anmeldungen in kurzer Zeit – später wieder"
    for zeile in reversed(meldungen):
        sauber = zeile.strip()
        if sauber:
            return sauber
    return "Grund unbekannt – alle Google-Adressen sind erreichbar"


#: So viele der letzten Klingeln zählen für das Urteil.
QUELLEN_FENSTER = 4
#: Kamen so viele davon über die Abfrage, ist der Kanal taub.
TAUB_AB = 2


# ── Wen die Ersatz-Abfrage überhaupt sieht ─────────────────────────────────
#
# `dings/active` ist der Endpunkt der Türklingeln und Kameras – in Rings
# API heissen die zusammen «doorbots». Die Gegensprechanlage (Ring
# Intercom) gehört nicht dazu: Sie hängt an einer eigenen Adressfamilie
# (/commands/v1/devices/…), und ihr Klingeln taucht in dieser Liste nicht
# auf. Die Meldungen dort tragen sogar die Feldnamen der Türklingeln
# («doorbot_id», «doorbot_description»); es ist schlicht eine andere
# Geräteklasse.
#
# Das ist der Unterschied, der bisher nirgends stand. Für eine Türklingel
# ist der Ereigniskanal der schnelle Weg und die Abfrage das Netz
# darunter – schlimmstenfalls kommt das Klingeln zehn Sekunden später.
# Für eine Gegensprechanlage gab es kein Netz: Fiel der Kanal aus, kam
# gar nichts – ausgerechnet an der Türe, an der es zählt.
#
# Ihr Netz ist der Verlauf (`_intercom_loop`): Er kennt sie, weil er am
# Gerät hängt und nicht an der Geräteklasse. Alle fünf Sekunden
# nachsehen kostet einen Aufruf und ist der Unterschied zwischen «ein
# paar Sekunden später» und «gar nicht».


#: Takt, in dem der Verlauf der Gegensprechanlage abgefragt wird.
#:
#: Drei Sekunden. Das ist die Untergrenze dessen, was sich gegenüber
#: Rings Diensten vertreten lässt, und zugleich das Schnellste, was
#: dieser Weg hergibt: Der Hub bekommt vom Intercom kein Signal - das
#: Gerät spricht mit Rings Wolke, nicht mit ihm. Er kann nur fragen.
#:
#: Wer es wirklich sofort will, führt das Klingelsignal als Kontakt in
#: den Hub (siehe docs/klingel-sofort.md). Alles andere hier ist Fragen
#: statt Wissen, und Fragen kostet Zeit.
INTERCOM_POLL_SECONDS = 3

#: Wie alt ein Eintrag im Verlauf höchstens sein darf, damit er noch als
#: «es klingelt gerade» gilt. Alles Ältere ist Geschichte - beim Start
#: des Hubs soll nicht das Klingeln von gestern eine Nachricht auslösen.
INTERCOM_FRIST = 90.0


def verlauf_dings(
    verlauf: Any, gesehen: set[Any], jetzt: float, frist: float = INTERCOM_FRIST
) -> tuple[list[dict[str, Any]], set[Any]]:
    """Frische Klingel-Einträge aus dem Verlauf (rein, testbar).

    Die Gegensprechanlage hängt in Rings API an einer eigenen
    Adressfamilie und taucht in der Liste der aktiven Meldungen nicht
    auf. Ohne Ereigniskanal kam von ihr deshalb gar nichts - kein
    verspätetes Klingeln, sondern gar keines. Der Verlauf ist der Weg,
    der bleibt.

    Zwei Dinge muss diese Funktion können, und beide sind der Grund,
    weshalb sie eine eigene ist: Nichts zweimal melden (die Kennung
    merken), und beim Start nicht das Klingeln von gestern nachholen
    (die Frist).
    """
    frisch: list[dict[str, Any]] = []
    kennungen = set(gesehen)
    for eintrag in verlauf or []:
        kind = str(_feld(eintrag, "kind") or "").lower()
        if kind != "ding":
            continue
        kennung = _feld(eintrag, "id")
        if kennung is None or kennung in kennungen:
            continue
        wann = _zeitstempel(_feld(eintrag, "created_at"))
        kennungen.add(kennung)
        if wann is None or jetzt - wann > frist:
            # Gemerkt, aber nicht gemeldet: Beim nächsten Lauf soll er
            # nicht erneut geprüft werden, und eine Nachricht über ein
            # Klingeln von gestern will niemand.
            continue
        frisch.append({"id": kennung, "now": wann})
    return frisch, kennungen


def _feld(eintrag: Any, name: str) -> Any:
    """Ein Feld holen, egal ob dict oder Objekt (rein, testbar).

    Die Bibliothek liefert je nach Fassung das eine oder das andere.
    """
    if isinstance(eintrag, dict):
        return eintrag.get(name)
    return getattr(eintrag, name, None)


def _zeitstempel(wert: Any) -> float | None:
    """Aus dem, was im Verlauf steht, Sekunden machen (rein, testbar)."""
    if isinstance(wert, (int, float)):
        return float(wert)
    if isinstance(wert, datetime):
        stamp = wert if wert.tzinfo else wert.replace(tzinfo=UTC)
        return stamp.timestamp()
    if isinstance(wert, str):
        text = wert.strip().replace("Z", "+00:00")
        try:
            stamp = datetime.fromisoformat(text)
        except ValueError:
            return None
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=UTC)).timestamp()
    return None


@dataclass
class _VerlaufEreignis:
    """Ein Klingeln aus dem Verlauf, in der Form der übrigen Meldungen.

    Damit derselbe Weg durch `_handle_event` führt: Was dort an
    Entprellung, Merken und Zurücksetzen steht, soll für alle Quellen
    gleich gelten und nicht ein zweites Mal danebenstehen.
    """

    doorbot_id: int
    id: Any
    now: float
    kind: str = "ding"
    expires_in: float = 60.0


def ersatz_hinweis(ohne_ersatz: list[str]) -> str:
    """Satz über die Geräte, die die Abfrage nicht sieht (rein, testbar).

    Leer, wenn alle Geräte abgedeckt sind – dann ist der bisherige Text
    vollständig und ein Zusatz nur Lärm.
    """
    if not ohne_ersatz:
        return ""
    namen = ", ".join(sorted(ohne_ersatz))
    ist = "ist" if len(ohne_ersatz) == 1 else "sind"
    return (
        f" Achtung: {namen} {ist} davon nicht erfasst – die Abfrage kennt "
        "nur Türklingeln und Kameras. Dort kommt das Klingeln allein über "
        "den Ereigniskanal, sonst gar nicht."
    )


def verlauf_hinweis(mit_verlauf: list[str]) -> str:
    """Satz über die Geräte, für die der Verlauf einspringt (rein, testbar).

    Gehört überall dorthin, wo «wird ersatzweise abgefragt» steht: Für
    die Gegensprechanlage stimmt der Takt nicht, sie hängt an einem
    eigenen Weg. Ohne diesen Satz sähe es aus, als wäre sie vom
    Zehn-Sekunden-Netz mit abgedeckt - das war sie nie.
    """
    if not mit_verlauf:
        return ""
    namen = ", ".join(sorted(mit_verlauf))
    wird = "wird" if len(mit_verlauf) == 1 else "werden"
    return (
        f" {namen} {wird} über den Verlauf abgefragt, alle "
        f"{INTERCOM_POLL_SECONDS} s – dort kommt das Klingeln also auch "
        "ohne Ereigniskanal an."
    )


#: Wie weit zwei Meldungen desselben Klingelns zeitlich auseinander
#: liegen dürfen.
#:
#: Verglichen wird der Zeitpunkt, zu dem *geklingelt* wurde - nicht der,
#: zu dem die Meldung beim Hub eintraf. Das ist der Unterschied, der
#: zählt: Jeder Weg vergibt seine eigene Kennung (der Verlauf die des
#: Verlaufseintrags, die Abfrage die der Meldung), und jeder Weg kommt
#: zu einer anderen Zeit an - der Verlauf nach fünf Sekunden, die
#: Abfrage nach dreissig. Wer nach der Ankunft entprellt, bräuchte ein
#: Fenster, das breit genug ist, um einen zweiten Besucher zu
#: verschlucken.
#:
#: Der Klingel-Zeitpunkt dagegen ist bei allen Wegen derselbe, auf ein
#: paar Sekunden genau. Deshalb genügt hier ein enges Fenster - und wer
#: zehn Sekunden später nochmals drückt, wird gehört.
KLINGEL_ENTPRELLUNG = 5.0


def ding_zeit(event: Any, jetzt: float) -> float:
    """Wann geklingelt wurde (rein, testbar).

    Ring legt der Meldung ihren eigenen Zeitstempel bei. Fehlt er, bleibt
    nur der Moment des Eintreffens - dann ist die Entprellung ungenauer,
    aber immer noch besser als keine.
    """
    roh = getattr(event, "now", None)
    try:
        wert = float(roh)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return jetzt
    return wert if wert > 0 else jetzt


def ist_wiederholung(
    letzte: float | None, wann: float, frist: float = KLINGEL_ENTPRELLUNG
) -> bool:
    """Ist das dasselbe Klingeln wie das letzte? (rein, testbar)

    Beide Zeiten sind Klingel-Zeitpunkte, nicht Ankunftszeiten.
    """
    if letzte is None:
        return False
    return abs(wann - letzte) < frist


#: Wie die Wege heissen, über die ein Klingeln hereinkommen kann.
QUELLEN_NAMEN = {
    "push": "über den Ereigniskanal",
    "abfrage": "über die Abfrage",
    "verlauf": "über den Verlauf",
}


def kanal_zahlen_satz(gesamt: int, fremd: int) -> str:
    """Was über den Kanal hereinkam - in Zahlen (rein, testbar).

    Ein Kanal, über den nichts kommt, und ein Kanal, dessen Meldungen
    der Hub wegwirft, sehen von aussen gleich aus. Der Unterschied ist
    aber der ganze nächste Schritt: Im einen Fall liegt es bei Ring, im
    anderen beim Hub.
    """
    if gesamt <= 0:
        return " Über den Kanal kam seit dem Start keine einzige Meldung."
    satz = f" Über den Kanal kamen seit dem Start {gesamt} Meldungen"
    if fremd:
        return (
            satz + f", davon {fremd} für ein Gerät, das der Hub nicht kennt "
            "(steht im Protokoll)."
        )
    return satz + "."


def klingel_satz(wann: float | None, quelle: str | None, jetzt: float) -> str:
    """Wann zuletzt geklingelt hat - und auf welchem Weg (rein, testbar).

    Der Satz, der die Kette in zwei Hälften teilt. «Es kommt keine
    Nachricht» kann zweierlei heissen: Der Hub hat das Klingeln nie
    gehört, oder er hat es gehört und niemand hat ihm gesagt, was er
    damit tun soll. Von aussen sieht beides gleich aus, und man sucht
    wochenlang auf der falschen Seite.
    """
    if not wann:
        return " Seit dem Start hat noch niemand geklingelt."
    sekunden = max(0.0, jetzt - wann)
    if sekunden < 90:
        wie_lange = "gerade eben"
    elif sekunden < 3600:
        wie_lange = f"vor {round(sekunden / 60)} Min."
    elif sekunden < 86400:
        wie_lange = f"vor {round(sekunden / 3600)} Std."
    else:
        wie_lange = f"vor {round(sekunden / 86400)} Tagen"
    weg = QUELLEN_NAMEN.get(str(quelle or ""), "auf unbekanntem Weg")
    return f" Zuletzt geklingelt {wie_lange}, {weg}."


#: So lange darf ein stehender Kanal schweigen, bevor der Hub die
#: Anmeldung erneuert.
#:
#: Der Grund ist Rings Bauart: Die Anmeldung für Push hängt an der
#: Sitzung des Kontos, und Ring merkt sich **einen** Empfänger. Meldet
#: sich ein zweites Programm mit demselben Konto an - eine noch laufende
#: Home-Assistant-Instanz, die Ring-App auf einem alten Telefon -, zeigt
#: Rings Wegweiser dorthin, und hier kommt nichts mehr an. Von aussen
#: sieht das aus wie ein stehender Kanal, über den nichts kommt: genau
#: das, was im System-Bildschirm stand.
#:
#: Dagegen hilft nur, sich wieder vorne anzustellen. Eine halbe Stunde
#: Stille ist der Schwellwert - kürzer, und zwei Programme reissen sich
#: die Anmeldung im Minutentakt hin und her.
STILLE_FRIST = 1800.0


def anmeldung_erneuern(
    stand_seit: float | None,
    push_gesamt: int,
    jetzt: float,
    frist: float = STILLE_FRIST,
) -> bool:
    """Soll der Hub sich neu bei Ring anmelden? (rein, testbar)

    Ja, wenn der Kanal lange genug steht und über ihn trotzdem nie etwas
    kam. Kam schon etwas, ist er in Ordnung und eine stille halbe Stunde
    heisst bloss, dass niemand geklingelt hat.
    """
    if stand_seit is None or push_gesamt > 0:
        return False
    return jetzt - stand_seit >= frist


def abfrage_takt(events_ok: bool, quellen: list[str], push_gesamt: int) -> float:
    """Wie oft die Ersatz-Abfrage laufen soll (rein, testbar).

    Hier lag der Fehler, den man an der Uhr merkt: Der Takt hing daran,
    ob der Ereigniskanal *gestartet* ist - und das ist er, sobald die
    Anmeldung durch war, auch wenn danach nie etwas hereinkommt. Der Hub
    schaltete also auf den langsamen Takt zurück und wartete bis zu
    dreissig Sekunden, während die einzige Quelle, die wirklich lieferte,
    die Abfrage war. Im Schnitt fünfzehn Sekunden bis zur Nachricht -
    genau das, was zu messen war.

    Massgeblich ist deshalb nicht, ob der Kanal steht, sondern ob über
    ihn etwas kommt.
    """
    if not events_ok:
        return DING_POLL_SECONDS
    if push_gesamt <= 0 or kanal_taub(quellen):
        return DING_POLL_SECONDS
    return DING_POLL_BACKUP_SECONDS


def kanal_taub(quellen: list[str]) -> bool:
    """Steht der Kanal nur auf dem Papier? (rein, testbar)

    Das ist der Fall, der von aussen wie ein gesunder Kanal aussieht: Die
    Anmeldung ging durch, der Push-Client sagt «läuft» - und trotzdem
    kommt jedes Klingeln erst über die Abfrage, also zehn Sekunden zu
    spät. Ein Kanal, über den nichts kommt, ist keiner.

    Gemessen wird an den letzten Meldungen, nicht an einer einzelnen:
    Dass eine Meldung einmal über die Abfrage hereinkommt, ist normal -
    der Push kann in dem Moment gerade unterwegs sein.
    """
    letzte = [q for q in quellen if q][-QUELLEN_FENSTER:]
    if len(letzte) < TAUB_AB:
        return False
    return sum(1 for q in letzte if q != "push") >= TAUB_AB


def health_detail(
    events_ok: bool,
    error: str | None,
    abgeschaltet: bool = False,
    *,
    anlauf: bool = False,
    quellen: list[str] | None = None,
    abbrueche: int = 0,
    anlaeufe: int = 0,
    ohne_ersatz: list[str] | None = None,
    mit_verlauf: list[str] | None = None,
    letztes_klingeln: tuple[float, str] | None = None,
    jetzt: float | None = None,
    push_gesamt: int = 0,
    push_fremd: int = 0,
) -> str:
    """Was im System-Bildschirm über den Ereigniskanal steht (rein, testbar)."""
    # Wo unten «wird ersatzweise abgefragt» steht, gehören diese Sätze
    # dazu - sonst verspricht die Anzeige ein Netz, das für dieses Gerät
    # nicht gespannt ist, oder verschweigt eines, das es gibt.
    # Wann zuletzt geklingelt hat, steht in jedem Ausgang: Die Frage «hat
    # der Hub es überhaupt gehört?» stellt sich gerade dann, wenn oben
    # «verbunden» steht.
    klingeln = klingel_satz(
        (letztes_klingeln or (None, None))[0],
        (letztes_klingeln or (None, None))[1],
        jetzt if jetzt is not None else time.time(),
    )
    # Die Hinweise zum Ersatzweg dagegen nur dort, wo es auf ihn ankommt:
    # Solange der Kanal steht, ist er belanglos und wäre nur Lärm.
    ersatz = (
        ersatz_hinweis(ohne_ersatz or []) + verlauf_hinweis(mit_verlauf or []) + klingeln
    )
    if abgeschaltet:
        # Bewusste Entscheidung, keine Störung - deshalb ohne Warnton.
        return (
            f"Ereigniskanal abgeschaltet (events: false) – Klingeln wird "
            f"alle {DING_POLL_SECONDS} s abgefragt.{ersatz}"
        )
    if anlauf:
        # Nach dem Neuladen: Der Kanal braucht ein paar Sekunden. «Nicht
        # verbunden» wäre in diesem Moment wahr und trotzdem irreführend -
        # es sieht aus, als hätte das Neuladen ihn kaputtgemacht.
        return (
            "Ereigniskanal startet gerade – in ein paar Sekunden steht fest, "
            "ob er hält"
        )
    if events_ok:
        if kanal_taub(quellen or []):
            # Der unangenehmste Fall: Alles sieht gut aus, und trotzdem
            # kommt jedes Klingeln zu spät.
            return (
                "Ereigniskanal gemeldet, aber die letzten Klingeln kamen über "
                f"die Abfrage – der Kanal ist taub. Push kommt dadurch bis zu "
                f"{DING_POLL_SECONDS} s zu spät."
                + kanal_zahlen_satz(push_gesamt, push_fremd)
                + ersatz
            )
        return f"Ereigniskanal verbunden – Klingeln kommt sofort an.{klingeln}"
    # Der Grund als eigener Satz, nicht in Klammern: Er enthält oft
    # selbst welche, und «(RuntimeError: … (MCS))» liest niemand.
    grund = ""
    if error:
        # Kein zweiter Punkt hinter einem Fragezeichen.
        schluss = "" if error.rstrip().endswith((".", "!", "?")) else "."
        grund = f"{error.rstrip()}{schluss} "
    if abbrueche > 0:
        # Der Unterschied, auf den es ankommt: «kommt nicht zustande» ist
        # etwas anderes als «kommt zustande und fällt gleich wieder um».
        # Das Zweite sah bisher aus wie ein ewiger Start.
        wie_oft = "einmal" if abbrueche == 1 else f"{abbrueche}-mal"
        return (
            f"Ereigniskanal baut sich auf und bricht wieder ab ({wie_oft}). "
            f"{grund}Klingeln kommt dadurch bis zu {DING_POLL_SECONDS} s zu "
            f"spät.{ersatz}"
        )
    if anlaeufe > 1:
        # Der dritte Fall, und der ehrlichste: Es wird versucht, es
        # klappt nicht, und zwar wiederholt. «Startet gerade» stand hier
        # früher – solange, bis niemand mehr hinsah.
        return (
            f"Ereigniskanal kommt nicht zustande ({anlaeufe} Anläufe). "
            f"{grund}Klingeln wird ersatzweise alle {DING_POLL_SECONDS} s "
            f"abgefragt.{ersatz}"
        )
    return (
        f"Ereigniskanal nicht verbunden. {grund}Klingeln wird ersatzweise "
        f"alle {DING_POLL_SECONDS} s abgefragt.{ersatz}"
    )


def device_state(
    battery: Any, connection: str | None, *, klingel: bool = False
) -> dict[str, Any]:
    """Übersetzt Gerätedaten in Entitäts-Attribute (rein, testbar).

    `klingel` setzt das Feld «ring» von Anfang an auf «off». Das ist kein
    Schönheitsfehler: Ohne den Eintrag gibt es das Feld erst, nachdem es
    zum ersten Mal geklingelt hat - und bis dahin lässt sich kein Ablauf
    darauf bauen, weil weder der Editor noch die Vorlagen es sehen. Wer
    eine Nachricht beim Klingeln einrichten will, müsste also warten, bis
    jemand klingelt.
    """
    state: dict[str, Any] = {
        "state": "offline" if connection == "offline" else "online",
        "motion": "off",
    }
    if klingel:
        state["ring"] = "off"
    if battery is not None:
        try:
            state["battery"] = int(battery)
        except (TypeError, ValueError):
            pass
    return state


def event_fields(kind: str, now: float) -> dict[str, Any]:
    """Übersetzt ein Push-Ereignis in Zustandsfelder (rein, testbar).

    Ring meldet 'ding' (geklingelt) und 'motion' (Bewegung erkannt).
    """
    stamp = datetime.fromtimestamp(now, tz=UTC).isoformat()
    if kind == "ding":
        return {"last_ring": stamp, "ring": "on"}
    if kind == "motion":
        return {"last_motion": stamp, "motion": "on"}
    return {}


class _LogMitschnitt:
    """Fängt für die Dauer eines Anlaufs mit, was eine fremde Bibliothek meldet.

    Die Push-Bibliothek protokolliert den echten Grund – «GCM register
    request attempt 2 out of 2 has failed with Error=PHONE_REGISTRATION_
    ERROR» – und wirft danach eine Ausnahme, in der davon nichts mehr
    steht. Ohne diesen Mitschnitt landet im System-Bildschirm ein
    RuntimeError ohne Aussage, und man sucht die Ursache im falschen
    Haus.

    Bewusst nur während des Anlaufs und mit Obergrenze: ein Horchposten,
    kein zweites Log.
    """

    LIMIT = 8

    def __init__(self, *logger_names: str) -> None:
        # Mehrere Logger, weil der entscheidende Satz mal hier und mal
        # dort steht: «GCM register … PHONE_REGISTRATION_ERROR» kommt aus
        # firebase_messaging, «Unable to checkin to listen service,
        # response was 401 …» aus ring_doorbell selbst. Wer nur einen
        # davon mitschreibt, verliert genau die Hälfte der Fälle.
        self._names = list(logger_names)
        self.zeilen: list[str] = []
        self._handler: Any = None

    def __enter__(self) -> _LogMitschnitt:
        import logging

        sammler = self

        class _Handler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                if len(sammler.zeilen) >= _LogMitschnitt.LIMIT:
                    return
                try:
                    sammler.zeilen.append(record.getMessage())
                except Exception:
                    pass

        self._handler = _Handler(level=logging.WARNING)
        for name in self._names:
            logging.getLogger(name).addHandler(self._handler)
        return self

    def __exit__(self, *_ausnahme: Any) -> None:
        import logging

        if self._handler is not None:
            for name in self._names:
                logging.getLogger(name).removeHandler(self._handler)
            self._handler = None


class RingIntegration(Integration):
    name = "ring"

    # Als Klassenvorgaben, damit health() auch dann antwortet, wenn das
    # Setup unterwegs steckengeblieben ist.
    _events_ok = False
    # Wie oft der Kanal schon aufgebaut wurde und wieder abbrach. Mehr
    # als einmal heisst: Er hält nicht – und dann darf die Anzeige nicht
    # weiter «startet gerade» sagen.
    _abbrueche = 0
    # Auf welchem Weg die letzten Klingeln hereinkamen: «push» oder
    # «abfrage». Ohne das ist «Ereigniskanal verbunden» eine Aussage über
    # die Anmeldung, nicht darüber, ob je etwas durchkommt.
    _quellen: list[str] = []
    # Seit wann der Kanal gerade anläuft - für die Sekunden nach dem
    # Neuladen, in denen «nicht verbunden» wahr und trotzdem irreführend
    # wäre. Nur der allererste Anlauf setzt ihn.
    _anlauf_seit: float | None = None
    # Wie viele Anläufe hintereinander zu keinem tragenden Kanal geführt
    # haben. Der Zähler steht auf 0, sobald einer wirklich stand - und
    # er ist der Grund, warum «startet gerade» irgendwann aufhört.
    _anlaeufe = 0
    # Geräte, die zwar klingeln, die die Ersatz-Abfrage aber nicht sieht -
    # die Gegensprechanlage. Als Klassenvorgabe, damit health() auch dann
    # antwortet, wenn setup() unterwegs steckengeblieben ist.
    _ohne_ersatz: list[str] = []
    _last_event: float | None = None
    _listen_error: str | None = None
    _listener: Any = None
    # Wurde die gespeicherte Push-Anmeldung in diesem Lauf schon einmal
    # verworfen? Ein zweites Mal brächte nichts als Last für Google.
    _neu_registriert = False

    async def setup(self) -> None:
        try:
            import ring_doorbell  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "ring-doorbell fehlt – installieren mit: pip install ring-doorbell"
            ) from err

        self._token_file = tokenstore.token_file(
            self.hub.config.data_file, self.config, "ring"
        )
        stored = tokenstore.load(self._token_file)
        if stored is None:
            raise ConfigError(
                f"{self._token_file} fehlt oder ist unlesbar – einmalig anmelden mit: "
                "docker exec -it homepilot-hub python -m "
                "homepilot.integrations.ring -c /config/config.yaml"
            )
        self._stored = stored

        from ring_doorbell import Auth, Ring

        self._auth = Auth(
            USER_AGENT,
            token=self._stored.get("token"),
            token_updater=lambda token: self._save("token", token),
            http_client_session=self.http_session(),
        )
        self._ring = Ring(self._auth)
        await self._ring.async_create_session()
        await self._ring.async_update_devices()

        # Entity-ID → Ring-Geräteobjekt; Ring-Geräte-ID → Entity-ID
        self._devices: dict[str, Any] = {}
        # Eigene Liste je Lauf, nicht die der Klasse: Sonst sammelt ein
        # Neuladen dieselben Namen ein zweites Mal ein.
        self._ohne_ersatz: list[str] = []
        # Gegensprechanlagen und ihre Entität: Für sie wird der Verlauf
        # abgefragt, weil `dings/active` sie nicht kennt.
        self._intercoms: list[tuple[str, Any]] = []
        # Welche Verlaufseinträge schon gesehen wurden - sonst käme
        # dasselbe Klingeln alle fünf Sekunden erneut.
        self._verlauf_gesehen: set[Any] = set()
        # Wann zuletzt geklingelt hat und auf welchem Weg es hereinkam.
        self._letztes_klingeln: tuple[float, str] | None = None
        # Je Gerät der Zeitpunkt des letzten Klingelns - die Entprellung
        # über alle Wege hinweg (siehe ist_wiederholung).
        self._klingel_zeiten: dict[str, float] = {}
        # Wie viel über den Kanal hereinkam - und wie viel davon zu
        # keinem bekannten Gerät gehörte.
        self._push_gesamt = 0
        self._push_fremd = 0
        # Ob der fehlgeschlagene Verlauf schon einmal laut gemeldet wurde.
        self._verlauf_gemeldet = False
        self._by_ring_id: dict[int, str] = {}
        self._clear_tasks: dict[str, asyncio.Task] = {}

        devices = self._ring.devices()
        klingeln = {int(device.id) for device in devices.doorbells}
        for device in list(devices.doorbells) + list(devices.stickup_cams):
            entity = await self.add_entity(
                str(device.id),
                EntityKind.CAMERA,
                device.name,
                state=device_state(
                    device.battery_life,
                    device.connection_status,
                    klingel=int(device.id) in klingeln,
                ),
                commands=[],
            )
            self._devices[entity.id] = device
            self._by_ring_id[int(device.id)] = entity.id

        # Ring Intercom: Gegensprechanlage mit Türöffner. Eigene Geräteart
        # 'lock' – für Gäste ohne explizite Freigabe unsichtbar.
        for device in list(getattr(devices, "other", []) or []):
            if not hasattr(device, "async_open_door"):
                continue
            entity = await self.add_entity(
                str(device.id),
                EntityKind.LOCK,
                device.name or "Türöffner",
                # Eine Gegensprechanlage klingelt ebenfalls - und zwar an
                # genau der Türe, an der man es wissen will.
                state=device_state(
                    device.battery_life, device.connection_status, klingel=True
                ),
                commands=["open_door"],
            )
            self._devices[entity.id] = device
            self._by_ring_id[int(device.id)] = entity.id
            # Sie taucht in der Liste der aktiven Meldungen nicht auf -
            # für sie wird stattdessen der Verlauf abgefragt. Ohne
            # Verlauf (ältere Bibliothek) bleibt sie ohne Netz, und das
            # gehört in den System-Bildschirm; der Name statt der
            # Kennung, dort steht sonst eine Zahl.
            if hasattr(device, "async_history") or hasattr(device, "history"):
                self._intercoms.append((entity.id, device))
            else:
                self._ohne_ersatz.append(entity.name)

        if not self._devices:
            self.log.warning("Ring-Konto verbunden, aber keine Geräte gefunden")

        self._seen_alerts: dict[tuple[int, int, str], float] = {}
        self._listener: Any = None
        # events: false heisst: den Push-Weg (Google/FCM) gar nicht erst
        # versuchen - die Abfrage unten ist dann der Hauptweg, keine
        # Rückfallebene.
        self._events_abgeschaltet = self.config.get("events") is False
        self.start_polling(self._refresh_devices)
        if not self._events_abgeschaltet:
            self.start_task(self._listen_loop())
        else:
            self.log.info(
                "Ring-Ereigniskanal per Konfiguration abgeschaltet - "
                "Klingeln wird alle %ss abgefragt",
                DING_POLL_SECONDS,
            )
        self.start_task(self._ding_loop())
        if self._intercoms:
            self.start_task(self._intercom_loop())

    async def _intercom_loop(self) -> None:
        """Den Verlauf der Gegensprechanlage abfragen.

        Sie hängt in Rings API an einer eigenen Adressfamilie und taucht
        in der Liste der aktiven Meldungen nicht auf. Bisher hiess das:
        Fällt der Ereigniskanal aus, kommt von ihr gar nichts - kein
        verspätetes Klingeln, sondern gar keines. Und weil an dieser
        Klingel die Haustüre hängt, war das die Klingel, auf die es
        ankommt.

        Der Verlauf ist der Weg, der bleibt. Er kostet einen Aufruf alle
        paar Sekunden; was der Push-Kanal schon gebracht hat, wird nicht
        doppelt gemeldet.
        """
        # Beim ersten Durchgang nur nachsehen, was schon dasteht, und es
        # als gesehen vormerken: Sonst löste der Hub-Start eine Nachricht
        # über das letzte Klingeln aus.
        erster = True
        while True:
            for _entity_id, device in self._intercoms:
                try:
                    verlauf = await self._verlauf_holen(device)
                except asyncio.CancelledError:
                    raise
                except Exception as err:
                    # Einmal laut, danach leise. Auf debug war das der
                    # blinde Fleck: Der Verlauf ist für die
                    # Gegensprechanlage der einzige schnelle Weg - klappt
                    # er nicht, bleibt nur die Abfrage, und niemand
                    # erfuhr davon.
                    melden = (
                        self.log.warning
                        if not self._verlauf_gemeldet
                        else self.log.debug
                    )
                    self._verlauf_gemeldet = True
                    melden(
                        "Ring: Verlauf von %s nicht abrufbar (%s) - das "
                        "Klingeln kommt dann nur über die Abfrage",
                        entity_id,
                        err,
                    )
                    continue
                self._verlauf_gemeldet = False
                frisch, self._verlauf_gesehen = verlauf_dings(
                    verlauf,
                    self._verlauf_gesehen,
                    time.time(),
                    0.0 if erster else INTERCOM_FRIST,
                )
                for eintrag in frisch:
                    await self._handle_event(
                        _VerlaufEreignis(
                            doorbot_id=int(device.id),
                            id=eintrag["id"],
                            now=eintrag["now"],
                        ),
                        quelle="verlauf",
                    )
            erster = False
            await asyncio.sleep(INTERCOM_POLL_SECONDS)

    @staticmethod
    async def _verlauf_holen(device: Any) -> Any:
        """Den Verlauf holen, egal wie die Bibliothek ihn anbietet."""
        holen = getattr(device, "async_history", None)
        if holen is not None:
            return await holen(limit=5)
        return device.history(limit=5)

    def _verlauf_namen(self) -> list[str]:
        """Die Geräte, für die der Verlauf einspringt - mit Klarnamen."""
        namen = []
        # getattr: health() wird auch an einer Integration gefragt, deren
        # setup() nie durchlief - etwa wenn die Anmeldung scheiterte.
        # Dann gibt es keine Geräte, und das ist die richtige Antwort.
        for entity_id, _ in getattr(self, "_intercoms", []):
            entity = self.hub.registry.get(entity_id)
            namen.append(entity.name if entity else entity_id)
        return namen

    def health(self) -> dict[str, Any]:
        """Steht der schnelle Weg? Das ist hier die ganze Frage.

        Ohne diese Auskunft ist ein toter Ereigniskanal von aussen nicht
        von «es hat halt niemand geklingelt» zu unterscheiden.
        """
        if self._events_abgeschaltet:
            return {
                "ok": True,
                "detail": health_detail(
                    False,
                    None,
                    abgeschaltet=True,
                    ohne_ersatz=self._ohne_ersatz,
                    mit_verlauf=self._verlauf_namen(),
                    letztes_klingeln=self._letztes_klingeln,
                ),
                "last_event": self._last_event,
            }
        # «Startet gerade» gilt nur für den allerersten Anlauf, und auch
        # da nur, solange er wirklich läuft. Vorher setzte ihn jeder
        # neue Versuch zurück, und ein Kanal, der im Kreis lief, sah für
        # immer aus wie einer, der gerade hochkommt – genau daran war
        # die Störung von aussen nicht zu sehen.
        anlauf = (
            self._anlaeufe == 0
            and self._abbrueche == 0
            and self._anlauf_seit is not None
            and time.time() - self._anlauf_seit < STARTUP_GRACE_SECONDS + 10
        )
        taub = self._events_ok and kanal_taub(self._quellen)
        return {
            # Taub heisst nicht in Ordnung: Sonst steht der Haken neben
            # einem Kanal, über den nichts kommt.
            "ok": (self._events_ok and not taub) or anlauf,
            "detail": health_detail(
                self._events_ok,
                self._listen_error,
                anlauf=anlauf,
                quellen=self._quellen,
                abbrueche=self._abbrueche,
                anlaeufe=self._anlaeufe,
                ohne_ersatz=self._ohne_ersatz,
                mit_verlauf=self._verlauf_namen(),
                letztes_klingeln=getattr(self, "_letztes_klingeln", None),
                push_gesamt=getattr(self, "_push_gesamt", 0),
                push_fremd=getattr(self, "_push_fremd", 0),
            ),
            "last_event": self._last_event,
            # Für die Ferndiagnose: der Weg der letzten Meldungen.
            "quellen": list(self._quellen[-QUELLEN_FENSTER:]),
        }

    async def teardown(self) -> None:
        await self._stop_listener()
        self._events_ok = False
        await super().teardown()

    def _save(self, key: str, value: dict[str, Any]) -> None:
        """Aufgefrischte Tokens sofort sichern, sonst sperrt Ring den Zugang aus."""
        self._stored[key] = value
        tokenstore.save(self._token_file, self._stored)

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _refresh_devices(self) -> None:
        await self._ring.async_update_devices()
        devices = self._ring.devices()
        for entity_id, old in list(self._devices.items()):
            device = devices.get_device(int(old.id))
            self._devices[entity_id] = device
            await self.hub.registry.update_state(
                entity_id,
                device_state(device.battery_life, device.connection_status),
                available=True,
            )

    async def _listen_loop(self) -> None:
        """Den Ereigniskanal offenhalten – nicht nur einmal anklopfen.

        Vorher gab es genau einen Anlauf beim Start. Fiel der aus - Ring
        gerade schlecht gelaunt, das Netz noch nicht da -, blieb die
        Klingel für immer stumm, und im Log stand eine Zeile, die man
        Wochen später sucht. Jetzt versucht es der Hub weiter und merkt
        auch, wenn der Kanal später abreisst.

        Drei Ausgänge, und der Unterschied zwischen ihnen ist die ganze
        Auskunft, die im System-Bildschirm steht:

        * Der Anlauf misslingt – Ring oder Google weisen ab.
        * Der Anlauf gelingt, aber die Dauerverbindung kommt nie
          zustande. Das ist der Fall, der von aussen wie ein ewiger
          Start aussah: `start()` meldet Erfolg, sobald die Anmeldung
          durch ist, und darunter wartet der Push-Client vergeblich auf
          mtalk.google.com:5228.
        * Der Kanal steht wirklich und bricht später ab.
        """
        loop = asyncio.get_running_loop()

        def on_event(event: Any) -> None:
            asyncio.run_coroutine_threadsafe(self._handle_event(event), loop)

        versuch = 0
        while True:
            # «Startet gerade» darf nur der allererste Anlauf sagen.
            # Vorher setzte ihn jede Runde neu - und ein Kanal, der im
            # Kreis lief, sah für immer aus wie einer, der gerade
            # hochkommt. Genau das stand wochenlang im Bildschirm.
            erster = self._anlaeufe == 0 and self._abbrueche == 0
            self._anlauf_seit = time.time() if erster else None
            # Der Mitschnitt läuft über den ganzen Anlauf, nicht nur über
            # das Anmelden: Der Satz, der den zweiten Fall erklärt, fällt
            # erst in den Sekunden danach.
            mitschnitt = _LogMitschnitt(*PUSH_LOGGER)
            with mitschnitt:
                gestartet = await self._start_listener(on_event, mitschnitt)
                if gestartet:
                    # Anlaufzeit, bevor geurteilt wird: start() kehrt
                    # zurück, sobald die Anmeldung durch ist - der
                    # Push-Client darunter meldet sich erst ein paar
                    # Sekunden später als «läuft». Ohne diese Pause galt
                    # jeder frisch aufgebaute Kanal sofort als tot, und
                    # der Hub registrierte sich im Sekundentakt neu bei
                    # Google, bis der es abwies.
                    await asyncio.sleep(STARTUP_GRACE_SECONDS)
                    self._anlauf_seit = None
                    stand = await self._kanal_begleiten()
                    await self._stop_listener()
                    if stand:
                        self._abbrueche += 1
                        self._listen_error = "Verbindung abgerissen"
                        self.log.warning(
                            "Ring-Ereigniskanal abgerissen – neuer Anlauf"
                        )
                        # Er hielt ja eine Weile: Der nächste Anlauf darf
                        # wieder mit der kurzen Pause beginnen.
                        versuch = 0
                    else:
                        self._anlaeufe += 1
                        self._listen_error = await self._warum_stumm(mitschnitt)
                        self._vielleicht_neu_registrieren()
                        melden = (
                            self.log.warning
                            if self._anlaeufe == 1
                            else self.log.debug
                        )
                        melden(
                            "Ring-Ereigniskanal angemeldet, aber ohne "
                            "Dauerverbindung (%s) – Klingeln kommt "
                            "ersatzweise über die Abfrage alle %ss",
                            self._listen_error,
                            DING_POLL_SECONDS,
                        )
                else:
                    self._anlauf_seit = None
                    self._anlaeufe += 1
                    # Einmal laut, danach leise: Eine Störung, die eine
                    # Stunde dauert, soll das Log nicht füllen. Sichtbar
                    # bleibt sie über health() im System-Bildschirm.
                    melden = (
                        self.log.warning
                        if self._anlaeufe == 1
                        else self.log.debug
                    )
                    melden(
                        "Ring-Ereigniskanal nicht verfügbar (%s) – Klingeln "
                        "kommt ersatzweise über die Abfrage alle %ss",
                        self._listen_error or "Grund unbekannt",
                        DING_POLL_SECONDS,
                    )
                versuch += 1
            # Ausserhalb des Mitschnitts warten: Er ist ein Horchposten
            # für den Anlauf, kein zweites Log - und seine acht Zeilen
            # sollen die des Anlaufs sein, nicht die der Wartezeit.
            await asyncio.sleep(retry_delay(versuch))

    async def _kanal_begleiten(self) -> bool:
        """Den aufgebauten Kanal beobachten, bis er nicht mehr trägt.

        Rückgabe: ob er überhaupt je wirklich stand. Das ist der
        Unterschied, der vorher fehlte - `start()` meldet Erfolg, sobald
        die Anmeldung durch ist, und «angemeldet» ist noch lange nicht
        «eingeloggt». Erst wenn der Push-Client darunter `is_started()`
        sagt, hat er seine Dauerverbindung zu Google und kann etwas
        ausliefern. Bis dahin ist «Ereigniskanal verbunden» eine Aussage
        über ein Formular, nicht über eine Türklingel.

        Drei tote Blicke hintereinander, nicht einer: Eine FCM-
        Verbindung baut sich von selbst neu auf, und währenddessen sagt
        der Empfänger «nicht gestartet», obwohl alles in Ordnung ist.
        """
        stand = False
        steht_seit: float | None = None
        tot = 0
        while tot < TOT_BESTAETIGUNGEN:
            if channel_alive(self._listener):
                if not stand:
                    stand = True
                    steht_seit = time.time()
                    self._events_ok = True
                    self._listen_error = None
                    self._anlaeufe = 0
                    self.log.info(
                        "Ring-Ereigniskanal steht – Klingeln kommt sofort an"
                    )
                elif tot:
                    self.log.debug(
                        "Ring-Ereigniskanal war kurz weg und ist wieder da"
                    )
                tot = 0
                # Ein Kanal, der steht und über den nie etwas kommt, ist
                # meistens einer, dem ein anderes Programm die Anmeldung
                # weggenommen hat - Ring merkt sich einen Empfänger je
                # Konto. Sich wieder vorne anstellen ist das Einzige, was
                # hilft, und das geschieht über einen frischen Anlauf.
                if anmeldung_erneuern(
                    steht_seit, getattr(self, "_push_gesamt", 0), time.time()
                ):
                    self.log.warning(
                        "Ring-Ereigniskanal steht seit einer halben Stunde, "
                        "ohne dass je etwas kam – die Anmeldung wird erneuert. "
                        "Meldet sich ein zweites Programm mit demselben "
                        "Ring-Konto an (eine laufende Home-Assistant-Instanz "
                        "etwa), nimmt es sie wieder weg."
                    )
                    self._events_ok = False
                    return True
            else:
                tot += 1
            await asyncio.sleep(KANAL_BLICK_SECONDS)
        self._events_ok = False
        return stand

    async def _warum_stumm(self, mitschnitt: _LogMitschnitt) -> str:
        """Angemeldet, aber keine Dauerverbindung – woran liegt es?

        Der wahrscheinlichste Grund ist ein gesperrter Weg: Die
        Anmeldung läuft über HTTPS und kommt durch jede Firewall, die
        Dauerverbindung dagegen über mtalk.google.com:5228, und genau
        dieser Port steht in vielen Heimnetzen auf der Sperrliste, ohne
        dass irgendwo «Türklingel» steht.
        """
        erreichbar = await self._reachable()
        if any(wert is False for wert in erreichbar.values()):
            return push_diagnose(erreichbar, mitschnitt.zeilen)
        for zeile in reversed(mitschnitt.zeilen):
            sauber = zeile.strip()
            if sauber:
                return sauber
        return (
            "die Anmeldung ging durch, die Dauerverbindung zu "
            "mtalk.google.com:5228 kam nicht zustande"
        )

    def _vielleicht_neu_registrieren(self) -> None:
        """Eine gespeicherte Push-Anmeldung, die nie trägt, wegwerfen.

        Das ist die Handschrift einer beschädigten Anmeldung
        («Incorrect padding» aus firebase_messaging): Das Anmelden
        gelingt, die Verbindung kommt nie zustande, und mit derselben
        Anmeldung geht es beim nächsten Mal genauso aus.

        Aber genau einmal je Lauf: Trägt auch die frische Anmeldung
        nicht, liegt es nicht an ihr, und jede weitere Registrierung
        wäre nur eine Anfrage mehr an einen Dienst, der ohnehin gerade
        abweist.
        """
        if self._neu_registriert or not self._stored.get("listener"):
            return
        self._neu_registriert = True
        self.log.warning(
            "Ring-Push-Anmeldung trägt nicht – sie wird verworfen und beim "
            "nächsten Anlauf neu registriert"
        )
        self._stored.pop("listener", None)
        self._save("listener", None)

    async def _start_listener(
        self, on_event: Any, mitschnitt: _LogMitschnitt
    ) -> bool:
        """Ein Anlauf, notfalls mit frischer Credential; True bei Erfolg.

        Der Mitschnitt kommt von aussen und läuft weiter, wenn diese
        Methode zurückkehrt: Was die Bibliotheken zu sagen haben, sagen
        sie zum Teil erst in den Sekunden danach.
        """
        # Erster Versuch mit der gespeicherten Credential. Ist sie
        # beschädigt (z.B. 'Incorrect padding' aus firebase_messaging
        # beim Dekodieren eines alten Eintrags), verwerfen und einmal
        # frisch registrieren.
        erfolg = await self._try_listen(on_event, self._stored.get("listener"))
        if not erfolg and self._stored.get("listener") is not None:
            self.log.warning(
                "Ring-Push-Credential unbrauchbar – wird verworfen und neu registriert"
            )
            self._neu_registriert = True
            self._stored.pop("listener", None)
            self._save("listener", None)
            erfolg = await self._try_listen(on_event, None)
        if erfolg or not self._listen_error:
            return erfolg
        # Erst jetzt nachsehen, ob der Weg überhaupt offen ist – und
        # einmal je Runde, nicht je Anlauf: Sonst sind es sechs
        # Verbindungen für dieselbe Auskunft.
        erreichbar = await self._reachable()
        self._listen_error = push_diagnose(erreichbar, mitschnitt.zeilen)
        return False

    async def _stop_listener(self) -> None:
        listener, self._listener = self._listener, None
        if listener is None:
            return
        try:
            await listener.stop()
        except Exception:
            pass

    async def _reachable(self) -> dict[str, bool]:
        """Kommt der Hub überhaupt an Googles Push-Adressen? (nur bei Fehlschlag)

        Ein reiner TCP-Verbindungsversuch, kein Handschlag: Es geht um
        «ist der Weg offen», nicht um «funktioniert der Dienst».
        """
        ergebnis: dict[str, bool] = {}
        for host, port, _zweck in PUSH_ENDPOINTS:
            try:
                verbindung = asyncio.open_connection(host, port)
                reader, writer = await asyncio.wait_for(verbindung, REACH_TIMEOUT)
                del reader
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
                ergebnis[host] = True
            except asyncio.CancelledError:
                raise
            except Exception:
                ergebnis[host] = False
        return ergebnis

    async def _try_listen(self, on_event: Any, credentials: Any) -> bool:
        """Ereigniskanal mit gegebener Credential starten; True bei Erfolg."""
        listener = None
        try:
            from ring_doorbell import RingEventListener

            listener = RingEventListener(
                self._ring,
                credentials=credentials,
                credentials_updated_callback=lambda creds: self._save("listener", creds),
            )
            if not await listener.start():
                # start() meldet False, wenn Ring die Anmeldung abweist -
                # der Grund steht dann im Log von ring_doorbell selbst.
                self._listen_error = "Anmeldung beim Push-Dienst abgelehnt"
                return False
            listener.add_notification_callback(on_event)
            self._listener = listener
            # Bewusst noch kein `_events_ok`: start() meldet Erfolg,
            # sobald die Anmeldung durch ist. Ob darunter je eine
            # Dauerverbindung zustande kommt, entscheidet sich erst in
            # den nächsten Sekunden – und genau das prüft
            # _kanal_begleiten. Vorher stand hier «Klingeln kommt sofort
            # an», während es über die Abfrage zehn Sekunden zu spät kam.
            self.log.info("Ring-Push-Anmeldung durch – Kanal baut sich auf")
            return True
        except asyncio.CancelledError:
            raise
        except Exception as err:
            self._listen_error = f"{err.__class__.__name__}: {err}" if str(err) else err.__class__.__name__
            if listener is not None:
                try:
                    await listener.stop()
                except Exception:
                    pass
            return False

    async def _ding_loop(self) -> None:
        """Aktive Meldungen selbst abfragen – der zweite Weg zur Klingel.

        Er kostet einen Aufruf und macht den Unterschied zwischen «die
        Klingel geht nicht» und «die Klingel geht ein paar Sekunden
        später». Was der Push-Kanal schon gebracht hat, erkennt
        new_alerts wieder; es wird kein zweites Mal gemeldet.
        """
        while True:
            await asyncio.sleep(
                abfrage_takt(self._events_ok, self._quellen, self._push_gesamt)
            )
            if not self._devices:
                continue
            try:
                await self._ring.async_update_dings()
                frisch, self._seen_alerts = new_alerts(
                    list(self._ring.active_alerts()), self._seen_alerts, time.time()
                )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Ring-Meldungen nicht abrufbar: %s", err)
                continue
            for event in frisch:
                await self._handle_event(event, quelle="abfrage")

    async def _handle_event(self, event: Any, quelle: str = "push") -> None:
        if quelle == "push":
            # Zählen, bevor irgendetwas den Weg abbrechen kann. Ein
            # stiller Kanal und ein Kanal, dessen Meldungen der Hub
            # wegwirft, sehen von aussen gleich aus - und führen zu ganz
            # verschiedenen nächsten Schritten.
            self._push_gesamt += 1
        try:
            ring_id = int(event.doorbot_id)
        except (TypeError, ValueError):
            if quelle == "push":
                self._push_fremd += 1
                self.log.warning(
                    "Ring: Meldung über den Kanal ohne brauchbare Geräte-Kennung "
                    "(%s) - übergangen",
                    getattr(event, "kind", "?"),
                )
            return
        entity_id = self._by_ring_id.get(ring_id)
        if entity_id is None:
            if quelle == "push":
                self._push_fremd += 1
                # Genau hier verschwand bisher lautlos, was der Kanal
                # lieferte: Ein Gerät, das der Hub nicht kennt, war
                # nicht von «es kam nichts» zu unterscheiden.
                self.log.warning(
                    "Ring: Meldung über den Kanal für Gerät %s (%s) - der Hub "
                    "kennt dieses Gerät nicht, bekannt sind %s",
                    ring_id,
                    getattr(event, "kind", "?"),
                    sorted(self._by_ring_id) or "keine",
                )
            return
        fields = event_fields(event.kind, event.now or time.time())
        if not fields:
            return
        # Auch was über den Push-Kanal kam, vormerken: Sonst holt die
        # Abfrage dieselbe Meldung gleich noch einmal aus der Liste.
        try:
            self._seen_alerts[alert_key(event)] = float(
                getattr(event, "now", None) or time.time()
            ) + float(getattr(event, "expires_in", None) or 60)
        except (TypeError, ValueError, AttributeError):
            pass
        self._last_event = time.time()
        # Nur Klingeln zählt fürs Urteil: Bewegung meldet Ring ohnehin
        # unregelmässig, und ein verpasster Bewegungs-Push ist kein
        # Beinbruch. Beim Klingeln ist er einer.
        if event.kind == "ding":
            # Der Zeitpunkt des Klingelns, nicht der des Eintreffens:
            # Über die Abfrage kommt dieselbe Klingel eine halbe Minute
            # später an als über den Verlauf, trägt aber denselben
            # Stempel.
            jetzt = ding_zeit(event, time.time())
            if ist_wiederholung(self._klingel_zeiten.get(entity_id), jetzt):
                # Dasselbe Klingeln auf einem zweiten Weg. Der Zustand
                # steht schon richtig; weiterzumachen hiesse, dem Haus
                # ein zweites Mal zu sagen, dass es klingelt.
                self.log.debug(
                    "Ring: Klingeln an %s kam ein zweites Mal (%s) - übergangen",
                    entity_id,
                    quelle,
                )
                return
            self._klingel_zeiten[entity_id] = jetzt
            self._quellen = [*self._quellen, quelle][-QUELLEN_FENSTER * 2 :]
            # Für den System-Bildschirm: Hat der Hub überhaupt gehört,
            # dass es geklingelt hat? Ohne diese Auskunft ist «es kommt
            # keine Nachricht» nicht davon zu unterscheiden, dass sie
            # niemand verschickt.
            self._letztes_klingeln = (time.time(), quelle)
            if quelle != "push":
                self.log.info(
                    "Ring: Klingeln kam über die Abfrage, nicht über den "
                    "Ereigniskanal - dadurch bis zu %s s später",
                    DING_POLL_SECONDS,
                )
        await self.hub.registry.update_state(entity_id, fields, available=True)

        # 'Bewegung'/'Klingelt' nach Ablauf wieder löschen, damit die Kachel
        # nicht dauerhaft leuchtet.
        flag = "motion" if event.kind == "motion" else "ring"
        old = self._clear_tasks.pop(f"{entity_id}:{flag}", None)
        if old:
            old.cancel()
        delay = min(float(event.expires_in or 60), 300)
        self._clear_tasks[f"{entity_id}:{flag}"] = self.start_task(
            self._clear_flag(entity_id, flag, delay)
        )

    async def _clear_flag(self, entity_id: str, flag: str, delay: float) -> None:
        await asyncio.sleep(delay)
        await self.hub.registry.update_state(entity_id, {flag: "off"})

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Any, command: str, data: dict[str, Any]) -> None:
        device = self._devices.get(entity.id)
        if device is None or command != "open_door":
            raise ConfigError(f"Kommando '{command}' gibt es hier nicht")
        ok = await device.async_open_door()
        if not ok:
            raise ConnectionError("Ring hat das Öffnen abgelehnt")
        self.log.info("Tür geöffnet über %s", entity.name)
        # Kurze Rückmeldung auf der Kachel, dann zurück zum Ruhezustand.
        await self.hub.registry.update_state(
            entity.id,
            {"state": "opened", "last_opened": datetime.now(UTC).isoformat()},
        )
        old = self._clear_tasks.pop(f"{entity.id}:opened", None)
        if old:
            old.cancel()
        self._clear_tasks[f"{entity.id}:opened"] = self.start_task(
            self._close_again(entity.id)
        )

    async def _close_again(self, entity_id: str) -> None:
        await asyncio.sleep(5)
        await self.hub.registry.update_state(entity_id, {"state": "online"})

    async def snapshot(self, entity: Any) -> bytes | None:
        device = self._devices.get(entity.id)
        if device is None:
            return None
        try:
            # Stösst bei Ring einen frischen Schnappschuss an – das dauert
            # ein paar Sekunden, dafür ist das Bild aktuell.
            return await device.async_get_snapshot()
        except Exception as err:
            self.log.debug("Ring-Schnappschuss fehlgeschlagen: %s", err)
            return None


INTEGRATION = RingIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  docker exec -it homepilot-hub \
#              python -m homepilot.integrations.ring -c /config/config.yaml
# Fragt E-Mail, Passwort und den 2FA-Code ab und legt das Token dorthin,
# wo der Hub es liest. Das Passwort wird nicht gespeichert.


async def _login_main(config_path: str) -> int:
    import getpass

    from ring_doorbell import Auth, Requires2FAError

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "ring"
    )

    username = input("Ring-E-Mail: ").strip()
    password = getpass.getpass("Ring-Passwort: ")

    auth = Auth(USER_AGENT)
    try:
        try:
            token = await auth.async_fetch_token(username, password)
        except Requires2FAError:
            code = input("2FA-Code (per Mail/SMS zugestellt): ").strip()
            token = await auth.async_fetch_token(username, password, code)
    except Exception as err:
        print(f"✗ Anmeldung fehlgeschlagen: {err}")
        return 1
    finally:
        await auth.async_close()

    tokenstore.save(token_file, {"token": token})
    print(f"✓ Angemeldet. Token liegt in {token_file} – jetzt den Hub starten.")
    return 0


async def _horchen_main(config_path: str, sekunden: int) -> int:
    """Zeigen, was Rings Wolke beim Klingeln überhaupt hergibt.

    Aufruf:  docker exec homepilot-hub \
                 python -m homepilot.integrations.ring -c /config/config.yaml \
                 --klingeln 60

    Der Unterschied zu --diagnose: Hier wird nichts angemeldet und
    nichts weggenommen. Es wird nur gefragt - dieselben zwei Fragen, die
    der Hub im Betrieb stellt, und die Antworten roh ausgegeben. Der
    laufende Hub merkt davon nichts.

    Damit ist entscheidbar, was «es kommt nichts an» heisst: Steht das
    Klingeln in diesen Antworten, hört Ring es und der Hub verarbeitet es
    falsch. Steht es nicht darin, weiss Rings Wolke selbst nichts davon -
    dann liegt es am Konto oder am Gerät, und keine Zeile Code hilft.
    """
    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "ring"
    )
    stored = tokenstore.load(token_file)
    if stored is None:
        print(f"Kein Token in {token_file} – zuerst anmelden.")
        return 1

    from ring_doorbell import Auth, Ring

    auth = Auth(USER_AGENT, token=stored.get("token"))
    ring = Ring(auth)
    try:
        await ring.async_create_session()
        await ring.async_update_devices()
        geraete = ring.devices()
        alle = (
            list(geraete.doorbells)
            + list(geraete.stickup_cams)
            + list(getattr(geraete, "other", []) or [])
        )
        if not alle:
            print("✗ Dieses Konto sieht kein einziges Ring-Gerät.")
            print("  Beim geteilten Benutzer: Ist das Gerät wirklich freigegeben?")
            return 1
        print("Geräte, die dieses Konto sieht:")
        for geraet in alle:
            print(f"  · {geraet.name} (Kennung {geraet.id}, Art {geraet.kind})")

        print(f"\nJetzt klingeln. Ich schaue {sekunden} s lang zu …")
        gesehen: set[Any] = set()
        etwas = False
        for durchgang in range(max(1, sekunden // 3)):
            await asyncio.sleep(3)
            # 1. Die aktiven Meldungen - der Weg, den der Hub «Abfrage» nennt.
            try:
                await ring.async_update_dings()
                for alarm in ring.active_alerts():
                    schluessel = ("alarm", getattr(alarm, "id", None))
                    if schluessel in gesehen:
                        continue
                    gesehen.add(schluessel)
                    etwas = True
                    print(
                        f"  [Abfrage] {getattr(alarm, 'kind', '?')} von "
                        f"{getattr(alarm, 'doorbot_id', '?')} "
                        f"({getattr(alarm, 'device_name', '?')})"
                    )
            except Exception as err:
                if durchgang == 0:
                    print(f"  ⚠ Aktive Meldungen nicht abrufbar: {err}")
            # 2. Der Verlauf - der Weg für die Gegensprechanlage.
            for geraet in alle:
                holen = getattr(geraet, "async_history", None)
                if holen is None:
                    continue
                try:
                    verlauf = await holen(limit=3)
                except Exception as err:
                    if durchgang == 0:
                        print(f"  ⚠ Verlauf von {geraet.name} nicht abrufbar: {err}")
                    continue
                for eintrag in verlauf or []:
                    schluessel = ("verlauf", _feld(eintrag, "id"))
                    if schluessel in gesehen:
                        continue
                    gesehen.add(schluessel)
                    if durchgang == 0:
                        # Der erste Durchgang zeigt, was schon dastand -
                        # das ist Geschichte, nicht das Klingeln von eben.
                        continue
                    etwas = True
                    print(
                        f"  [Verlauf] {_feld(eintrag, 'kind')} an {geraet.name} "
                        f"um {_feld(eintrag, 'created_at')}"
                    )
        if etwas:
            print("\n✓ Rings Wolke kennt das Klingeln. Der Hub muss es also")
            print("  verarbeiten können - schick mir diese Ausgabe.")
            return 0
        print("\n✗ In diesen Sekunden kam bei Ring nichts an.")
        print("  Weder in den aktiven Meldungen noch im Verlauf. Das heisst:")
        print("  Rings Wolke weiss selbst nichts von diesem Klingeln - dann")
        print("  liegt es am Konto (Freigabe, Benachrichtigungen) oder am")
        print("  Gerät, und nicht am Hub.")
        return 1
    finally:
        await auth.async_close()


async def _diagnose_main(config_path: str) -> int:
    """Warum kommt der Ereigniskanal nicht zustande?

    Aufruf:  docker exec homepilot-hub \
                 python -m homepilot.integrations.ring -c /config/config.yaml --diagnose

    Der System-Bildschirm sagt, *dass* es klemmt; hier steht, *woran*.
    Zwei Teile: Kommt der Rechner an Googles Adressen heran, und was
    antwortet Google auf einen echten Anmeldeversuch.
    """
    import logging

    from ..core.config import load_config

    logging.basicConfig(level=logging.WARNING, format="  %(name)s: %(message)s")

    # Wo gemessen wird, gehört dazu: Im Container gelten andere Regeln
    # als auf dem Docker-Host, und wer auf dem Host misst, misst das
    # falsche Netz - dann sieht alles offen aus und der Hub kommt
    # trotzdem nicht durch.
    import socket

    print(f"Gemessen von: {socket.gethostname()}")
    print("Erreichbarkeit der Push-Adressen (Google, nicht Ring):")
    erreichbar: dict[str, bool] = {}
    for host, port, zweck in PUSH_ENDPOINTS:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), REACH_TIMEOUT
            )
            del reader
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            erreichbar[host] = True
            print(f"  ✓ {host}:{port} – {zweck}")
        except Exception as err:
            erreichbar[host] = False
            print(f"  ✗ {host}:{port} – {zweck} ({err.__class__.__name__})")

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "ring"
    )
    stored = tokenstore.load(token_file)
    if stored is None:
        print(f"\nKein Token in {token_file} – zuerst anmelden (ohne --diagnose).")
        return 1

    # Ohne gespeicherte Push-Anmeldung würde die Bibliothek hier eine
    # neue registrieren - eine Wegwerf-Anmeldung, die nirgends landet.
    # Genau davon wird PHONE_REGISTRATION_ERROR ausgelöst, und wer bei
    # einer Störung fünfmal die Diagnose laufen lässt, erzeugt damit die
    # Krankheit, die er sucht. Also nicht.
    if stored.get("listener") is None:
        print(
            "\nKeine Push-Anmeldung gespeichert – hier wird bewusst keine "
            "angelegt.\nDer Hub registriert sich beim nächsten Anlauf selbst; "
            "jede Anmeldung von Hand\nist eine Anfrage mehr an einen Dienst, "
            "der bei Problemen ohnehin abweist."
        )
        if all(erreichbar.values()):
            print("→ Der Weg ist offen. Hub neu starten und das Protokoll ansehen.")
            return 0
        print(f"→ {push_diagnose(erreichbar, [])}")
        return 1

    print("\nAnmeldeversuch beim Push-Dienst …")
    print(
        "  (Der laufende Hub teilt sich diese Anmeldung – er baut seinen "
        "Kanal danach neu auf.)"
    )
    mitschnitt = _LogMitschnitt(*PUSH_LOGGER)
    fehler: str | None = None
    with mitschnitt:
        try:
            from ring_doorbell import Auth, Ring, RingEventListener

            auth = Auth(USER_AGENT, token=stored.get("token"))
            ring = Ring(auth)
            await ring.async_create_session()
            await ring.async_update_devices()
            # Ausdrücklich ohne credentials_updated_callback: Die Diagnose
            # sieht nach, sie schreibt nicht.
            listener = RingEventListener(ring, credentials=stored["listener"])
            gestartet = await listener.start()
            if gestartet:
                # Nicht sofort urteilen: start() kehrt zurück, sobald die
                # Anmeldung durch ist. Der Push-Client darunter schaltet
                # sich bei einer beschädigten Anmeldung eine Sekunde
                # später selbst ab - und genau das ist der Fall, bei dem
                # von aussen alles gut aussieht und es nie klingelt.
                print("  … angemeldet, warte 8 s, ob der Kanal hält …")
                await asyncio.sleep(8)
                if channel_alive(listener):
                    print("  ✓ Ereigniskanal steht – Klingeln kommt sofort an.")
                else:
                    fehler = (
                        "Angemeldet, aber ohne Dauerverbindung: Der "
                        "Push-Client kam nicht bis zum Einloggen bei "
                        "mtalk.google.com:5228. Entweder ist dieser Port "
                        "im Netz gesperrt (siehe oben) oder die "
                        "gespeicherte Push-Anmeldung ist beschädigt"
                    )
                await listener.stop()
            else:
                fehler = "Anmeldung beim Push-Dienst abgelehnt"
            await auth.async_close()
        except Exception as err:
            fehler = f"{err.__class__.__name__}: {err}"

    for zeile in mitschnitt.zeilen:
        print(f"  … {zeile}")
    if fehler is None:
        return 0
    print(f"\n✗ {fehler}")
    print(f"→ {push_diagnose(erreichbar, mitschnitt.zeilen)}")
    print(
        "\nWer den Weg über Google gar nicht will: 'events: false' in den "
        f"ring-Block der config.yaml. Dann fragt der Hub alle {DING_POLL_SECONDS} s "
        "selbst nach – ohne Warnung im System-Bildschirm."
    )
    return 1


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Ring-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    parser.add_argument(
        "--diagnose",
        action="store_true",
        help="Nicht anmelden, sondern prüfen, warum der Ereigniskanal fehlt",
    )
    parser.add_argument(
        "--klingeln",
        type=int,
        nargs="?",
        const=60,
        metavar="SEKUNDEN",
        help="Zuschauen, was Rings Wolke beim Klingeln hergibt (stört den "
        "laufenden Hub nicht)",
    )
    args = parser.parse_args()
    if args.klingeln:
        sys.exit(asyncio.run(_horchen_main(args.config, args.klingeln)))
    if args.diagnose:
        sys.exit(asyncio.run(_diagnose_main(args.config)))
    sys.exit(asyncio.run(_login_main(args.config)))
