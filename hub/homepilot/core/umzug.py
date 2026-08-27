"""Einen Menschen im Datenbestand umbenennen – überall auf einmal.

Der Anlass: «Ich habe meinen Namen von Stefan in stibe geändert – seitdem
habe ich keinen Zugriff mehr», und danach: «Stefan kann entfernt werden,
aber alle Einstellungen, die bei Stefan gemacht wurden, sollen bei stibe
sein.»

Wer sich **in der App** umbenennt, braucht das hier nicht: Diese Route
zieht alles mit (api/routes/users.py). Wer den Namen dagegen in der
``config.yaml`` ändert, kann das nicht – der Hub sieht nach dem Neustart
bloss einen neuen Namen und hat keine Möglichkeit zu wissen, dass es
derselbe Mensch ist. Alles, was nach Namen abgelegt ist, bleibt dann beim
alten stehen:

  - **Der Zugang selbst.** Anmelde-Adresse und offene Sitzungen.
  - **Was einem gehört.** Favoriten, Kachel-Reihenfolgen, die angemeldeten
    Telefone samt Kategorien.
  - **Was einem zugeteilt ist.** Aufgaben, Ämtli, Punkte, Erinnerungen.
  - **Die Ortungszone.** Sie heisst nach dem Vornamen – nach einer
    Umbenennung standen zwei Zeilen in der Anwesenheit, dieselbe Person
    zweimal, eine davon für immer auf ihrem alten Stand.

Deshalb dieses Werkzeug. Es rechnet nur – hinein kommt der ganze
Datenbestand, heraus ein neuer plus ein Bericht, was sich bewegt hat. Wer
schreibt, ist die Befehlszeile unten, und die tut es nur auf ausdrückliche
Ansage.
"""

from __future__ import annotations

from typing import Any

from . import presence

#: Listen, in denen ein Mensch mit seinem Namen steht, und das Feld dazu.
NAMENSLISTEN: tuple[tuple[str, str], ...] = (
    ("users", "name"),
    ("emails", "name"),
    ("sessions", "user"),
    ("push_devices", "user"),
    ("push_prefs", "user"),
    ("user_prefs", "user"),
)

#: Listen, die an der Ortungszone hängen (Vorname, kleingeschrieben).
ZONENLISTEN: tuple[tuple[str, str], ...] = (
    ("person_prefs", "zone"),
    ("presence_last", "zone"),
    ("presence_history", "person"),
)

#: Felder in den Familienlisten, die einen Menschen nennen. `members` ist
#: die Reihe eines Ämtli und darum eine Liste, nicht ein Name.
FAMILIENFELDER: tuple[str, ...] = ("member", "author", "last_by", "by", "for")
FAMILIENREIHEN: tuple[str, ...] = ("members", "empfaenger", "quittiert")


def _zeile_umschreiben(row: dict[str, Any], alt: str, neu: str) -> dict[str, Any]:
    """Eine Familienzeile auf den neuen Namen (rein)."""
    geaendert = dict(row)
    for feld in FAMILIENFELDER:
        if str(geaendert.get(feld) or "") == alt:
            geaendert[feld] = neu
    for feld in FAMILIENREIHEN:
        werte = geaendert.get(feld)
        if isinstance(werte, list):
            geaendert[feld] = [neu if str(w) == alt else w for w in werte]
    # Abstimmungen: der Name steht im Schlüssel, nicht im Wert.
    stimmen = geaendert.get("votes")
    if isinstance(stimmen, dict) and alt in stimmen:
        stimmen = dict(stimmen)
        stimmen[neu] = stimmen.pop(alt)
        geaendert["votes"] = stimmen
    return geaendert


