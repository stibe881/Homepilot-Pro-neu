"""Der Update-Dienst, der auf dem Docker-Host neben dem Hub läuft.

Er gehört nicht zum Paket – er liegt unter deploy/ und wird auf den Host
kopiert. Getestet wird er hier trotzdem: Seine Auskunft darüber, was er
kann und ob der Zugang zu EAS bereitliegt, ist das, worauf sich der Hub
verlässt, bevor er einen iOS-Build anstösst. Stimmt sie nicht, baut das
Haus zwar weiter, aber in TestFlight kommt stillschweigend nichts an –
und genau das hat schon einmal einen Abend gekostet.
"""

import importlib.util
from pathlib import Path

import pytest

LISTENER = Path(__file__).resolve().parents[2] / "deploy" / "update-listener.py"


def load_listener(monkeypatch, credentials: Path | None, env_token: str | None):
    """Das Skript frisch laden – es liest seine Umgebung beim Import."""
    monkeypatch.setenv("UPDATE_SECRET", "egal")
    if credentials is None:
        monkeypatch.delenv("UPDATE_CREDENTIALS", raising=False)
    else:
        monkeypatch.setenv("UPDATE_CREDENTIALS", str(credentials))
    if env_token is None:
        monkeypatch.delenv("EXPO_TOKEN", raising=False)
    else:
        monkeypatch.setenv("EXPO_TOKEN", env_token)

    spec = importlib.util.spec_from_file_location("homepilot_update_listener", LISTENER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def credentials(tmp_path):
    return tmp_path / "github-credentials.env"


def test_the_listener_says_it_understands_the_ios_switch(monkeypatch, credentials):
    """Woran der Hub eine veraltete Fassung erkennt: Sie zählt «ios» nicht
    mit auf. Verschwindet dieser Eintrag, laufen iOS-Builds wieder ins
    Leere, ohne dass es jemandem auffällt."""
    listener = load_listener(monkeypatch, credentials, None)
    assert "ios" in listener.FEATURES
    assert "status" in listener.FEATURES


def test_expo_token_is_found_in_the_credentials_file(monkeypatch, credentials):
    """Der Bau liest die Zugangsdatei selbst ein. Also muss der Dienst dort
    ebenfalls nachsehen – sonst meldete er «fehlt», sobald jemand den
    Token einträgt, ohne den Dienst neu zu starten, und der Hub verweigerte
    einen Build, der längst möglich wäre."""
    credentials.write_text(
        "GITHUB_USER=stibe881\nEXPO_TOKEN=abc123\nUPDATE_SECRET=x\n",
        encoding="utf-8",
    )
    listener = load_listener(monkeypatch, credentials, None)
    assert listener.has_expo_token() is True


def test_expo_token_missing_or_empty_counts_as_missing(monkeypatch, credentials):
    """Eine leere Zeile ist kein Token – sonst hiesse es «da», und der Bau
    überspränge den iOS-Teil trotzdem."""
    credentials.write_text("EXPO_TOKEN=\nGITHUB_USER=stibe881\n", encoding="utf-8")
    assert load_listener(monkeypatch, credentials, None).has_expo_token() is False

    # Gar keine Zeile, und die Datei fehlt ganz: beides «fehlt», kein Fehler.
    credentials.write_text("GITHUB_USER=stibe881\n", encoding="utf-8")
    assert load_listener(monkeypatch, credentials, None).has_expo_token() is False
    assert (
        load_listener(monkeypatch, credentials.parent / "gibtsnicht", None)
        .has_expo_token()
        is False
    )


def test_expo_token_from_the_environment_counts_too(monkeypatch, credentials):
    """systemd reicht die Zugangsdatei als Umgebung herein – dann steht der
    Token dort und nicht unbedingt in einer Datei, die dieser Dienst sieht."""
    listener = load_listener(monkeypatch, credentials, "aus-der-umgebung")
    assert listener.has_expo_token() is True


def test_the_token_itself_never_leaves_the_host(monkeypatch, credentials):
    """Nur ja/nein geht an den Hub. Ein Zugangs-Token, der über die
    Schnittstelle wandert, steht am Ende in einem Protokoll."""
    credentials.write_text("EXPO_TOKEN=streng-geheim\n", encoding="utf-8")
    listener = load_listener(monkeypatch, credentials, None)
    assert listener.has_expo_token() is True
    assert "streng-geheim" not in str(listener.FEATURES)


def test_a_second_build_is_refused_out_loud(monkeypatch, credentials):
    """Der Kern des Ärgers: Läuft schon ein Bau, wurde der zweite Aufruf
    verworfen - beantwortet aber mit «Bau gestartet». Wer während der
    Wartezeit auf Portainer nochmals drückte, sah eine Bestätigung und
    bekam nichts. Die Sperre hält jetzt der Aufrufer, damit er es sagen
    kann."""
    listener = load_listener(monkeypatch, credentials, None)
    assert listener._running.acquire(blocking=False) is True
    try:
        # Solange gebaut wird, ist die Sperre belegt - genau daran erkennt
        # do_POST, dass es 409 statt 202 antworten muss.
        assert listener._running.acquire(blocking=False) is False
    finally:
        listener._running.release()
    # Danach ist wieder frei.
    assert listener._running.acquire(blocking=False) is True
    listener._running.release()


def test_a_warning_keeps_the_lines_that_say_what_to_do(monkeypatch, credentials):
    """Die Abhilfe steht unter der Warnung, nicht in ihr.

    rebuild-hub.sh schreibt «⚠ iOS-Build liess sich nicht anstossen» und
    darunter eingerückt die Schritte im Apple-Portal. Fielen die weg,
    stünde in der App nur, dass etwas schiefging – und die Anleitung läge
    im Journal auf dem Host, wo sie niemand sucht.
    """
    listener = load_listener(monkeypatch, credentials, None)
    for zeile in (
        "⚠ iOS-Build liess sich nicht anstossen - das Hub-Update selbst",
        "  ist davon unberührt.",
        "  Es fehlt die App-Gruppe im Apple-Portal. Einmalig:",
        "  1. developer.apple.com → Identifiers → App Groups → +",
    ):
        listener._handle_line(zeile)

    assert len(listener._status["warnings"]) == 1
    warnung = listener._status["warnings"][0]
    assert warnung.startswith("iOS-Build liess sich nicht anstossen")
    assert "Es fehlt die App-Gruppe im Apple-Portal" in warnung
    assert "developer.apple.com" in warnung


def test_indented_lines_elsewhere_do_not_land_in_the_warning(monkeypatch, credentials):
    """Eingerückt ist im Bau-Protokoll vieles – die Platz-Notiz etwa.

    Nur was direkt unter einer Warnung steht, gehört zu ihr. Sonst
    sammelte eine einzige Warnung nach und nach den halben Lauf ein.
    """
    listener = load_listener(monkeypatch, credentials, None)
    listener._handle_line("⚠ Web-Bau fehlgeschlagen")
    listener._handle_line("  die alte Fassung bleibt online.")
    listener._handle_line("→ Platz:")
    listener._handle_line("  frei: 12G")

    assert len(listener._status["warnings"]) == 1
    assert "die alte Fassung bleibt online." in listener._status["warnings"][0]
    assert "frei: 12G" not in listener._status["warnings"][0]


def test_a_new_run_starts_without_the_previous_warning_open(monkeypatch, credentials):
    """Zwei Läufe hintereinander: Der zweite beginnt mit leerer Liste.

    Bliebe die Sammelstelle des ersten offen, liefe die erste eingerückte
    Zeile des zweiten Laufs in eine Warnung, die es nicht mehr gibt.
    """
    listener = load_listener(monkeypatch, credentials, None)
    listener._handle_line("⚠ Etwas ging schief")
    listener._warn_open = False  # was build() beim Start ohnehin tut
    listener._status["warnings"] = []
    listener._handle_line("  eine eingerückte Zeile")

    assert listener._status["warnings"] == []


# ── Das Gedächtnis für den letzten Lauf ──────────────────────────────────
#
# Der Dienst startet sich nach einem Update selbst neu, und damit war der
# Ausgang des Laufs bisher weg. Wer danach in die App schaute, sah «nichts
# los» - auch nach einem Lauf, der mitten im Ausrollen gescheitert war.


def test_a_run_survives_a_restart_of_the_service(monkeypatch, tmp_path):
    modul = load_listener(monkeypatch, None, None)
    datei = tmp_path / "update-status.json"
    stand = {
        "state": "error",
        "stage": "deploy_wait",
        "message": "Portainer hat den Container nicht gewechselt",
        "detail": "Re-pull image ist im Stack an.",
        "warnings": [],
        "started_at": 1.0,
        "finished_at": 2.0,
        "ios": False,
    }
    assert modul.letzter_lauf_schreiben(str(datei), stand) is True
    assert modul.letzter_lauf_lesen(str(datei)) == stand


def test_a_broken_memory_does_not_stop_the_service(monkeypatch, tmp_path):
    # Halb geschriebene oder von Hand verbogene Datei: Der Dienst muss
    # trotzdem starten, sonst nimmt ein kaputtes Nebenzimmer das ganze
    # Haus mit.
    modul = load_listener(monkeypatch, None, None)
    kaputt = tmp_path / "update-status.json"
    kaputt.write_text("{ das ist kein json", encoding="utf-8")
    assert modul.letzter_lauf_lesen(str(kaputt)) is None
    assert modul.letzter_lauf_lesen(str(tmp_path / "gibt-es-nicht.json")) is None
    # Eine Liste ist gültiges JSON, aber kein Stand.
    kaputt.write_text("[1, 2, 3]", encoding="utf-8")
    assert modul.letzter_lauf_lesen(str(kaputt)) is None


def test_an_unwritable_place_is_reported_not_raised(monkeypatch, tmp_path):
    # Fehlt das Verzeichnis, ist das eine Meldung wert - aber kein Grund,
    # den gerade beendeten Bau nachträglich scheitern zu lassen.
    modul = load_listener(monkeypatch, None, None)
    ziel = tmp_path / "gibt-es-nicht" / "update-status.json"
    assert modul.letzter_lauf_schreiben(str(ziel), {"state": "ok"}) is False


def test_the_service_announces_that_it_remembers(monkeypatch):
    # Der Hub fragt die Fähigkeiten ab, bevor er etwas anzeigt, das
    # ältere Dienste nicht liefern.
    modul = load_listener(monkeypatch, None, None)
    assert "last_run" in modul.FEATURES


# ── Fremde Ausgabe ist keine Meldung des Bau-Skripts ─────────────────────
#
# Durch dieselbe Ausgabe laufen die Werkzeuge, die das Skript aufruft.
# `eas build` schreibt «⚠️ Detected that your app uses Expo Go for
# development, this is not recommended when building production apps» -
# und dieser Satz über die App-Entwicklung stand danach in der App als
# Hinweis zum letzten Update.

EXPO_HINWEIS = (
    "⚠️  Detected that your app uses Expo Go for development, this is not "
    "recommended when building production apps."
)


def test_only_the_scripts_own_markers_count(monkeypatch, credentials):
    listener = load_listener(monkeypatch, credentials, None)
    assert listener.eigene_meldung("⚠ Web-Bau fehlgeschlagen", "⚠") is True
    assert listener.eigene_meldung("✗ Abgebrochen", "✗") is True
    # Das Emoji-Warnzeichen trägt ein unsichtbares Zusatzzeichen hinter
    # dem Dreieck - daran erkennt man die fremde Meldung.
    assert listener.eigene_meldung(EXPO_HINWEIS, "⚠") is False
    # Und ein Warnzeichen mitten im Satz ist ohnehin keine Meldung.
    assert listener.eigene_meldung("Build failed ✗ siehe oben", "✗") is False


def test_the_expo_go_notice_is_not_a_warning_of_the_update(monkeypatch, credentials):
    listener = load_listener(monkeypatch, credentials, None)
    listener._status["state"] = "running"
    listener._handle_line(EXPO_HINWEIS)

    assert listener._status["warnings"] == []
    # Sichtbar bleibt sie trotzdem: als laufende Zeile, damit man sieht,
    # dass sich etwas tut.
    assert listener._status["message"] == EXPO_HINWEIS


def test_a_foreign_cross_does_not_fail_the_run(monkeypatch, credentials):
    """Ein ✗ aus einem fremden Werkzeug hätte den Lauf als gescheitert
    gemeldet - mitten in einem Bau, der noch läuft."""
    listener = load_listener(monkeypatch, credentials, None)
    listener._status["state"] = "running"
    listener._handle_line("✗️ some tool being decorative")

    assert listener._status["state"] == "running"


def test_abort_is_announced_and_knows_when_it_is_too_late(monkeypatch, credentials):
    """Abbrechen gibt es - aber nur, solange es das Ausrollen verhindert.

    «Abbrechen» nach dem Portainer-Webhook wäre eine leere Geste: Das
    Ausrollen läuft dann bei Portainer weiter, und ein Dienst, der
    trotzdem «abgebrochen» meldet, lügt. Die Regel steht als reine
    Funktion da, damit genau diese Grenze festgehalten ist.
    """
    listener = load_listener(monkeypatch, credentials, None)
    assert "abort" in listener.FEATURES

    # Vor dem Webhook: abbrechen erlaubt, der alte Stand bleibt stehen.
    for stage in ("clone", "web", "build", "built", "ios"):
        moeglich, _ = listener.abbruch_moeglich("running", stage)
        assert moeglich, stage

    # Ab dem Webhook: zu spät - ablehnen statt vortäuschen.
    for stage in ("deploy", "deploy_wait", "manual", "done"):
        moeglich, grund = listener.abbruch_moeglich("running", stage)
        assert not moeglich, stage
        assert "spät" in grund

    # Ohne laufenden Bau gibt es nichts abzubrechen.
    moeglich, grund = listener.abbruch_moeglich("idle", None)
    assert not moeglich
    assert "kein Bau" in grund


def test_die_vorschau_liest_betreffzeilen_und_zugangswerte(monkeypatch, credentials, tmp_path):
    """Die Bausteine der Update-Vorschau: GitHub-Antworten und Zugangsdatei.

    «Update wirklich starten?» soll sagen, was das Update bringt - die
    Betreffzeilen holt dieser Dienst bei GitHub. Hier steht fest, wie er
    GitHubs Listen liest (nur die erste Zeile jeder Nachricht, Unsinn
    fällt raus) und dass er die Zugangsdatei samt Anführungszeichen und
    Wagenrückläufen verkraftet.
    """
    listener = load_listener(monkeypatch, credentials, None)
    assert "preview" in listener.FEATURES

    commits = [
        {"commit": {"message": "Joyn auf der Fernbedienung\n\nLanger Text"}},
        # Zusammenführungen sind Buchhaltung des Zweige-Abgleichs, keine
        # Änderung - erkannt an den zwei Eltern oder am Betreff.
        {
            "commit": {"message": "Merge remote-tracking branch 'origin/main'"},
            "parents": [{"sha": "a"}, {"sha": "b"}],
        },
        {"commit": {"message": "Merge branch 'x' ohne parents-Feld"}},
        {"commit": {"message": "Stopp-Knopf auf den Medienkarten"}},
        {"commit": {"message": ""}},
        "unsinn",
        None,
    ]
    assert listener.betreffzeilen(commits) == [
        "Joyn auf der Fernbedienung",
        "Stopp-Knopf auf den Medienkarten",
    ]
    assert listener.betreffzeilen(None) == []

    datei = tmp_path / "zugang.env"
    datei.write_text(
        'GITHUB_TOKEN="geheim"\r\nHOMEPILOT_BRANCH=main\nKAPUTT\n', encoding="utf-8"
    )
    werte = listener.zugangswerte_lesen(str(datei))
    assert werte["GITHUB_TOKEN"] == "geheim"
    assert werte["HOMEPILOT_BRANCH"] == "main"
    # Eine fehlende Datei ist kein Fehler, nur eine leere Auskunft.
    assert listener.zugangswerte_lesen(str(tmp_path / "fehlt.env")) == {}


# ── Die Bauzeit als Rückfallebene der Vorschau ─────────────────────────
#
# Gemeldet aus dem Haus: «ich möchte hier sehen, was das nächste update
# mitbringt. momentan stehen da auch sachen drin, die bereits im letzten
# update gemacht wurden.» Der laufende Stand ist eine örtliche
# Zusammenführung, die GitHub nicht kennt - der Vergleich scheiterte
# jedes Mal. Die Bauzeit kennt der Hub dagegen immer.


def test_bauzeit_wird_geprueft_und_vereinheitlicht(monkeypatch, credentials):
    modul = load_listener(monkeypatch, credentials, None)
    # Beide Schreibweisen ergeben denselben Zeitpunkt in UTC.
    assert modul.bauzeit_sauber("2026-09-09T04:34:11Z") == "2026-09-09T04:34:11Z"
    assert modul.bauzeit_sauber("2026-09-09T06:34:11+02:00") == "2026-09-09T04:34:11Z"


def test_was_keine_zeit_ist_kommt_nicht_in_die_adresse(monkeypatch, credentials):
    """Sie wandert in eine URL - da gehört nichts Ungeprüftes hinein."""
    modul = load_listener(monkeypatch, credentials, None)
    assert modul.bauzeit_sauber("unbekannt") == ""
    assert modul.bauzeit_sauber("") == ""
    assert modul.bauzeit_sauber(None) == ""
    assert modul.bauzeit_sauber("../../etwas") == ""


def test_die_vorschau_schlaegt_ueber_die_bauzeit_nach(monkeypatch, credentials):
    """Der eigentliche Fall: GitHub kennt den laufenden Stand nicht."""
    import urllib.error

    modul = load_listener(monkeypatch, credentials, None)
    credentials.write_text("GITHUB_TOKEN=t\n", encoding="utf-8")
    modul._vorschau_cache = None
    gefragt: list[str] = []

    def fake_github(pfad, token):
        gefragt.append(pfad)
        if pfad.startswith(f"/repos/{modul.REPO}/compare/a81bb71"):
            # Der zusammengeführte Stand - den kennt GitHub nicht.
            raise urllib.error.HTTPError(pfad, 404, "Not Found", None, None)
        if "until=" in pfad:
            return [{"sha": "7f1987e"}]
        if pfad.startswith(f"/repos/{modul.REPO}/branches"):
            # Seit die Vorschau alle Zweige ansieht, gehört auch das
            # hierher - sonst gälte die Auskunft als nicht genau.
            return [{"name": "main"}]
        if pfad.startswith(f"/repos/{modul.REPO}/compare/7f1987e"):
            return {"commits": [{"commit": {"message": "Etwas Neues"}, "parents": [{}]}]}
        raise AssertionError(f"unerwartet: {pfad}")

    monkeypatch.setattr(modul, "_github", fake_github)
    antwort = modul.vorschau("a81bb71", "2026-09-09T04:34:11Z")

    assert antwort["exact"] is True
    assert antwort["commits"] == ["Etwas Neues"]
    # Und der Umweg wurde wirklich gegangen, nicht geraten.
    assert any("until=" in pfad for pfad in gefragt)


def test_ohne_bauzeit_bleibt_es_bei_der_alten_naeherung(monkeypatch, credentials):
    """Ein älteres Abbild schickt keine Bauzeit - dann wie bisher, und
    ehrlich als «nicht genau» gekennzeichnet."""
    import urllib.error

    modul = load_listener(monkeypatch, credentials, None)
    credentials.write_text("GITHUB_TOKEN=t\n", encoding="utf-8")
    modul._vorschau_cache = None

    def fake_github(pfad, token):
        if "/compare/" in pfad:
            raise urllib.error.HTTPError(pfad, 404, "Not Found", None, None)
        if "/branches" in pfad:
            return [{"name": "main"}]
        return [{"commit": {"message": "Jüngstes"}, "parents": [{}]}]

    monkeypatch.setattr(modul, "_github", fake_github)
    antwort = modul.vorschau("a81bb71", "")
    assert antwort["exact"] is False
    assert antwort["commits"] == ["Jüngstes"]


# ── Der Bau nimmt alle Zweige, die Vorschau muss sie auch ansehen ──────
#
# Der gefährlichste der gefundenen Fehler: Gebaut wird BRANCH *plus alle
# übrigen Zweige* (HOMEPILOT_MERGE_ALL). Verglichen wurde nur gegen
# einen. Wer auf einem Arbeitszweig eincheckt und noch nicht gestossen
# hat, dessen Arbeit brächte das nächste Update sehr wohl mit - der
# Dialog sagte trotzdem «Auf dem Server liegt nichts Neues». Ein
# falscher Freibrief, und genau die Sorte Fehler, vor der die CLAUDE.md
# warnt: «Teuer ist der Zweig, der still zurückfällt.»


def _commit(sha, betreff, datum):
    return {
        "sha": sha,
        "commit": {"message": betreff, "committer": {"date": datum}},
        "parents": [{}],
    }


def test_zweignamen_kommen_geprueft_in_die_adresse(monkeypatch, credentials):
    modul = load_listener(monkeypatch, credentials, None)
    assert modul.zweig_sauber("claude/etwas-langes_1.2") == "claude/etwas-langes_1.2"
    assert modul.zweig_sauber("../../etwas") == ""
    assert modul.zweig_sauber("mit leerzeichen") == ""
    assert modul.zweig_sauber("/absolut") == ""
    assert modul.zweig_sauber("") == ""


def test_vereinigt_wirft_doppel_weg_und_ordnet_nach_zeit(monkeypatch, credentials):
    """Dieselbe Änderung kann auf zwei Zweigen liegen - zweimal dieselbe
    Zeile liest sich wie zwei Änderungen."""
    modul = load_listener(monkeypatch, credentials, None)
    a = [_commit("1", "Alt", "2026-09-09T01:00:00Z")]
    b = [
        _commit("1", "Alt", "2026-09-09T01:00:00Z"),
        _commit("2", "Neu", "2026-09-09T02:00:00Z"),
    ]
    assert [c["sha"] for c in modul.vereinigt([a, b])] == ["2", "1"]
    assert modul.vereinigt([]) == []


def test_arbeit_auf_einem_nebenzweig_steht_in_der_liste(monkeypatch, credentials):
    """Der eigentliche Fall: main unverändert, aber auf einem
    claude/…-Zweig liegt etwas, das der nächste Bau hereinnimmt."""
    modul = load_listener(monkeypatch, credentials, None)
    credentials.write_text("GITHUB_TOKEN=t\n", encoding="utf-8")
    modul._vorschau_cache = None

    def fake_github(pfad, token):
        if pfad.startswith(f"/repos/{modul.REPO}/compare/M0...main"):
            return {"commits": []}  # auf main nichts Neues
        if pfad.startswith(f"/repos/{modul.REPO}/branches"):
            return [{"name": "main"}, {"name": "claude/xy"}]
        if pfad.startswith(f"/repos/{modul.REPO}/compare/M0...claude/xy"):
            return {"commits": [_commit("9", "Arbeit vom Nebenzweig", "2026-09-09T03:00:00Z")]}
        raise AssertionError(f"unerwartet: {pfad}")

    monkeypatch.setattr(modul, "_github", fake_github)
    antwort = modul.vorschau("M0", "", "main")

    assert antwort["commits"] == ["Arbeit vom Nebenzweig"]
    assert antwort["exact"] is True


def test_wirklich_nichts_neues_bleibt_nichts_neues(monkeypatch, credentials):
    """Die Gegenprobe - sonst wäre die Warnung nur Lärm."""
    modul = load_listener(monkeypatch, credentials, None)
    credentials.write_text("GITHUB_TOKEN=t\n", encoding="utf-8")
    modul._vorschau_cache = None

    def fake_github(pfad, token):
        if "/branches" in pfad:
            return [{"name": "main"}, {"name": "claude/xy"}]
        return {"commits": []}

    monkeypatch.setattr(modul, "_github", fake_github)
    antwort = modul.vorschau("M0", "", "main")
    assert antwort["commits"] == []
    assert antwort["exact"] is True


def test_ungesehene_zweige_heissen_nicht_genau(monkeypatch, credentials):
    """Konnten wir die übrigen Zweige nicht ansehen, dürfen wir auch
    nicht «genau» behaupten - und schon gar nicht «nichts Neues»."""
    modul = load_listener(monkeypatch, credentials, None)
    credentials.write_text("GITHUB_TOKEN=t\n", encoding="utf-8")
    modul._vorschau_cache = None

    def fake_github(pfad, token):
        if "/branches" in pfad:
            raise OSError("GitHub gerade nicht erreichbar")
        return {"commits": []}

    monkeypatch.setattr(modul, "_github", fake_github)
    antwort = modul.vorschau("M0", "", "main")
    assert antwort["exact"] is False


def test_der_gebaute_zweig_schlaegt_die_zugangsdatei(monkeypatch, credentials):
    """Das Skript legte den Zweig fest, bevor es die Datei las - der
    Dienst liest sie bei jeder Anfrage. Beide meinten dann verschiedene
    Zweige, und die Liste zeigte den Unterschied als «kommt noch»."""
    modul = load_listener(monkeypatch, credentials, None)
    credentials.write_text("GITHUB_TOKEN=t\nHOMEPILOT_BRANCH=etwas-anderes\n", encoding="utf-8")
    monkeypatch.delenv("HOMEPILOT_BRANCH", raising=False)
    modul._vorschau_cache = None
    gefragt: list[str] = []

    def fake_github(pfad, token):
        gefragt.append(pfad)
        if "/branches" in pfad:
            return [{"name": "main"}]
        return {"commits": []}

    monkeypatch.setattr(modul, "_github", fake_github)
    antwort = modul.vorschau("M0", "", "main")
    assert antwort["branch"] == "main"
    assert any("compare/M0...main" in pfad for pfad in gefragt)
