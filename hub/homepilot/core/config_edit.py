"""Einzelne Geräte in die config.yaml eintragen, ohne sie umzuschreiben.

Bewusst als Textbearbeitung und nicht über einen YAML-Parser: Ein Parser
würde die Datei beim Zurückschreiben neu formatieren und dabei sämtliche
Kommentare und die gewachsene Reihenfolge verlieren. Die config.yaml
gehört dem Menschen, der sie geschrieben hat – der Hub darf dort eine
Zeile ergänzen, aber nicht aufräumen.

Die Funktionen hier sind rein: Text rein, Text raus. Geprüft wird das
Ergebnis anschliessend wie jede andere Änderung auch, indem es probeweise
geladen wird (siehe /api/config).
"""

from __future__ import annotations

import re

# Zeichen, bei denen YAML einen unquotierten Wert missverstehen könnte.
_NEEDS_QUOTES = re.compile(r"""^\s|\s$|[:#'"{}\[\],&*?|<>=!%@`]|^$""")


def quote(value: str) -> str:
    """Einen Wert so schreiben, dass YAML ihn wieder als Text liest."""
    if _NEEDS_QUOTES.search(value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip())


def block_range(lines: list[str], integration: str) -> tuple[int, int] | None:
    """Von wo bis wo reicht der Block dieser Integration? (rein, testbar)

    Ende ist die Zeile des nächsten ``- integration:`` bzw. das Dateiende.
    ``None``, wenn die Integration gar nicht vorkommt.
    """
    start: int | None = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("- integration:"):
            continue
        if start is not None:
            return start, index
        if stripped.split(":", 1)[1].strip().strip("\"'") == integration:
            start = index
    return (start, len(lines)) if start is not None else None


def has_endpoint(lines: list[str], host: str, port: int = 8009) -> bool:
    """Steht diese Box schon in diesen Zeilen? (rein, testbar)

    Nur innerhalb des übergebenen Ausschnitts, denn dieselbe Adresse kann
    berechtigterweise bei einer anderen Integration stehen – ein Fernseher
    ist oft beides, Cast-Gerät und Android TV.

    Adresse allein genügt nicht: Eine Lautsprechergruppe teilt sie sich mit
    einer ihrer Boxen und unterscheidet sich nur im Port.
    """
    for index, line in enumerate(lines):
        if not line.strip().lstrip("- ").startswith(f"host: {host}"):
            continue
        # Zum Eintrag gehört alles bis zum nächsten «- » auf gleicher Höhe.
        entry_indent = indent_of(line)
        found_port = 8009
        for follow in lines[index + 1 :]:
            if not follow.strip():
                continue
            if indent_of(follow) <= entry_indent:
                break
            if follow.strip().startswith("port:"):
                value = follow.split(":", 1)[1].strip()
                found_port = int(value) if value.isdigit() else 8009
        if found_port == port:
            return True
    return False


def add_cast_device(content: str, name: str, host: str, port: int = 8009) -> str:
    """Eine Box in den google_cast-Block eintragen (rein, testbar).

    Ist die Adresse schon da, bleibt der Text unverändert – zweimal
    dasselbe Gerät wäre beim Start ein Fehler, und ein zweiter Klick soll
    nichts kaputt machen.

    Der Port wird nur eingetragen, wenn er vom üblichen abweicht. Genau das
    ist bei einer Lautsprechergruppe der Fall: Sie läuft auf der Adresse
    einer ihrer Boxen und ist nur am eigenen Port zu erreichen.
    """
    lines = content.splitlines()
    entry_name = quote(name)
    found = block_range(lines, "google_cast")

    if found is None:
        return _append_integration(lines, entry_name, host, port)

    start, end = found
    block = lines[start:end]
    if has_endpoint(block, host, port):
        return content

    base = indent_of(lines[start])
    devices = _devices_line(lines, start, end)
    if devices is None:
        # Block ohne Geräteliste: beides anlegen, direkt unter der
        # Integrationszeile.
        insert = start + 1
        lines[insert:insert] = [
            " " * (base + 2) + "devices:",
            *_entry(base + 4, entry_name, host, port),
        ]
        return "\n".join(lines) + "\n"

    device_indent = indent_of(lines[devices])
    entry_indent = _entry_indent(lines, devices, end, device_indent)
    insert = _end_of_list(lines, devices, end, device_indent)
    lines[insert:insert] = _entry(entry_indent, entry_name, host, port)
    return "\n".join(lines) + "\n"