def umziehen(
    data: dict[str, Any], alt: str, neu: str, alte_zone: str = "", neue_zone: str = ""
) -> tuple[dict[str, Any], dict[str, int]]:
    """Alles von einem Namen auf einen anderen (rein, testbar).

    Zurück kommen der neue Datenbestand und ein Bericht «Liste → Anzahl
    geänderter Zeilen». Der Bericht ist der eigentliche Ertrag: Ein
    Werkzeug, das schweigend etwas verschiebt, prüft niemand nach.

    Die Zonen sind getrennt anzugeben, weil sie nach dem Vornamen heissen
    und kleingeschrieben sind – `geofence.zonenkennung` rechnet sie aus.
    Ohne Angabe bleiben die Ortungslisten unberührt.
    """
    alt = str(alt or "").strip()
    neu = str(neu or "").strip()
    if not alt or not neu or alt == neu:
        return dict(data), {}

    ergebnis = dict(data)
    bericht: dict[str, int] = {}

    def zaehlen(schluessel: str, anzahl: int) -> None:
        if anzahl:
            bericht[schluessel] = anzahl

    for schluessel, feld in NAMENSLISTEN:
        rows = ergebnis.get(schluessel)
        if not isinstance(rows, list):
            continue
        neue = [
            {**row, feld: neu}
            if isinstance(row, dict) and str(row.get(feld) or "") == alt
            else row
            for row in rows
        ]
        zaehlen(schluessel, sum(1 for a, b in zip(rows, neue, strict=True) if a is not b))
        ergebnis[schluessel] = neue

    if alte_zone and neue_zone and alte_zone != neue_zone:
        for schluessel, feld in ZONENLISTEN:
            rows = ergebnis.get(schluessel)
            if not isinstance(rows, list):
                continue
            neue = presence.zone_umziehen(rows, alte_zone, neue_zone, feld)
            zaehlen(schluessel, sum(1 for row in rows if str(row.get(feld) or "") == alte_zone))
            ergebnis[schluessel] = neue

    for schluessel, rows in list(ergebnis.items()):
        if not schluessel.startswith("family_") or not isinstance(rows, list):
            continue
        neue = [
            _zeile_umschreiben(row, alt, neu) if isinstance(row, dict) else row
            for row in rows
        ]
        zaehlen(schluessel, sum(1 for a, b in zip(rows, neue, strict=True) if a != b))
        ergebnis[schluessel] = neue

    return ergebnis, bericht


def bericht_zeilen(bericht: dict[str, int]) -> list[str]:
    """Der Bericht als Zeilen zum Lesen (rein, testbar)."""
    if not bericht:
        return ["Nichts gefunden – kein Eintrag trägt diesen Namen."]
    return [f"  {schluessel}: {anzahl}" for schluessel, anzahl in sorted(bericht.items())]


if __name__ == "__main__":
    import argparse
    import json
    import sys
    from pathlib import Path

    from ..integrations.geofence import zonenkennung

    parser = argparse.ArgumentParser(
        description="Einen Menschen im Datenbestand umbenennen (Hub vorher anhalten)"
    )
    # Zwei Wege zur Datei, weil man den einen kennt und den anderen nicht:
    # Der Pfad zur config.yaml steht in jedem Startbefehl des Hubs, der zur
    # Datendatei nirgends - sie liegt daneben, wenn nichts anderes
    # eingetragen ist.
    parser.add_argument(
        "-c", "--config", help="Pfad zur config.yaml (die Datendatei steht darin)"
    )
    parser.add_argument("-d", "--data", help="Pfad zur homepilot-data.json")
    parser.add_argument("--von", required=True, help="Bisheriger Name, z.B. Stefan")
    parser.add_argument("--nach", required=True, help="Neuer Name, z.B. Stibe")
    parser.add_argument(
        "--schreiben",
        action="store_true",
        help="Wirklich speichern. Ohne das wird nur gezeigt, was geschähe.",
    )
    args = parser.parse_args()

    if not (args.config or args.data):
        parser.error("Entweder --config oder --data angeben.")
    if args.data:
        pfad = Path(args.data)
    else:
        from .config import load_config

        pfad = Path(load_config(args.config).data_file or "")
    if not pfad.is_file():
        print(f"✗ Keine Datendatei unter {pfad}")
        sys.exit(1)
    bestand = json.loads(pfad.read_text("utf-8"))
    neuer, bericht = umziehen(
        bestand,
        args.von,
        args.nach,
        zonenkennung(args.von),
        zonenkennung(args.nach),
    )
    print(f"{args.von} → {args.nach}")
    for zeile in bericht_zeilen(bericht):
        print(zeile)
    if not args.schreiben:
        print("\nNur angesehen. Mit --schreiben wird es gespeichert.")
        sys.exit(0)
    # Erst die Sicherung, dann die Änderung: Ein Datenbestand ist das
    # Gedächtnis des Hauses, und ein Werkzeug, das ihn ohne Netz umbaut,
    # hat schon einmal jemandem den Abend verdorben.
    sicherung = pfad.with_suffix(pfad.suffix + ".vor-umzug")
    sicherung.write_text(json.dumps(bestand, ensure_ascii=False, indent=2), "utf-8")
    pfad.write_text(json.dumps(neuer, ensure_ascii=False, indent=2), "utf-8")
    print(f"\nGespeichert. Die alte Fassung liegt in {sicherung.name}.")
