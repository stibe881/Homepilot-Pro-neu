"""Gäste-WLAN: einen Gutschein ziehen, statt einen Zettel weiterzureichen.

Der Fall: Besuch fragt nach dem WLAN. Ein Gutschein *im* Aufkleber wäre
einer für alle - der Erste löst ihn ein, der Zweite steht vor einer
toten Karte. Also trägt der Aufkleber nur die Adresse, und gezogen wird
bei jedem Besuch neu.
"""

from homepilot.core import wlanschein

STUNDE = 3600.0
JETZT = 1_800_000_000.0


def schein(gezogen=JETZT, code="01234-56789"):
    return {"id": "v1", "code": code, "drawn": gezogen}


# ── Zwölf Stunden ab dem Ziehen ──────────────────────────────────────────


def test_ein_frischer_gutschein_gilt():
    assert not wlanschein.abgelaufen(schein(), JETZT + 11 * STUNDE)


def test_nach_zwoelf_stunden_ist_schluss():
    """Der Controller kann nur ab der Anmeldung zählen - ein gezogener,
    nie benutzter Code läge sonst für immer herum."""
    assert wlanschein.abgelaufen(schein(), JETZT + 12 * STUNDE)


def test_ein_eintrag_ohne_datum_gilt_als_abgelaufen():
    """Was der Hub nicht datieren kann, kann er nicht verantworten - und
    ein ewig gültiger Gutschein ist das Gegenteil des Gewollten."""
    assert wlanschein.abgelaufen({"code": "x"}, JETZT)
    assert wlanschein.abgelaufen({"drawn": "gestern"}, JETZT)
    assert wlanschein.abgelaufen("Unsinn", JETZT)


def test_aufteilen_trennt_gueltig_von_verfallen():
    alt = schein(JETZT - 20 * STUNDE, "alt")
    neu = schein(JETZT - STUNDE, "neu")
    gueltig, weg = wlanschein.aufteilen([alt, neu], JETZT)
    assert [s["code"] for s in gueltig] == ["neu"]
    assert [s["code"] for s in weg] == ["alt"]


# ── Die Bremse ───────────────────────────────────────────────────────────


def test_zu_viele_zaehlt_nur_die_gueltigen():
    """Sonst sperrte ein Stapel Karteileichen von gestern das Haus für
    den Besuch von heute aus."""
    alte = [schein(JETZT - 20 * STUNDE) for _ in range(30)]
    assert not wlanschein.zu_viele(alte, JETZT)
    frische = [schein() for _ in range(wlanschein.HOECHSTENS_OFFEN)]
    assert wlanschein.zu_viele(frische, JETZT)


# ── Das Buch ─────────────────────────────────────────────────────────────


def test_eintragen_stellt_den_neuen_nach_oben_und_raeumt_auf():
    alt = schein(JETZT - 20 * STUNDE, "alt")
    liste = wlanschein.eintragen(
        [alt], {"id": "v2", "code": "99999-88888"}, JETZT, "192.0.2.7"
    )
    assert [s["code"] for s in liste] == ["99999-88888"]
    assert liste[0]["drawn"] == JETZT
    assert liste[0]["from"] == "192.0.2.7"


def test_eine_lange_adresse_wird_gekuerzt():
    liste = wlanschein.eintragen([], {"code": "a"}, JETZT, "x" * 200)
    assert len(liste[0]["from"]) == 45


# ── Was dasteht ──────────────────────────────────────────────────────────


def test_der_restsatz_rechnet_fuer_den_gast():
    assert wlanschein.restsatz(schein(), JETZT) == "Noch 12 Std."
    assert wlanschein.restsatz(schein(), JETZT + 20 * 60) == "Noch 11 Std. 40 Min."
    assert wlanschein.restsatz(schein(), JETZT + 11.5 * STUNDE) == "Noch 30 Min."
    assert wlanschein.restsatz(schein(), JETZT + 13 * STUNDE) == "Abgelaufen"


def test_die_seiten_stehen_ohne_javascript_und_ohne_fremde_quellen():
    """Sie stehen auf einem fremden Telefon, das noch gar nicht im Netz
    ist - sie müssen vollständig ankommen oder gar nicht."""
    for seite in (
        wlanschein.frageseite("Gäste"),
        wlanschein.codeseite("01234-56789", "Noch 12 Std.", "Gäste", None),
        wlanschein.fehlerseite("Zu viele", "Später nochmal."),
    ):
        assert "<script" not in seite
        assert "http://" not in seite and "https://" not in seite.replace(
            "http://www.w3.org/2000/svg", ""
        )