def _entry(indent: int, entry_name: str, host: str, port: int) -> list[str]:
    lines = [
        " " * indent + f"- host: {host}",
        " " * (indent + 2) + f"name: {entry_name}",
    ]
    if port != 8009:
        lines.append(" " * (indent + 2) + f"port: {port}")
    return lines


def _devices_line(lines: list[str], start: int, end: int) -> int | None:
    for index in range(start, end):
        if lines[index].strip() == "devices:":
            return index
    return None


def _in_list(line: str, device_indent: int) -> bool:
    """Gehört diese Zeile noch zur Geräteliste? (rein, testbar)

    YAML erlaubt Listeneinträge auf derselben Einrückung wie ihr Schlüssel –
    beide Schreibweisen kommen vor. Ein Eintrag auf gleicher Höhe zählt
    deshalb mit, ein gleich eingerückter *Schlüssel* dagegen nicht: Der
    beendet die Liste.
    """
    indent = indent_of(line)
    if indent > device_indent:
        return True
    return indent == device_indent and line.strip().startswith("- ")


def _entry_indent(lines: list[str], devices: int, end: int, device_indent: int) -> int:
    """Die Einrückung übernehmen, die im Block schon benutzt wird."""
    for index in range(devices + 1, end):
        line = lines[index]
        if not line.strip():
            continue
        if not _in_list(line, device_indent):
            break
        if line.strip().startswith("- "):
            return indent_of(line)
    return device_indent + 2


def _end_of_list(lines: list[str], devices: int, end: int, device_indent: int) -> int:
    """Hinter den letzten Eintrag der Liste – vor eine allfällige Leerzeile
    oder den nächsten Schlüssel des Blocks."""
    last = devices + 1
    for index in range(devices + 1, end):
        line = lines[index]
        if not line.strip():
            continue
        if not _in_list(line, device_indent):
            break
        last = index + 1
    return last


def _append_integration(
    lines: list[str], entry_name: str, host: str, port: int = 8009
) -> str:
    """Kein google_cast in der Datei: einen ganzen Block ergänzen.

    Und zwar am Ende der ``integrations``-Liste, nicht am Ende der Datei –
    darunter stehen meist noch Benutzer, Szenen und Abläufe.
    """
    key = next(
        (
            index
            for index, line in enumerate(lines)
            if line.strip() == "integrations:"
        ),
        None,
    )
    if key is None:
        # Ohne Abschnitt gibt es nichts einzureihen – dann eben anlegen.
        lines = [*lines, "integrations:"]
        key = len(lines) - 1

    key_indent = indent_of(lines[key])
    indent = key_indent + 2
    insert = key + 1
    for index in range(key + 1, len(lines)):
        line = lines[index]
        if not line.strip():
            continue
        if not _in_list(line, key_indent):
            break
        if line.strip().startswith("- "):
            indent = indent_of(line)
        insert = index + 1

    lines[insert:insert] = [
        " " * indent + "- integration: google_cast",
        " " * (indent + 2) + "devices:",
        *_entry(indent + 4, entry_name, host, port),
    ]
    return "\n".join(lines) + "\n"


# ── Prüfung beim Start ─────────────────────────────────────────────────────


