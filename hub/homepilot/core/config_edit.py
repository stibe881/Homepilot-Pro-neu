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