def test_die_frageseite_zieht_noch_nichts():
    """GET zeigt, POST zieht - sonst verbrennt jede Messenger-Vorschau
    einen Gutschein (derselbe Fehler wie beim Einmal-Link zur Türe)."""
    seite = wlanschein.frageseite("Gäste")
    assert 'method="post"' in seite
    assert "Code holen" in seite


def test_der_code_steht_gross_auf_der_seite():
    seite = wlanschein.codeseite("01234-56789", "Noch 12 Std.", "Gäste WLAN", None)
    assert "01234-56789" in seite
    assert "Gäste WLAN" in seite
    assert "Noch 12 Std." in seite


def test_fremder_text_kommt_entwertet_in_die_seite():
    seite = wlanschein.codeseite("x", "y", '<script>böse</script>', None)
    assert "<script>" not in seite
    assert "&lt;script&gt;" in seite


def test_die_aufkleber_adresse_haengt_am_token():
    assert (
        wlanschein.sticker_url("https://haus.example.ch/", "abc")
        == "https://haus.example.ch/gast/wlan/abc"
    )


def test_zwei_tokens_sind_nie_gleich():
    assert wlanschein.token_neu() != wlanschein.token_neu()
    assert len(wlanschein.token_neu()) >= 20


# ── Der ganze Weg ────────────────────────────────────────────────────────

import time  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from homepilot.api import create_app  # noqa: E402
from homepilot.core.hub import Hub  # noqa: E402

from .conftest import make_config  # noqa: E402


class FalscherController:
    """Ein UniFi, das nur das kann, was der Gutschein-Weg braucht."""

    # Der Hub räumt beim Halt alle Integrationen ab und fragt sie dabei
    # nach ihrem Namen.
    name = "unifi"

    def __init__(self):
        self.angelegt: list[int] = []
        self.geloescht: list[str] = []
        self._n = 0
        self.kaputt = False

    async def teardown(self) -> None:
        return None

    async def create_voucher(self, minutes: int, note: str = ""):
        if self.kaputt:
            raise ConnectionError("Controller antwortet nicht")
        self._n += 1
        self.angelegt.append(minutes)
        return {"id": f"v{self._n}", "code": f"0000{self._n}-11111", "note": note}

    async def delete_voucher(self, voucher_id: str) -> None:
        self.geloescht.append(voucher_id)

    async def list_vouchers(self):
        return []


def _hub_mit_wlan():
    hub = Hub(
        make_config(
            token="geheim",
            guest_wifi={"ssid": "Gäste", "auth": "open", "portal_password": "x"},
        )
    )
    return hub


async def test_der_gast_zieht_sich_selbst_einen_gutschein():
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        unifi = FalscherController()
        hub.integrations._integrations["unifi"] = unifi  # type: ignore[attr-defined]
        client = TestClient(create_app(hub))
        kopf = {"Authorization": "Bearer geheim"}

        stand = client.get("/api/wifi/sticker", headers=kopf).json()
        assert stand["unifi"] is True
        assert stand["open"] == []
        pfad = "/gast/wlan/" + stand["url"].rsplit("/", 1)[1]

        # Ansehen zieht nichts - sonst verbrennt jede Vorschau einen Code.
        seite = client.get(pfad)
        assert seite.status_code == 200
        assert unifi.angelegt == []
        assert "Code holen" in seite.text

        gezogen = client.post(pfad)
        assert gezogen.status_code == 200
        assert "00001-11111" in gezogen.text
        # Zwölf Stunden, wie sie der Controller versteht: in Minuten.
        assert unifi.angelegt == [12 * 60]

        # Und der Hub führt Buch, damit er später aufräumen kann.
        offen = client.get("/api/wifi/sticker", headers=kopf).json()["open"]
        assert [e["code"] for e in offen] == ["00001-11111"]
        # Rund zwölf Stunden - auf die Minute genau zu prüfen hiesse,
        # die Uhr des Testlaufs zu prüfen.
        assert offen[0]["left"].startswith("Noch 11 Std.") or offen[0][
            "left"
        ].startswith("Noch 12 Std.")
    finally:
        await hub.stop()