def duplicate_devices(integrations: list[dict]) -> list[str]:
    """Doppelt eingetragene Geräte finden (rein, testbar).

    Zwei Einträge mit derselben Adresse sind fast immer ein Versehen beim
    Kopieren einer Zeile. Der Hub legt dann zwei Entitäten mit derselben
    Kennung an – die zweite überschreibt die erste, und man sucht lange,
    warum ein Gerät den Zustand eines anderen zeigt.

    Bei Homematic zählt zusätzlich der Port: Dieselbe Adresse auf zwei
    Schnittstellen wäre zwar seltsam, aber nicht dasselbe Gerät.

    Und der Datenpunkt: Ein Aussenfühler (HmIP-STHO) legt Temperatur und
    Luftfeuchtigkeit auf denselben Kanal - zwei Einträge mit derselben
    Adresse sind dort kein Versehen, sondern der einzige Weg. Erst
    dieselbe Adresse *und* derselbe Datenpunkt sind eine kopierte Zeile.
    """
    problems: list[str] = []
    for block in integrations or []:
        if not isinstance(block, dict):
            continue
        name = str(block.get("integration") or "?")
        seen: dict[tuple, int] = {}
        for device in block.get("devices") or []:
            if not isinstance(device, dict):
                continue
            key = (
                str(device.get("address") or device.get("host") or ""),
                str(device.get("port") or ""),
                str(device.get("datapoint") or ""),
            )
            if not key[0]:
                continue
            seen[key] = seen.get(key, 0) + 1
        for (address, port, datapoint), count in sorted(seen.items()):
            if count > 1:
                where = f" (Port {port})" if port else ""
                wert = f", {datapoint}" if datapoint else ""
                problems.append(
                    f"{name}: {address}{where}{wert} steht {count}-mal in der "
                    "Geräteliste"
                )
    return problems


def unused_rooms(rooms: dict, entity_ids: set[str]) -> list[str]:
    """Raumzuordnungen, die auf nichts zeigen (rein, testbar).

    Meist ein umbenanntes oder ausgebautes Gerät. Die Zuordnung bleibt
    stehen und der Raum wirkt voller, als er ist.
    """
    problems: list[str] = []
    for room, members in (rooms or {}).items():
        missing = [entry for entry in members or [] if entry not in entity_ids]
        if missing:
            problems.append(f"Raum «{room}»: {', '.join(sorted(missing))} gibt es nicht")
    return problems


# ── Gliederung: Was steht wo in dieser Datei ─────────────────────────────
#
# Damit die App eine Bedienoberfläche zeigen kann, ohne dass jemand YAML
# liest – und ohne dass beim Zurückschreiben etwas verlorengeht. Die
# Gliederung nennt nur Zeilenbereiche; geändert wird weiterhin Text an
# Ort und Stelle.

# Wie die Abschnitte in der App heissen und in welcher Reihenfolge sie
# dort stehen sollen. Was hier fehlt, erscheint trotzdem – hinten, unter
# seinem eigenen Namen. Eine Datei mit einem unbekannten Schlüssel darf
# in der Übersicht nicht unsichtbar werden.
SECTION_LABELS: dict[str, str] = {
    "api": "Zugang",
    "location": "Standort",
    "integrations": "Geräte-Anbindungen",
    "rooms": "Räume",
    "users": "Benutzer",
    "scenes": "Szenen",
    "automations": "Abläufe",
    "energy": "Strom",
    "supabase": "Supabase",
    "guest_wifi": "Gäste-WLAN",
    "streaming": "Live-Bild",
    "push": "Push-Nachrichten",
    "update": "Update",
    "heartbeat": "Lebenszeichen",
}


def _top_level(lines: list[str]) -> list[tuple[str, int]]:
    """Die Schlüssel der obersten Ebene mit ihrer Zeile (rein, testbar).

    Ein Schlüssel der obersten Ebene beginnt in Spalte 0 und trägt einen
    Doppelpunkt. Kommentare und Leerzeilen zählen nicht – sie gehören zum
    Abschnitt darunter, weil sie ihn erklären.
    """
    treffer: list[tuple[str, int]] = []
    for index, line in enumerate(lines):
        if not line or line[0] in " \t#":
            continue
        if line.startswith("- "):
            continue
        name, sep, _rest = line.partition(":")
        if not sep or not name.strip() or name != name.strip():
            continue
        treffer.append((name.strip(), index))
    return treffer


