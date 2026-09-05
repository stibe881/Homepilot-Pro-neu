"""Push-Benachrichtigungen über den Expo-Dienst.

Die App meldet beim Start ihren Push-Token an (/api/push/register); der Hub
merkt sich, welcher Benutzer dahintersteht. Automationen können dann per
Aktion ``notify`` an alle, an eine Rolle oder an einzelne Personen senden.

Ohne angemeldetes Gerät passiert schlicht nichts – der Hub läuft weiter.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from .users import Role

log = logging.getLogger(__name__)

EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send"

# ── Dringlichkeit ──────────────────────────────────────────────────────────
#
# Ohne Angabe verschickt Expo jede Nachricht mit normaler Dringlichkeit.
# Was danach mit ihr geschieht, steht in keiner Zeile hier und war deshalb
# lange nicht zu sehen: Android hält normale Nachrichten zurück, solange
# das Telefon in Doze liegt, und stellt sie gesammelt beim nächsten
# Aufwachen zu - je nach Standby-Eimer Minuten später. Apple beschreibt
# seine Stufe 5 selbst als «zu einem Zeitpunkt, der Strom spart».
#
# Für eine schwache Batterie ist das genau richtig. Für eine Türklingel
# ist es die ganze Störung: Es klingelt, der Hub meldet «angenommen», und
# das Telefon sagt Bescheid, wenn es ihm gerade passt. Von aussen sieht
# das aus wie ein langsamer Hub - dabei liegt die Nachricht längst beim
# Betriebssystem und wartet dort.
#
# Deshalb ist die Voreinstellung hier umgekehrt: dringend, ausser es
# steht ausdrücklich anders. Wer eine Nachricht einrichtet, will von ihr
# hören; die Ausnahmen sind aufzählbar und stehen unten.

#: Android-Kanal für alles, was sofort kommen muss.
KANAL_DRINGEND = "dringend"
#: Android-Kanal für das, was warten darf.
KANAL_LEISE = "leise"

# Was warten darf. Bewusst kurz und namentlich: Jede Kategorie hier ist
# eine Entscheidung, dass ihre Nachricht auch eine Viertelstunde später
# noch denselben Wert hat. Alles andere - Alarm, Wasser, Klingeln, Timer,
# Medikament und jeder selbst gebaute Ablauf - gilt als dringend.
LEISE: frozenset[str] = frozenset(
    {
        "battery",
        "disk",
        "outage",
        "flattern",
        "device_down",
        "maintenance",
        "shopping",
        "birthday",
        "weekahead",
        "morning",
    }
)


#: So viel vom Antworttext des Push-Dienstes wird durchgereicht. Hier
#: standen 120 Zeichen - und die Fehlermeldung von Expo beginnt mit
#: hundert Zeichen JSON-Gerüst. Abgeschnitten wurde also genau der Satz,
#: der sagt, was falsch ist: «…"message":"Must correct one of the
#: following issues: [\"$\": Expecte…». Wer das liest, weiss nichts.
FEHLERTEXT_LAENGE = 400


def push_fehlertext(status: int, body: str) -> str:
    """Aus der Antwort des Push-Dienstes einen lesbaren Satz (rein, testbar).

    Expo antwortet mit einem JSON-Gerüst um die eigentliche Auskunft
    herum. Interessant ist ausschliesslich, was in `errors[].message`
    steht - alles davor ist immer dasselbe und frisst den Platz.
    """
    text = str(body or "").strip()
    try:
        daten = json.loads(text)
    except (ValueError, TypeError):
        return f"Push-Dienst antwortet mit {status}: {text[:FEHLERTEXT_LAENGE]}"
    fehler = daten.get("errors") if isinstance(daten, dict) else None
    saetze = []
    for eintrag in fehler or []:
        if not isinstance(eintrag, dict):
            continue
        satz = str(eintrag.get("message") or "").strip()
        code = str(eintrag.get("code") or "").strip()
        if satz and code:
            saetze.append(f"{satz} ({code})")
        elif satz:
            saetze.append(satz)
    if not saetze:
        return f"Push-Dienst antwortet mit {status}: {text[:FEHLERTEXT_LAENGE]}"
    return (
        f"Push-Dienst antwortet mit {status}: "
        + " · ".join(saetze)[:FEHLERTEXT_LAENGE]
    )


# ── Knöpfe in der Mitteilung ───────────────────────────────────────────────
#
# Eine Meldung ohne Handgriff ist eine Meldung, die man wegwischt: «Fenster
# offen» um halb elf, App öffnen, Raum suchen, Storen zu - vier Griffe für
# eine Bewegung. iOS und Android können Knöpfe direkt in der Mitteilung
# anbieten; welche das sind, sagt eine Kennung («categoryId»), die die App
# vorher angemeldet hat (app/src/lib/mitteilungsknoepfe.ts).
#
# Bewusst nur zwei Handgriffe, und beide harmlos: «später erinnern» und
# «erledigt». Was Schaden anrichten kann - aufschliessen, entschärfen -
# gehört nicht auf einen Sperrbildschirm, den jeder sieht, der das Telefon
# in die Hand nimmt.

#: Erinnert später noch einmal an dieselbe Meldung.
KNOEPFE_SPAETER = "spaeter"
#: Erinnert später und lässt sich abhaken (Batterie, Wartung).
KNOEPFE_ERLEDIGT = "erledigt"
#: «Ich mach's» – die volle Maschine übernimmt jemand. Die Meldung geht
#: an alle, und ohne dieses Zeichen geht danach entweder niemand
#: hinunter (jeder nimmt an, ein anderer tue es) oder zwei gleichzeitig.
KNOEPFE_WAESCHE = "waesche"

_KNOEPFE: dict[str, str] = {
    "open": KNOEPFE_SPAETER,
    "appliance": KNOEPFE_WAESCHE,
    "shopping": KNOEPFE_SPAETER,
    "medication": KNOEPFE_SPAETER,
    "battery": KNOEPFE_ERLEDIGT,
    "maintenance": KNOEPFE_ERLEDIGT,
}


def knoepfe(category: str | None) -> str | None:
    """Welche Knöpfe unter diese Meldung gehören (rein, testbar).

    Nichts für alles, was keinen sinnvollen Handgriff hat - beim Alarm
    wäre «später erinnern» die falsche Auskunft, und entschärfen darf man
    hier ohnehin nicht.
    """
    return _KNOEPFE.get(str(category or ""))


def dringlichkeit(category: str | None) -> dict[str, Any]:
    """Die Zustellfelder für eine Kategorie (rein, testbar).

    ``priority`` entscheidet, ob Android die Nachricht durch Doze
    durchlässt und ob Apple sie sofort ausliefert. ``channelId`` sagt
    Android, mit welcher Wichtigkeit sie anzuzeigen ist - ohne Kanal
    landet alles im Sammelkanal mit mittlerer Wichtigkeit, also ohne
    Einblendung. ``interruptionLevel`` ist die iOS-Seite davon: Ohne sie
    nützt die hohe Priorität nichts, sobald ein Fokus aktiv ist - die
    Nachricht ist dann sofort da und wird bloss nicht gezeigt.
    """
    if category is not None and category in LEISE:
        return {"priority": "normal", "channelId": KANAL_LEISE}
    return {
        "priority": "high",
        "channelId": KANAL_DRINGEND,
        # Mit Bindestrich, nicht in Binnenmajuskel. Apples eigener
        # Schlüssel heisst «timeSensitive»; Expo nimmt an dieser Stelle
        # aber nur 'active', 'critical', 'passive' oder 'time-sensitive'
        # entgegen und weist die ganze Sendung mit 400 ab, wenn etwas
        # anderes dasteht. Nicht diese eine Nachricht - die ganze: Es ist
        # ein Schema-Fehler, kein Zustellfehler. Damit kam von diesem Hub
        # keine einzige Push mehr an, auch der Test nicht.
        "interruptionLevel": "time-sensitive",
    }

# Die Arten von Nachrichten, die der Hub verschickt. Jede hat einen festen
# Schlüssel, damit sich einzelne davon je Benutzer abstellen lassen – wer
# nachts nicht wegen einer schwachen Batterie geweckt werden will, soll
# deswegen nicht den Alarm mit abschalten müssen.
CATEGORIES: dict[str, str] = {
    "alarm": "Alarm ausgelöst",
    "alarm_arming": "Alarmanlage scharf/unscharf",
    "camera_motion": "Kamera sieht Bewegung (wenn scharf)",
    "outage": "Integration ausgefallen",
    "flattern": "Anbindung verbindet dauernd neu",
    "device_down": "Überwachtes Gerät antwortet nicht",
    "battery": "Batterie schwach",
    "open": "Fenster/Tür steht offen",
    "leak": "Wasser gemeldet",
    "doorbell": "Es klingelt an der Türe",
    "baby_cry": "Ein Baby weint",
    "disk": "Speicherplatz wird knapp",
    "frost": "Frost angekündigt",
    "rain": "Regen kommt",
    "plants": "Pflanzen giessen",
    "appliance": "Haushaltgerät fertig",
    "oven": "Backofen parat/fertig",
    "departure": "Losfahren zum Termin",
    "vacuum": "Saugroboter meldet ein Problem",
    "tasks": "Fällige Aufgaben",
    "timer": "Küchen-Timer",
    "maintenance": "Wartung fällig",
    # Zwei Anlässe, ein Thema: die Erinnerung im Laden und der
    # Vorrat, den der Hub selbst auf die Liste setzt.
    "shopping": "Einkaufsliste",
    "calendar": "Termin steht an",
    "medication": "Medikament fällig",
    "birthday": "Geburtstag heute",
    "morning": "Morgen-Zusammenfassung",
    "presence": "Ortung: schwacher Akku, Funkstille",
    "weekahead": "Wochenausblick am Sonntag",
    "test": "Push-Test",
}


# ── Unterkategorien ────────────────────────────────────────────────────────
#
# Zwanzig gleich aussehende Schalter beantworten die eigentliche Frage
# nicht: «Was weckt mich nachts, was ist bloss Betrieb?» Deshalb gehören
# die Kategorien in Gruppen - und zwar hier, nicht in der App: Dieselbe
# Einteilung braucht die Liste im Profil (was will ich bekommen?) und die
# unter «Abläufe → Push» (was schickt der Hub überhaupt?). Zwei Listen
# liefen früher oder später auseinander.
#
# Reihenfolge ist Absicht: Was aufweckt, steht oben.
GROUPS: list[tuple[str, tuple[str, ...]]] = [
    # Die Klingel steht ganz vorn: Sie ist die Nachricht, auf die man
    # sofort reagiert - und die einzige, bei der ein paar Sekunden
    # Verzögerung den Zweck zunichte machen.
    ("Sicherheit", ("doorbell", "alarm", "alarm_arming", "camera_motion", "leak")),
    ("Haus", ("open", "appliance", "oven", "vacuum", "frost", "rain", "plants",
              "timer", "maintenance")),
    # «Baby weint» steht vorn und bei der Familie, nicht bei der
    # Sicherheit: Gesucht wird die Nachricht dort, wo die Kinder sind.
    # Dringend bleibt sie unabhängig von der Gruppe - die Einteilung
    # sortiert nur die Schalter, über die Zustellung entscheidet LEISE.
    ("Familie", ("baby_cry", "birthday", "calendar", "departure", "medication",
                 "tasks", "shopping", "weekahead", "presence")),
    ("Betrieb", ("outage", "flattern", "device_down", "battery", "disk", "morning")),
    # Leer, und trotzdem hier: Unter dieser Überschrift stehen die
    # Nachrichten aus selbst gebauten Abläufen. Sie haben keinen festen
    # Schlüssel - jeder Ablauf, der meldet, bringt seinen eigenen mit
    # (siehe AUTOMATION_PREFIX). Wer seinem Ablauf eine Kategorie gegeben
    # hat, findet ihn unter deren Namen.
    ("Aus Abläufen", ()),
]

# So beginnt der Schlüssel einer Nachricht aus einem selbst gebauten
# Ablauf. Früher liefen sie alle unter der einen Kategorie «Nachricht aus
# einem Ablauf»: Wer die Gefriertruhe nicht mehr gemeldet haben wollte,
# schaltete damit auch «Jemand weint im Kinderzimmer» ab. Jetzt bringt
# jeder meldende Ablauf seinen eigenen Schalter mit - benannt wie er
# selbst, einsortiert unter seiner Kategorie.
AUTOMATION_PREFIX = "automation:"


def automation_key(automation_id: str) -> str:
    """Der Schlüssel zu einem Ablauf (rein, testbar).

    An der Kennung, nicht am Namen: Ein umbenannter Ablauf soll nicht
    stillschweigend wieder bei allen aufpoppen, die ihn abbestellt haben.
    """
    return f"{AUTOMATION_PREFIX}{automation_id}"


def is_automation(key: str) -> bool:
    """Gehört dieser Schlüssel zu einem Ablauf? (rein, testbar)"""
    return str(key or "").startswith(AUTOMATION_PREFIX)


def known(key: str) -> bool:
    """Gibt es diese Kategorie? (rein, testbar)

    Die eingebauten stehen in CATEGORIES; die aus Abläufen entstehen zur
    Laufzeit und werden am Vorsatz erkannt. Ob es den Ablauf noch gibt,
    prüft hier bewusst niemand: Ein Ablauf, der gerade nicht läuft, soll
    seine Abbestellung behalten.
    """
    return key in CATEGORIES or is_automation(key)


def sendet_push(automation: Any) -> bool:
    """Schickt dieser Ablauf eine Nachricht? (rein, testbar)

    Auch aus dem Sonst-Zweig: «hat nicht geklappt» ist genau die
    Nachricht, die man bekommen will.
    """
    aktionen = list(getattr(automation, "actions", []) or []) + list(
        getattr(automation, "otherwise", []) or []
    )
    return any(
        isinstance(aktion, dict) and str(aktion.get("type")) == "notify"
        for aktion in aktionen
    )


def automation_categories(automations: Any) -> list[dict[str, str]]:
    """Je meldendem Ablauf eine Kategorie (rein, testbar).

    Die Gruppe ist die Kategorie des Ablaufs - wer seine Push-Abläufe
    «Push» nennt, findet sie im Profil unter «Push». Ohne Kategorie
    stehen sie unter «Aus Abläufen».
    """
    zeilen = []
    for automation in automations or []:
        if not sendet_push(automation):
            continue
        kategorie = str(getattr(automation, "category", "") or "").strip()
        zeilen.append(
            {
                "key": automation_key(str(getattr(automation, "id", ""))),
                "label": str(getattr(automation, "alias", "") or "Ohne Namen"),
                "group": kategorie or "Aus Abläufen",
            }
        )
    return zeilen


def migrate_muted(raw: Any, automation_keys: list[str]) -> list[dict[str, Any]] | None:
    """Die alte Sammelkategorie in einzelne Schalter übersetzen (rein).

    Wer «Nachricht aus einem Ablauf» abbestellt hatte, meinte alle - also
    werden daraus die Schlüssel aller meldenden Abläufe. Sie stehen dann
    im Profil einzeln da und lassen sich einzeln wieder einschalten;
    stillschweigend wieder alles zu schicken wäre die schlechtere
    Richtung. Gibt None zurück, wenn nichts zu tun ist.
    """
    zeilen = []
    geaendert = False
    for eintrag in raw or []:
        if not isinstance(eintrag, dict):
            continue
        stumm = [str(key) for key in eintrag.get("muted") or []]
        if "automation" in stumm:
            geaendert = True
            stumm = sorted({key for key in stumm if key != "automation"} | set(automation_keys))
        zeilen.append({**eintrag, "muted": stumm})
    return zeilen if geaendert else None

# Wohin eine Kategorie gehört, die in keiner Gruppe steht. Sie
# verschwinden zu lassen wäre der schlechtere Handel: Eine neue Kategorie
# wäre dann unsichtbar, statt bloss unsortiert.
OTHER_GROUP = "Weiteres"


def group_of(key: str) -> str:
    """Zu welcher Unterkategorie gehört diese Art Nachricht? (rein, testbar)"""
    for name, keys in GROUPS:
        if key in keys:
            return name
    return OTHER_GROUP


def group_order() -> list[str]:
    """Die Gruppen in Anzeige-Reihenfolge, «Weiteres» zuletzt (rein)."""
    return [name for name, _ in GROUPS] + [OTHER_GROUP]


def parse_muted(raw: Any) -> dict[str, set[str]]:
    """Gespeicherte Abbestellungen einlesen (rein, testbar).

    Unbekannte Schlüssel fliegen raus: Eine umbenannte Kategorie soll nicht
    stillschweigend jemanden stumm schalten.
    """
    result: dict[str, set[str]] = {}
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("user") or "")
        if not name:
            continue
        result[name] = {
            str(key) for key in entry.get("muted") or [] if known(str(key))
        }
    return result
EXPO_RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts"

# Fehler, nach denen ein Token dauerhaft tot ist – App deinstalliert oder
# Berechtigung entzogen. Das Gerät fliegt dann aus der Liste.
DEAD_TOKEN_ERRORS = frozenset({"DeviceNotRegistered"})

# Was die Expo-Fehlercodes für uns bedeuten – roh sind sie wenig hilfreich.
ERROR_HINTS = {
    "DeviceNotRegistered": (
        "Das Gerät nimmt keine Nachrichten mehr an (App deinstalliert oder "
        "Benachrichtigungen entzogen). Es wurde abgemeldet – App einmal "
        "öffnen, dann meldet sie sich neu an."
    ),
    "InvalidCredentials": (
        "Expo hat für dieses Projekt keine gültigen Push-Zugangsdaten. Bei "
        "einem eigenen Build müssen sie einmal erzeugt werden "
        "(eas credentials)."
    ),
    "MessageTooBig": "Die Nachricht ist zu lang.",
    "MessageRateExceeded": "Zu viele Nachrichten in kurzer Zeit – später erneut.",
}

# Was Apple selbst ablehnt, reicht Expo im Klartext durch, ohne eigenen
# Code. Die Rohtexte sind zwar lesbar, sagen aber nicht, was zu tun ist.
APNS_HINTS = {
    "TopicDisallowed": (
        "Apple lehnt die Nachricht ab: Der Push-Token gehört zu einer "
        "anderen App-Kennung, als das hinterlegte Zertifikat abdeckt. "
        "Meist ein alter Token – noch von Expo Go oder einem früheren "
        "Build. Unter System → Push-Geräte die alten Einträge entfernen "
        "und die App einmal öffnen; sie meldet sich neu an. Bleibt es "
        "dabei, fehlt der App-Kennung im Apple-Konto die Berechtigung "
        "«Push Notifications» (Developer-Portal → Identifiers)."
    ),
    "BadDeviceToken": (
        "Apple kennt diesen Token nicht (mehr) – oder er stammt aus einem "
        "Build für die Entwicklungsumgebung, während produktiv gesendet "
        "wird. Gerät unter System → Push-Geräte entfernen und die App "
        "einmal öffnen."
    ),
    "DeviceTokenNotForTopic": (
        "Der Token gehört zu einer anderen App. Unter System → "
        "Push-Geräte entfernen und neu anmelden lassen."
    ),
    "ExpiredProviderToken": (
        "Expos Zugangsdaten für Apple sind abgelaufen. Einmal "
        "«npx eas-cli credentials -p ios» und den Push-Schlüssel erneuern."
    ),
}


def is_expo_token(token: str) -> bool:
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


@dataclass
class PushResult:
    """Was aus einem Sendeversuch geworden ist.

    ``accepted`` sind die vom Expo-Dienst angenommenen Nachrichten – das ist
    noch keine Zustellung. Ob sie wirklich ankamen, sagt erst die Quittung
    zu ``ticket_ids``.
    """

    accepted: int = 0
    errors: list[str] = field(default_factory=list)
    ticket_ids: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "errors": list(self.errors),
            "ticket_ids": list(self.ticket_ids),
        }


def explain(code: str, message: str) -> str:
    """Aus einem Expo-Fehlercode einen brauchbaren Satz machen (rein).

    Zwei Quellen: Expos eigene Codes und das, was Apple ablehnt. Letzteres
    kommt ohne Code, nur als Text – deshalb wird darin nach dem Grund
    gesucht, statt ihn wörtlich durchzureichen. «TopicDisallowed» sagt
    einem niemandem etwas; «der Token gehört zu einer anderen App-Kennung»
    schon.
    """
    hint = ERROR_HINTS.get(code)
    if hint:
        return hint
    for reason, text in APNS_HINTS.items():
        if reason in message or reason == code:
            return text
    return message or code or "Unbekannter Fehler des Push-Dienstes"


def parse_tickets(payload: Any, tokens: list[str]) -> tuple[PushResult, list[str]]:
    """Wertet die Antwort des Expo-Dienstes aus (rein, testbar).

    Expo antwortet auch dann mit HTTP 200, wenn einzelne Nachrichten
    abgelehnt werden – der Status steht je Nachricht in ``data``. Genau
    dort steht auch, warum nichts ankommt.

    Gibt das Ergebnis zurück und die Tokens, die endgültig tot sind.
    """
    result = PushResult()
    dead: list[str] = []
    if not isinstance(payload, dict):
        result.errors.append("Unerwartete Antwort des Push-Dienstes")
        return result, dead

    # Fehler auf Anfrageebene (z.B. kaputtes JSON) stehen ganz oben.
    for entry in payload.get("errors") or []:
        if isinstance(entry, dict):
            result.errors.append(explain(str(entry.get("code", "")), str(entry.get("message", ""))))

    tickets = payload.get("data")
    if not isinstance(tickets, list):
        return result, dead

    for index, ticket in enumerate(tickets):
        if not isinstance(ticket, dict):
            continue
        if ticket.get("status") == "ok":
            result.accepted += 1
            if ticket.get("id"):
                result.ticket_ids.append(str(ticket["id"]))
            continue
        details = ticket.get("details") or {}
        code = str(details.get("error", "")) if isinstance(details, dict) else ""
        result.errors.append(explain(code, str(ticket.get("message", ""))))
        if code in DEAD_TOKEN_ERRORS and index < len(tokens):
            dead.append(tokens[index])
    return result, dead


def parse_receipts(payload: Any) -> list[str]:
    """Zustell-Quittungen auswerten (rein, testbar).

    Erst hier zeigt sich, ob Apple bzw. Google die Nachricht angenommen
    hat – der Sendevorgang selbst weiss davon nichts. Zurück kommen die
    Fehlertexte; eine leere Liste heisst: alles zugestellt.
    """
    if not isinstance(payload, dict):
        return []
    receipts = payload.get("data")
    if not isinstance(receipts, dict):
        return []
    problems: list[str] = []
    for receipt in receipts.values():
        if not isinstance(receipt, dict) or receipt.get("status") == "ok":
            continue
        details = receipt.get("details") or {}
        code = str(details.get("error", "")) if isinstance(details, dict) else ""
        problems.append(explain(code, str(receipt.get("message", ""))))
    return problems


@dataclass
class PushDevice:
    token: str
    user: str
    label: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"token": self.token, "user": self.user, "label": self.label}


class PushService:
    # Benutzername → abbestellte Kategorien. Der Hub füllt das aus den
    # gespeicherten Einstellungen.
    muted: dict[str, set[str]]

    def __init__(self, session_factory=None) -> None:
        self._devices: dict[str, PushDevice] = {}
        # Wird vom Hub gesetzt: Ruf mich, wenn sich die Geräteliste
        # ändert. Bewusst ein Rückruf und kein DataStore hier - der
        # Push-Dienst soll nichts über die Ablage wissen müssen.
        self.on_change: Any = None
        # Wird vom Hub gesetzt: Ruf mich mit jeder verschickten Meldung -
        # für den Nachlese-Zettel (core/pushverlauf.py). Derselbe Schnitt
        # wie bei on_change: kein DataStore hier drin.
        self.on_sent: Any = None
        self.muted = {}
        self._session_factory = session_factory or (
            lambda: aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        )

    @property
    def devices(self) -> list[PushDevice]:
        return list(self._devices.values())

    def restore(self, rows: list[dict[str, Any]]) -> None:
        """Gespeicherte Anmeldungen zurückholen (beim Start).

        Ein Token, das inzwischen tot ist, merkt der erste Sendeversuch -
        Expo meldet DeviceNotRegistered, und der Eintrag fliegt dann von
        selbst raus. Beim Laden zu prüfen wäre eine Netzanfrage im
        Startpfad und brächte nichts.
        """
        for row in rows:
            token = str(row.get("token") or "")
            if is_expo_token(token):
                self._devices[token] = PushDevice(
                    token=token,
                    user=str(row.get("user") or ""),
                    label=str(row.get("label") or ""),
                )

    def _changed(self) -> None:
        if self.on_change is not None:
            self.on_change([device.as_dict() for device in self.devices])

    def register(self, token: str, user: str, label: str = "") -> PushDevice:
        device = PushDevice(token=token, user=user, label=label)
        # Nach Token abgelegt: Meldet sich dasselbe Gerät erneut an, wird der
        # Eintrag ersetzt statt verdoppelt.
        self._devices[token] = device
        self._changed()
        return device

    def umbenennen(self, alt: str, neu: str) -> int:
        """Geräte-Anmeldungen auf einen neuen Benutzernamen umschreiben.

        Beim Umbenennen eines Benutzers: Die Telefone sind nach Namen
        angemeldet, und ohne das hier gingen Push-Nachrichten an den
        alten Namen - also an niemanden - bis sich jede App das nächste
        Mal von selbst neu anmeldet.
        """
        betroffen = [d for d in self._devices.values() if d.user == alt]
        for device in betroffen:
            device.user = neu
        if betroffen:
            self._changed()
        if alt in self.muted:
            self.muted[neu] = self.muted.pop(alt)
        return len(betroffen)

    def unregister(self, token: str) -> bool:
        gone = self._devices.pop(token, None) is not None
        if gone:
            self._changed()
        return gone

    def recipients(
        self, users: list[Any], to: str = "all", category: str | None = None
    ) -> list[str]:
        """Wählt die Empfänger aus.

        ``to`` ist "all", eine Rolle ("bewohner") oder ein Benutzername.
        Gäste bekommen nur etwas, wenn sie ausdrücklich gemeint sind.

        ``category`` ist die Art der Nachricht. Wer sie in seinem Profil
        abbestellt hat, fällt hier heraus – das ist die einzige Stelle, an
        der das geprüft wird, damit keine Nachrichtenart die Einstellung
        versehentlich übergeht.
        """
        by_name = {user.name: user for user in users}
        tokens = []
        for device in self._devices.values():
            user = by_name.get(device.user)
            if user is None:
                continue
            if category and category in self.muted.get(device.user, set()):
                continue
            if to == "all":
                if user.role != Role.GUEST:
                    tokens.append(device.token)
            elif to in Role.ALL:
                if user.role == to:
                    tokens.append(device.token)
            elif to == device.user:
                tokens.append(device.token)
        return tokens

    async def send(
        self,
        tokens: list[str],
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
        image: str | None = None,
        category: str | None = None,
    ) -> PushResult:
        """Verschickt die Nachricht und sagt, was der Dienst dazu meint.

        Wichtig: ``accepted`` heisst «von Expo angenommen», nicht «beim
        Empfänger angekommen». Für die Zustellung gibt es ``delivered``.

        ``category`` ist dieselbe wie bei ``recipients`` und entscheidet
        hier über die Dringlichkeit - siehe ``dringlichkeit``. Fehlt sie,
        geht die Nachricht dringend raus: Das ist die Voreinstellung, bei
        der niemand etwas verpasst.

        ``image`` ist eine Adresse, die das *Telefon* selbst aufruft, während
        es die Nachricht anzeigt – ohne Anmeldung, denn die App läuft zu dem
        Zeitpunkt noch gar nicht. Was das bedeutet, steht in
        ``core/snapshots.py``.
        """
        if not tokens:
            return PushResult()
        valid = [token for token in tokens if is_expo_token(token)]
        stufe = dringlichkeit(category)
        kategorie_knoepfe = knoepfe(category)
        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": data or {},
                **stufe,
                # Die Knöpfe hängen an der Art der Meldung, nicht an ihrem
                # Text - deshalb reicht die Kennung; die Beschriftungen
                # kennt die App (core/push.py: knoepfe).
                **({"categoryId": kategorie_knoepfe} if kategorie_knoepfe else {}),
                **({"richContent": {"image": image}} if image else {}),
            }
            for token in valid
        ]
        if not messages:
            return PushResult(errors=["Kein gültiger Expo-Push-Token angemeldet"])

        if self.on_sent is not None:
            # Vor dem Versand vermerkt: Auch eine Meldung, die bei Expo
            # hängenbleibt, war eine Meldung - und der Zettel soll nicht
            # vom Netz abhängen.
            empfaenger = sorted(
                {
                    device.user
                    for device in self.devices
                    if device.token in valid and device.user
                }
            )
            alle = {device.user for device in self.devices if device.user}
            self.on_sent(
                {
                    "title": title,
                    "body": body,
                    "category": category,
                    # Ging es an alle Telefone, bleibt die Liste leer -
                    # «an alle» soll auch für morgen Angemeldete gelten.
                    "to": [] if set(empfaenger) >= alle else empfaenger,
                }
            )

        session = self._session_factory()
        try:
            async with session.post(EXPO_ENDPOINT, json=messages) as response:
                text = await response.text()
                if response.status >= 400:
                    # Ganz ins Log, gekürzt in die App: Wer per SSH
                    # nachsieht, will alles; wer in der App eine Meldung
                    # liest, will den Satz und nicht das JSON-Gerüst.
                    log.warning(
                        "Push fehlgeschlagen (%s): %s", response.status, text[:2000]
                    )
                    return PushResult(
                        errors=[push_fehlertext(response.status, text)]
                    )
                payload = await response.json(content_type=None)
        except Exception as err:
            # Eine gescheiterte Benachrichtigung darf die Automation nicht
            # abbrechen, die sie ausgelöst hat.
            log.warning("Push nicht zustellbar: %s", err)
            return PushResult(errors=[f"Push-Dienst nicht erreichbar: {err}"])
        finally:
            await session.close()

        result, dead = parse_tickets(payload, valid)
        for token in dead:
            # Tote Tokens sammeln sich sonst für immer an und verfälschen
            # jede Zählung «an n Geräte verschickt».
            self.unregister(token)
            log.info("Push-Gerät abgemeldet, Token wird von Expo abgelehnt")
        for message in result.errors:
            log.warning("Push abgelehnt: %s", message)
        # Immer eine Zeile, auch wenn alles glattging: Sonst lässt sich im
        # Log nicht unterscheiden, ob nichts schiefging oder ob überhaupt
        # nie etwas gesendet wurde.
        log.info(
            "Push «%s»: %d von %d angenommen%s",
            title,
            result.accepted,
            len(messages),
            f", {len(result.errors)} abgelehnt" if result.errors else "",
        )
        return result

    async def delivered(self, ticket_ids: list[str]) -> list[str]:
        """Holt die Zustell-Quittungen zu bereits gesendeten Nachrichten.

        Der Sendevorgang endet bei Expo; ob Apple oder Google die Nachricht
        wirklich ausgeliefert haben, steht erst in der Quittung. Zurück
        kommen die Fehlertexte – leer heisst: zugestellt.
        """
        if not ticket_ids:
            return []
        session = self._session_factory()
        try:
            async with session.post(EXPO_RECEIPTS, json={"ids": ticket_ids}) as response:
                if response.status >= 400:
                    return []
                payload = await response.json(content_type=None)
        except Exception as err:
            log.warning("Quittungen nicht abrufbar: %s", err)
            return []
        finally:
            await session.close()
        problems = parse_receipts(payload)
        for message in problems:
            log.warning("Push nicht zugestellt: %s", message)
        if not problems:
            log.info("Push zugestellt (%d Quittung(en) ohne Beanstandung)", len(ticket_ids))
        return problems