async def test_jeder_gast_bekommt_seinen_eigenen_code():
    """Ein Gutschein *im* Aufkleber wäre einer für alle - der Zweite
    stünde vor einer toten Karte."""
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        unifi = FalscherController()
        hub.integrations._integrations["unifi"] = unifi  # type: ignore[attr-defined]
        client = TestClient(create_app(hub))
        pfad = "/gast/wlan/" + client.get(
            "/api/wifi/sticker", headers={"Authorization": "Bearer geheim"}
        ).json()["url"].rsplit("/", 1)[1]

        erster = client.post(pfad).text
        zweiter = client.post(pfad).text
        assert "00001-11111" in erster
        assert "00002-11111" in zweiter
    finally:
        await hub.stop()


async def test_ein_alter_aufkleber_gilt_nicht_mehr():
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        hub.integrations._integrations["unifi"] = FalscherController()  # type: ignore[attr-defined]
        client = TestClient(create_app(hub))
        kopf = {"Authorization": "Bearer geheim"}
        alt = client.get("/api/wifi/sticker", headers=kopf).json()["url"]
        neu = client.post("/api/wifi/sticker/rotate", headers=kopf).json()["url"]
        assert alt != neu

        antwort = client.get("/gast/wlan/" + alt.rsplit("/", 1)[1])
        assert antwort.status_code == 410
        assert "gilt nicht mehr" in antwort.text
    finally:
        await hub.stop()


async def test_ohne_unifi_sagt_die_seite_es_dem_gast():
    """Und schickt ihn zu jemandem, der helfen kann - er hat nichts
    falsch gemacht."""
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        client = TestClient(create_app(hub))
        pfad = "/gast/wlan/" + client.get(
            "/api/wifi/sticker", headers={"Authorization": "Bearer geheim"}
        ).json()["url"].rsplit("/", 1)[1]
        antwort = client.post(pfad)
        assert antwort.status_code == 503
        assert "im Haus nach" in antwort.text
    finally:
        await hub.stop()


async def test_ein_stummer_controller_bleibt_ohne_eintrag_im_buch():
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        unifi = FalscherController()
        unifi.kaputt = True
        hub.integrations._integrations["unifi"] = unifi  # type: ignore[attr-defined]
        client = TestClient(create_app(hub))
        pfad = "/gast/wlan/" + client.get(
            "/api/wifi/sticker", headers={"Authorization": "Bearer geheim"}
        ).json()["url"].rsplit("/", 1)[1]
        assert client.post(pfad).status_code == 502
        assert hub.data.get("wifi_vouchers") == []
    finally:
        await hub.stop()


async def test_der_waechter_raeumt_abgelaufene_weg():
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        unifi = FalscherController()
        hub.integrations._integrations["unifi"] = unifi  # type: ignore[attr-defined]
        jetzt = time.time()
        hub.data.set(
            "wifi_vouchers",
            [
                {"id": "alt", "code": "a", "drawn": jetzt - 13 * 3600},
                {"id": "neu", "code": "b", "drawn": jetzt - 3600},
            ],
        )
        await hub.watchdog.check()
        assert unifi.geloescht == ["alt"]
        assert [e["code"] for e in hub.data.get("wifi_vouchers")] == ["b"]
    finally:
        await hub.stop()


async def test_ein_gutschein_bleibt_nicht_ewig_im_buch_wenn_unifi_schweigt():
    """Sonst versuchte der Wächter es im Minutentakt weiter, und die
    Liste wüchse."""
    hub = _hub_mit_wlan()
    await hub.start()
    try:
        hub.data.set(
            "wifi_vouchers", [{"id": "alt", "code": "a", "drawn": time.time() - 13 * 3600}]
        )
        await hub.watchdog.check()
        assert hub.data.get("wifi_vouchers") == []
    finally:
        await hub.stop()


def test_der_qr_code_zeigt_wirklich_die_richtigen_felder():
    """Ein QR mit einem falschen Feld sieht aus wie einer und führt
    nirgendwohin - das fällt erst im Flur auf. Deshalb wird der Pfad
    hier zurückgerechnet und mit der Vorlage verglichen."""
    import re

    import qrcode

    from homepilot import qr

    text = "https://haus.example.ch/gast/wlan/abc"
    vorlage = qrcode.QRCode(border=2)
    vorlage.add_data(text)
    vorlage.make(fit=True)
    matrix = vorlage.get_matrix()

    bild = qr.svg(text)
    pfad = re.search(r'<path d="([^"]*)"', bild).group(1)
    zurueck = [[False] * len(matrix) for _ in matrix]
    for x, y, breite in re.findall(r"M(\d+) (\d+)h(\d+)", pfad):
        for spalte in range(int(x), int(x) + int(breite)):
            zurueck[int(y)][spalte] = True
    assert zurueck == matrix