def _start_with_comments(lines: list[str], start: int, floor: int) -> int:
    """Die Kommentarzeilen über einem Eintrag gehören zu ihm (rein).

    Wer einen Block bearbeitet, will die drei Zeilen Erklärung darüber
    mitnehmen – sie beschreiben genau ihn. `floor` ist die Grenze, unter
    die nicht gegangen wird (der Anfang des übergeordneten Abschnitts).

    Eine Leerzeile beendet die Kette. Das ist der Unterschied zwischen
    «dieser Kommentar erklärt den Eintrag darunter» und «hier steht ein
    abgeschalteter Block, und weiter unten fängt etwas Neues an»: Ohne
    diese Regel wanderte ein auskommentiertes «# - integration: tuya» am
    Ende der Liste zum nächsten Abschnitt.
    """
    zeile = start
    while zeile > floor and lines[zeile - 1].strip().startswith("#"):
        zeile -= 1
    return zeile


def outline(content: str) -> list[dict[str, object]]:
    """Die Abschnitte der Datei mit ihren Zeilenbereichen (rein, testbar).

    Jeder Eintrag: `key` (der YAML-Schlüssel), `label` (wie es in der App
    heisst), `start`/`end` (Zeilen, 0-basiert, Ende exklusiv) und bei
    `integrations` zusätzlich `items` – je Anbindung ein eigener Bereich,
    damit man eine einzelne bearbeiten kann statt aller vierzig.

    Zeilenbereiche und kein geparster Baum: Wer den Block zurückschreibt,
    schreibt genau das zurück, was er gesehen hat – samt Kommentaren, samt
    Reihenfolge, samt der Leerzeile, die jemand bewusst gesetzt hat.
    """
    lines = content.splitlines()
    oben = _top_level(lines)
    # Erst alle Anfänge – samt der Kommentarzeilen darüber, die den
    # Abschnitt erklären. Danach reicht jeder bis zum Anfang des
    # nächsten. Andersherum gerechnet gehörte der Kommentar über
    # «location» noch zum Abschnitt «api», und wer beide bearbeitete,
    # hätte ihn am Ende zweimal in der Datei.
    anfaenge = [
        _start_with_comments(lines, start, oben[position - 1][1] + 1 if position else 0)
        for position, (_name, start) in enumerate(oben)
    ]
    abschnitte: list[dict[str, object]] = []
    for position, (name, start) in enumerate(oben):
        ende = anfaenge[position + 1] if position + 1 < len(oben) else len(lines)
        eintrag: dict[str, object] = {
            "key": name,
            "label": SECTION_LABELS.get(name, name),
            "start": anfaenge[position],
            "end": ende,
        }
        if name == "integrations":
            eintrag["items"] = _integration_items(lines, start + 1, ende)
        abschnitte.append(eintrag)
    return abschnitte


def _integration_items(lines: list[str], start: int, end: int) -> list[dict[str, object]]:
    """Je Anbindung ein Bereich (rein, testbar).

    Auskommentierte Blöcke zählen mit und werden als solche gemeldet: In
    dieser Datei ist «# - integration: tuya» der übliche Weg, etwas
    vorübergehend abzuschalten, und in der Übersicht soll man es sehen
    statt es zu verlieren.
    """
    items: list[dict[str, object]] = []
    offen: dict[str, object] | None = None
    for index in range(start, end):
        roh = lines[index]
        text = roh.strip()
        kommentiert = text.startswith("#")
        kern = text.lstrip("#").strip() if kommentiert else text
        if kern.startswith("- integration:"):
            if offen is not None:
                # Bis zum Anfang des nächsten Blocks - und dessen
                # Kommentar gehört schon zu ihm, nicht mehr zu diesem.
                offen["end"] = _start_with_comments(lines, index, start)
                items.append(offen)
            name = kern.split(":", 1)[1].strip().strip("\"'")
            offen = {
                "name": name,
                "start": _start_with_comments(lines, index, start),
                # Wo der Eintrag selbst beginnt – ohne die Erklärzeilen
                # darüber. Nur dieser Teil darf der Schalter anfassen:
                # Nähme er einer Erklärung ihr «#», stünde plötzlich
                # «Die Hue-Bridge im Flur.» als YAML in der Datei.
                "code": index,
                "end": end,
                "enabled": not kommentiert,
            }
    if offen is not None:
        offen["end"] = end
        items.append(offen)
    # Nachlaufende Leerzeilen gehören zum nächsten, nicht zu diesem.
    for item in items:
        ende = int(item["end"])
        while ende > int(item["start"]) + 1 and lines[ende - 1].strip() == "":
            ende -= 1
        item["end"] = ende
    return items


