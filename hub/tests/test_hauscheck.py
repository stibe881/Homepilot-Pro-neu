"""Die Rundum-Prüfung (Punkt 491 der Werkbank).

Der Fall: Man steht im Haus, etwas geht nicht, und man weiss nicht,
welches der fünf Werkzeuge die Frage beantwortet.
"""

from homepilot import hauscheck


def test_auffaellige_zeilen_findet_die_woerter_an_denen_man_haengenbleibt():
    text = "\n".join(
        [
            "Storen: alles in Ordnung",
            "Gateway antwortet nicht",
            "Letzte Meldung: 12:04",
            "Token abgelaufen",
        ]
    )
    assert hauscheck.auffaellige_zeilen(text) == [
        "Gateway antwortet nicht",
        "Token abgelaufen",
    ]


def test_dieselbe_zeile_steht_nur_einmal_da():
    text = "Fehler: X\nFehler: X\nFehler: Y"
    assert hauscheck.auffaellige_zeilen(text) == ["Fehler: X", "Fehler: Y"]


def test_eine_ruhige_ausgabe_ergibt_nichts():
    assert hauscheck.auffaellige_zeilen("Alles gut.\nStand: 12:00") == []
    assert hauscheck.auffaellige_zeilen("") == []


def test_unauffaellig_ist_auch_eine_auskunft():
    """«unauffällig» heisst: gelaufen und nichts gefunden - nicht «Lücke»."""
    zeilen = hauscheck.zusammenfassung(
        [
            {"name": "Storen", "auffaellig": []},
            {"name": "Kamera", "fehlt": "nach 120 s abgebrochen"},
            {"name": "Push", "auffaellig": ["Token abgelaufen", "Fehler: X"]},
        ]
    )
    assert zeilen[0] == "  Storen: unauffällig"
    assert "lief nicht" in zeilen[1]
    assert "2 Zeile(n)" in zeilen[2]
    # Die Zeilen selbst stehen darunter - sonst müsste man doch wieder
    # das einzelne Werkzeug aufrufen.
    assert "      Token abgelaufen" in zeilen


def test_hoechstens_drei_zeilen_je_werkzeug():
    """Eine Zusammenfassung, die alles zeigt, ist keine."""
    viele = [f"Fehler {n}" for n in range(10)]
    zeilen = hauscheck.zusammenfassung([{"name": "X", "auffaellig": viele}])
    assert len(zeilen) == 4


# ── Wie gross die Ablage ist (Punkt 426) ──────────────────────────────────


def test_die_ablage_nennt_die_groesste_sammlung_zuerst(tmp_path):
    from homepilot.core.persistence import DataStore

    store = DataStore(tmp_path / "d.json")
    store.set("klein", [{"a": 1}])
    store.set("gross", [{"text": "x" * 200} for _ in range(5)])
    store.set("audit", [{"wer": "Stefan"}])

    umfang = {zeile["key"]: zeile for zeile in store.umfang()}
    assert store.umfang()[0]["key"] == "gross"
    assert umfang["gross"]["zeilen"] == 5
    assert umfang["gross"]["bytes"] > umfang["klein"]["bytes"]
    # Was nie in einen Export darf, ist gekennzeichnet - sonst wundert
    # sich jemand, warum «audit» gross ist und in seiner Datei fehlt.
    assert umfang["audit"]["geheim"] is True
    assert umfang["klein"]["geheim"] is False
    assert store.datei_bytes() > 0