def block_text(content: str, start: int, end: int) -> str:
    """Der Text eines Bereichs (rein, testbar)."""
    return "\n".join(content.splitlines()[start:end])


def replace_block(content: str, start: int, end: int, neu: str) -> str:
    """Einen Bereich durch neuen Text ersetzen (rein, testbar).

    Der Rest der Datei bleibt Zeichen für Zeichen, wie er war – das ist
    der ganze Zweck: Eine Bedienoberfläche darf einen Block ändern und
    nicht die Datei.
    """
    lines = content.splitlines()
    start = max(0, min(len(lines), start))
    end = max(start, min(len(lines), end))
    ersatz = neu.splitlines() if neu.strip() else []
    geaendert = lines[:start] + ersatz + lines[end:]
    text = "\n".join(geaendert)
    # Eine Datei endet mit einem Zeilenumbruch, wenn sie es vorher tat.
    return text + "\n" if content.endswith("\n") else text


# ── Einzelne Werte setzen ────────────────────────────────────────────────


def _find_key(lines: list[str], key: str, start: int, end: int, indent: int) -> int | None:
    """Die Zeile dieses Schlüssels auf dieser Ebene (rein)."""
    for index in range(start, min(end, len(lines))):
        line = lines[index]
        if not line.strip() or line.strip().startswith("#"):
            continue
        stufe = indent_of(line)
        if stufe < indent and line.strip():
            # Der Abschnitt ist zu Ende.
            return None
        if stufe != indent:
            continue
        name, sep, _rest = line.strip().partition(":")
        if sep and name.strip() == key:
            return index
    return None


def _section_end(lines: list[str], start: int, indent: int) -> int:
    """Bis wohin reicht der Abschnitt, der in `start` beginnt? (rein)"""
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip() or line.strip().startswith("#"):
            continue
        if indent_of(line) <= indent:
            return index
    return len(lines)


def set_scalar(content: str, path: list[str], value: object) -> str:
    """Einen einzelnen Wert setzen oder anlegen (rein, testbar).

    `path` ist der Weg dorthin, etwa `["location", "address"]`. Fehlt der
    Schlüssel, wird er am Ende seines Abschnitts ergänzt; fehlt der
    Abschnitt, entsteht er am Dateiende.

    Wieder als Textbearbeitung: Ein Parser schriebe die ganze Datei neu
    und nähme dabei jeden Kommentar mit. Wer in der App die Hausadresse
    einträgt, soll seine Notizen behalten.

    `None` entfernt die Zeile – so nimmt man eine Angabe zurück, ohne den
    Texteditor zu öffnen.
    """
    if not path:
        return content
    lines = content.splitlines()
    start, end, indent = 0, len(lines), 0
    for tiefe, key in enumerate(path[:-1]):
        zeile = _find_key(lines, key, start, end, indent)
        if zeile is None:
            # Der Zwischenschritt fehlt: Abschnitt anlegen und den Rest
            # darin – in einem Rutsch, damit die Einrückung stimmt.
            rest = path[tiefe:]
            block = [" " * indent + f"{rest[0]}:"]
            for weiter, name in enumerate(rest[1:], start=1):
                if weiter == len(rest) - 1:
                    block.append(" " * (indent + (weiter * 2)) + f"{name}: {_wert(value)}")
                else:
                    block.append(" " * (indent + (weiter * 2)) + f"{name}:")
            if value is None:
                return content
            stelle = end if end <= len(lines) else len(lines)
            # Eine Leerzeile davor, wenn wir einen neuen Abschnitt an
            # etwas anhängen: Ohne sie klebt er am vorigen.
            if stelle > 0 and lines[stelle - 1].strip():
                block.insert(0, "")
            neu = lines[:stelle] + block + lines[stelle:]
            return _join(content, neu)
        start = zeile + 1
        end = _section_end(lines, zeile, indent)
        indent += 2

    key = path[-1]
    zeile = _find_key(lines, key, start, end, indent)
    if zeile is not None:
        if value is None:
            del lines[zeile]
            return _join(content, lines)
        lines[zeile] = " " * indent + f"{key}: {_wert(value)}"
        return _join(content, lines)
    if value is None:
        return content
    # Neu anlegen: ans Ende des Abschnitts, vor den Leerzeilen davor.
    stelle = min(end, len(lines))
    while stelle > start and lines[stelle - 1].strip() == "":
        stelle -= 1
    lines.insert(stelle, " " * indent + f"{key}: {_wert(value)}")
    return _join(content, lines)


def _wert(value: object) -> str:
    """Einen Python-Wert als YAML schreiben (rein)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return quote(str(value))


def _join(content: str, lines: list[str]) -> str:
    text = "\n".join(lines)
    return text + "\n" if content.endswith("\n") else text


def toggle_block(content: str, start: int, end: int, enabled: bool) -> str:
    """Einen Bereich aus- oder wieder einkommentieren (rein, testbar).

    Der übliche Weg, eine Anbindung vorübergehend stillzulegen, ist in
    dieser Datei das Kommentarzeichen – so steht sie noch da, mit allen
    Zugangsdaten, und ist in einer Minute wieder zurück. In der App soll
    das ein Schalter sein und keine Fingerübung.

    Ausgeschaltet wird mit «# » an der bisherigen Einrückung, damit die
    Zeilen untereinander bleiben; eingeschaltet wird genau dieses eine
    Zeichenpaar wieder entfernt. Leerzeilen bleiben leer.

    Auch schon kommentierte Zeilen bekommen ihr «# » – aus «# Die Bridge
    im Flur» wird «# # Die Bridge im Flur». Das sieht im Texteditor
    ungewohnt aus und ist der Preis dafür, dass Ein und Aus einander
    genau aufheben: Ohne die zweite Ebene müsste das Einschalten raten,
    welche Kommentarzeile Code war und welche eine Erklärung – und aus
    «# Die Bridge im Flur» würde YAML.

    Der Aufrufer übergibt darum den Bereich ohne die Erklärzeilen davor
    (`code` in der Gliederung), dann bleibt der Fall selten.
    """
    lines = content.splitlines()
    start = max(0, min(len(lines), start))
    end = max(start, min(len(lines), end))
    inhalt = [lines[i] for i in range(start, end) if lines[i].strip()]
    if not inhalt:
        return content
    # Das Kommentarzeichen kommt an die Einrückung des Blocks, nicht an
    # die jeder einzelnen Zeile: So steht «#» in einer Spalte und die
    # Struktur darunter bleibt sichtbar - genau die Form, in der solche
    # Blöcke in dieser Datei von Hand stehen.
    basis = min(indent_of(line) for line in inhalt)
    for index in range(start, end):
        line = lines[index]
        if not line.strip():
            continue
        if enabled:
            # Beim Einschalten zählt die Einrückung *dieser* Zeile, nicht
            # die des Blocks: Sonst bliebe eine Zeile stehen, die jemand
            # von Hand an ihrer eigenen Einrückung auskommentiert hat -
            # «- integration: hue» wäre wieder in Betrieb und «host:»
            # noch immer ein Kommentar. Genau so ist es beim Prüfen am
            # echten Hub passiert.
            stufe = indent_of(line)
            rest = line[stufe:]
            if rest.startswith("# "):
                lines[index] = " " * stufe + rest[2:]
            elif rest.startswith("#"):
                lines[index] = " " * stufe + rest[1:]
        else:
            # Beim Ausschalten dagegen die Kante des Blocks: So steht das
            # «#» in einer Spalte und die Struktur bleibt lesbar.
            lines[index] = " " * basis + "# " + line[basis:]
    return _join(content, lines)
