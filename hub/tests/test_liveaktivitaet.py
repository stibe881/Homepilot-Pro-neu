"""Die Haustür-Live-Aktivität: starten im Anmarsch, beenden beim Kommen."""

from homepilot.core.liveaktivitaet import (
    abmelden,
    aktivitaet_merken,
    apns_jwt,
    end_payload,
    karte_faellig,
    kartenstand,
    parse_apns,
    registrieren,
    start_payload,
    token_tot,
    war_weit,
    wechsel,
    weit_merken,
    weit_nachfuehren,
    weit_weg,
)


def test_parse_apns_ist_alles_oder_nichts():
    """Ein halber Block sähe beim Start gesund aus und fiele erst beim
    ersten Versand um - lieber gleich aus, mit einer Zeile im Protokoll."""
    voll = {
        "key_file": "apns.p8",
        "key_id": "ABC123",
        "team_id": "DEF456",
        "bundle_id": "me.stibe.homepilot",
    }
    gelesen = parse_apns(voll)
    assert gelesen is not None
    assert gelesen["bundle_id"] == "me.stibe.homepilot"
    assert parse_apns({**voll, "team_id": ""}) is None
    assert parse_apns({}) is None
    assert parse_apns(None) is None


def test_registrieren_ersetzt_dasselbe_telefon():
    rows = registrieren([], "Stibe", "token-a", "iPhone")
    rows = registrieren(rows, "Stibe", "token-a", "iPhone")
    assert len(rows) == 1
    rows = registrieren(rows, "Bine", "token-b")
    assert len(rows) == 2
    assert abmelden(rows, "token-a") == [rows[1]]


def test_ein_neues_token_ersetzt_dasselbe_telefon():
    """Der Fall vom Sperrbildschirm: fünf gleiche Karten übereinander.

    Apple stellt das «push-to-start»-Token immer wieder neu aus - nach
    jeder Neuinstallation, nach jedem Update. Nach Token abgelegt blieb
    die alte Zeile stehen, jede trug ihr eigenes «unterwegs», und beim
    nächsten Weggehen bekam dasselbe Telefon einen Start-Push je Zeile.
    """
    rows = registrieren([], "Stibe", "token-alt", "Stibes iPhone")
    rows = registrieren(rows, "Stibe", "token-neu", "Stibes iPhone")
    assert [row["start_token"] for row in rows] == ["token-neu"]

    # Ein zweites Telefon derselben Person bleibt ein zweites.
    rows = registrieren(rows, "Stibe", "token-pad", "iPad")
    assert len(rows) == 2
    # Und das Telefon einer anderen Person erst recht.
    rows = registrieren(rows, "Bine", "token-b", "Bines iPhone")
    assert len(rows) == 3


def test_ohne_geraetenamen_bleibt_es_beim_token():
    """Eine alte App-Fassung schickt keinen Namen mit. Dann lieber eine
    Zeile zu viel als die eines fremden Geräts überschrieben."""
    rows = registrieren([], "Stibe", "token-a")
    rows = registrieren(rows, "Stibe", "token-b")
    assert len(rows) == 2


def test_nur_eine_endgueltige_absage_traegt_ein_telefon_aus():
    """Ein Token, das es nicht mehr gibt, wird auch morgen keines mehr
    sein. Alles andere - überlastet, kaputte Verbindung - ist ein
    Problem von jetzt und darf kein Telefon austragen."""
    assert token_tot(410, "{}") is True
    assert token_tot(400, '{"reason":"BadDeviceToken"}') is True
    assert token_tot(400, '{"reason":"BadCollapseId"}') is False
    assert token_tot(429, "TooManyRequests") is False
    assert token_tot(200, "") is False


def test_wechsel_startet_beim_gehen_und_beendet_beim_kommen():
    rows = registrieren([], "Stibe", "token-a", "iPhone")

    # Weg: einmal starten - und beim nächsten Takt nicht noch einmal.
    rows, starten, beenden = wechsel(rows, {"Stibe": True})
    assert [r["start_token"] for r in starten] == ["token-a"]
    assert beenden == []
    rows, starten, beenden = wechsel(rows, {"Stibe": True})
    assert starten == [] and beenden == []

    # Die App meldet das Token der laufenden Aktivität nach.
    rows = aktivitaet_merken(rows, "Stibe", "activity-1")
    assert rows[0]["activity_token"] == "activity-1"

    # Heimgekommen: genau ein Ende, danach Ruhe.
    rows, starten, beenden = wechsel(rows, {"Stibe": False})
    assert [r["activity_token"] for r in beenden] == ["activity-1"]
    assert rows[0]["unterwegs"] is False
    assert rows[0]["activity_token"] is None
    rows, starten, beenden = wechsel(rows, {"Stibe": False})
    assert starten == [] and beenden == []


def test_nichtwissen_aendert_nichts():
    """Aus «unbekannt» soll weder eine Karte entstehen noch eine
    verschwinden - wer im Ergebnis fehlt, bleibt wie er ist."""
    rows = registrieren([], "Stibe", "token-a")
    rows, starten, _ = wechsel(rows, {"Stibe": True})
    assert len(starten) == 1
    # Zone meldet gerade nichts Brauchbares: Stibe fehlt im Stand.
    rows, starten, beenden = wechsel(rows, {})
    assert starten == [] and beenden == []
    assert rows[0]["unterwegs"] is True


def test_payloads_tragen_das_noetige():
    start = start_payload(1000.0)
    assert start["aps"]["event"] == "start"
    assert start["aps"]["attributes-type"] == "TuerAktivitaetAttributes"
    assert start["aps"]["attributes"] == {"tuer": "Haustüre"}
    # Das alert ist beim Start PFLICHT: Ohne es nahm Apple den Push an
    # (200 im Log), aber iOS stellte still nie eine Karte auf. Genau so
    # sah der Fehler wochenlang aus - dieser Test hält die Lehre fest.
    assert start["aps"]["alert"]["title"] == "Haustüre"
    assert start["aps"]["alert"]["body"]
    ende = end_payload(2000.0)
    assert ende["aps"]["event"] == "end"
    assert ende["aps"]["dismissal-date"] == 2000


def test_apns_jwt_traegt_kennung_und_gueltige_signatur():
    """Apple prüft kid im Kopf, iss in den Claims und die ES256-Signatur
    in roher r||s-Form - genau das hier auch, mit einem frischen
    Schlüssel statt eines eingecheckten."""
    import base64
    import json

    import pytest

    # Wie pydevccu: Das Extra 'apns' ist optional - ohne die Bibliothek
    # wird übersprungen statt rot.
    #
    # Nicht importorskip: Eine halb eingerichtete cryptography (die
    # Rust-Anbindung ohne _cffi_backend) wirft beim Import keine
    # ImportError, sondern eine PanicException aus pyo3 - die erbt von
    # BaseException, und importorskip lässt sie durch. Ein fehlendes
    # Extra ist aber in beiden Fällen dasselbe: kein Grund für Rot.
    try:
        import cryptography.hazmat.primitives.asymmetric.ec  # noqa: F401
    except BaseException as err:  # pragma: no cover - hängt an der Umgebung
        pytest.skip(f"cryptography nicht benutzbar: {err}")
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import (
        encode_dss_signature,
    )

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    token = apns_jwt(pem, "KEY1", "TEAM1", 1234.0)
    kopf_roh, inhalt_roh, signatur_roh = token.split(".")

    def lesen(teil: str) -> dict:
        return json.loads(base64.urlsafe_b64decode(teil + "=" * (-len(teil) % 4)))

    assert lesen(kopf_roh) == {"alg": "ES256", "kid": "KEY1"}
    assert lesen(inhalt_roh) == {"iss": "TEAM1", "iat": 1234}
    roh = base64.urlsafe_b64decode(signatur_roh + "=" * (-len(signatur_roh) % 4))
    assert len(roh) == 64
    der = encode_dss_signature(
        int.from_bytes(roh[:32], "big"), int.from_bytes(roh[32:], "big")
    )
    key.public_key().verify(
        der, f"{kopf_roh}.{inhalt_roh}".encode(), ec.ECDSA(hashes.SHA256())
    )


def test_der_profil_schalter_stoppt_und_beendet():
    """Wer die Live-Aktivität im Profil abschaltet, gilt für die Karte
    als zuhause: nichts Neues startet, und die laufende endet sofort -
    nicht erst beim nächsten Heimkommen."""
    from homepilot.core.liveaktivitaet import abgeschaltet

    prefs = [
        {"user": "Stibe", "prefs": {"liveTuer": False}},
        {"user": "Bine", "prefs": {"liveTuer": True}},
        {"user": "Tablet", "prefs": {}},
        "kaputt",
    ]
    assert abgeschaltet(prefs) == {"Stibe"}
    assert abgeschaltet([]) == set()

    # Und in der Runde: weg, aber abgeschaltet -> die Karte endet.
    rows = registrieren([], "Stibe", "token-a")
    rows, starten, _ = wechsel(rows, {"Stibe": True})
    rows = aktivitaet_merken(rows, "Stibe", "activity-1")
    weg = {"Stibe": True}
    for name in abgeschaltet(prefs):
        weg[name] = False
    rows, starten, beenden = wechsel(rows, weg)
    assert starten == []
    assert [r["activity_token"] for r in beenden] == ["activity-1"]


class TestKarteFaellig:
    def test_auf_dem_heimweg_laeuft_die_karte(self) -> None:
        # Nicht zuhause, aber vor der Türe - und vorher wirklich
        # draussen gewesen: genau der Moment für den Türöffner.
        assert karte_faellig("away", 80, True) is True
        assert karte_faellig("quartier", 40, True) is True

    def test_der_halbe_heimweg_ist_zu_frueh(self) -> None:
        """Der Umkreis war zuerst derselbe wie der für «war weg», drei
        Kilometer - die Karte lag damit schon da, während man noch fuhr.
        Der Türöffner nützt in einem Moment: vor der Türe."""
        assert karte_faellig("away", 800, True) is False
        assert karte_faellig("quartier", 2500, True) is False

    def test_beim_weggehen_kommt_sie_nicht(self) -> None:
        """Der Fall vom Sperrbildschirm: Beim Hinausgehen ist man
        ebenfalls im Umkreis - die Karte gehört aber auf den Heimweg."""
        assert karte_faellig("away", 80, False) is False
        assert karte_faellig("quartier", 40, False) is False

    def test_weit_weg_laeuft_sie_nicht(self) -> None:
        # Sonst läge sie den ganzen Arbeitstag auf dem Sperrbildschirm.
        assert karte_faellig("away", 12_000, True) is False

    def test_zuhause_endet_sie(self) -> None:
        assert karte_faellig("home", 0, True) is False

    def test_ohne_entfernung_entscheidet_die_zone(self) -> None:
        assert karte_faellig("quartier", None, True) is True
        assert karte_faellig("away", None, True) is False

    def test_unbekannt_bleibt_unbekannt(self) -> None:
        assert karte_faellig("unknown", None, True) is None
        assert karte_faellig("", 500, True) is None
        # bool ist in Python ein int - aber keine Entfernung.
        assert karte_faellig("away", True, True) is False


class TestWeitWeg:
    """Was als «war wirklich draussen» zählt - der Vermerk, ohne den
    keine Karte mehr kommt."""

    def test_weiter_als_der_umkreis(self) -> None:
        assert weit_weg("away", 12_000) is True
        assert weit_weg("away", 800) is False

    def test_zuhause_faengt_von_vorn_an(self) -> None:
        assert weit_weg("home", 0) is False

    def test_ohne_entfernung_entscheidet_die_zone(self) -> None:
        assert weit_weg("away", None) is True
        assert weit_weg("quartier", None) is False

    def test_unbekannt_aendert_nichts(self) -> None:
        assert weit_weg("unknown", None) is None
        assert weit_weg("", 12_000) is None

    def test_der_vermerk_haelt_je_person(self) -> None:
        rows = weit_merken([], "Stibe", True)
        rows = weit_merken(rows, "Bine", False)
        assert war_weit(rows, "Stibe") is True
        assert war_weit(rows, "Bine") is False
        assert war_weit(rows, "Levin") is False
        # Und je Person nur eine Zeile.
        rows = weit_merken(rows, "Stibe", False)
        assert len([r for r in rows if r["user"] == "Stibe"]) == 1
        assert war_weit(rows, "Stibe") is False


class TestWeitNachfuehren:
    """Wann der «war draussen»-Vermerk zieht - und wann er stehen bleibt."""

    def test_richtig_draussen_wird_vorgemerkt(self) -> None:
        assert weit_nachfuehren("away", 12_000) is True
        assert weit_nachfuehren("away", None) is True

    def test_zuhause_faengt_von_vorn_an(self) -> None:
        assert weit_nachfuehren("home", 0) is False

    def test_im_anmarsch_bleibt_der_vermerk(self) -> None:
        """Der Fall vom 31. August: Heimkommen, keine Karte.

        Der Takt setzte den Vermerk direkt auf weit_weg() - der wird am
        Ortsrand False, drei Kilometer vor der Türe, und im selben Takt
        fand karte_faellig dann keinen Vermerk mehr. Im Anmarsch (nah,
        aber nicht zuhause) darf sich der Vermerk nicht ändern.
        """
        assert weit_nachfuehren("quartier", 2500) is None
        assert weit_nachfuehren("away", 800) is None

    def test_unbekannt_aendert_nichts(self) -> None:
        assert weit_nachfuehren("unknown", None) is None
        assert weit_nachfuehren("", 12_000) is None

    def test_der_ganze_heimweg(self) -> None:
        """Von der Arbeit bis vor die Tür, Takt für Takt."""
        rows: list[dict] = []

        def takt(zustand: str, entfernung: float | None) -> bool | None:
            nonlocal rows
            weit = weit_nachfuehren(zustand, entfernung)
            if weit is not None and weit != war_weit(rows, "Stibe"):
                rows = weit_merken(rows, "Stibe", weit)
            return karte_faellig(zustand, entfernung, war_weit(rows, "Stibe"))

        assert takt("home", 0) is False          # Morgen: zuhause
        assert takt("quartier", 2500) is False   # Hinausgehen: keine Karte
        assert takt("away", 12_000) is False     # Arbeitstag: keine Karte
        assert takt("quartier", 2500) is False   # Ortsrand: noch zu früh
        assert takt("away", 400) is False        # die Strasse hoch: nein
        assert takt("away", 60) is True          # vor der Türe: Karte!
        assert takt("home", 0) is False          # daheim: Karte endet
        assert takt("away", 60) is False         # kurz zum Kiosk: keine


class TestKartenstand:
    """Anfangen auf dem Heimweg, aufhören zuhause - und dazwischen
    liegenbleiben, auch wenn die Ortung zittert."""

    def test_eine_liegende_karte_ueberlebt_einen_ausreisser(self) -> None:
        # Der gemeldete Fall: Die Entfernung springt kurz über die
        # Grenze. Vorher endete die Karte damit und begann gleich neu -
        # und weil das Beenden oft nicht ankommt, lagen danach zwei.
        assert kartenstand("away", 12_000, True, True) is True
        assert kartenstand("away", 12_000, True, False) is False

    def test_zuhause_endet_sie_nach_der_nachfrist(self) -> None:
        from homepilot.core.liveaktivitaet import HEIM_GNADE

        # Die Haustüre steht *innerhalb* der Zone: Wer vom Auto zur Türe
        # geht, gilt schon als daheim - und genau da verschwand die
        # Karte bisher, der man den Öffner verdankt.
        assert kartenstand("home", 0, True, True, heim_vor=30.0) is True
        assert kartenstand("home", 0, True, True, heim_vor=HEIM_GNADE + 1) is False
        # Ohne bekannte Ankunftszeit bleibt es beim alten Verhalten.
        assert kartenstand("home", 0, True, True, heim_vor=None) is False

    def test_die_ankunft_faengt_eine_uebersprungene_karte_auf(self) -> None:
        """Der Ring ist dreihundert Meter breit, zwischen zwei
        Ortsmeldungen liegen dreissig Sekunden - wer schnell fährt, kann
        ihn überspringen. Dann kommt die Karte bei der Ankunft."""
        assert kartenstand("home", 0, True, False, heim_vor=5.0) is True

    def test_wer_daheim_sitzt_bekommt_keine(self) -> None:
        # Weder eine laufende Karte noch eine Heimkehr: Dann ist die
        # frisch gesetzte Ankunftszeit kein Grund für eine Karte.
        assert kartenstand("home", 0, False, False, heim_vor=5.0) is False

    def test_ohne_laufende_karte_gilt_die_alte_regel(self) -> None:
        assert kartenstand("away", 80, True, False) is True
        assert kartenstand("away", 80, False, False) is False

    def test_unbekannt_bleibt_unbekannt(self) -> None:
        assert kartenstand("unknown", None, True, True) is None


def test_eine_kurze_fahrt_bekommt_ihre_karte():
    """Ohne Wartefrist: Wer weg war, kurz heimkommt und gleich wieder
    fährt, bekommt beim zweiten Heimkommen wieder eine Karte.

    Es stand hier eine halbe Stunde Sperre gegen den Kartenstapel - der
    falsche Riegel am falschen Ort. Gegen den Stapel steht jetzt, dass
    eine Karte nur zuhause endet und eine neue eine echte Auswärtsfahrt
    braucht; die Uhr hat damit nichts zu tun.
    """
    rows = registrieren([], "Stibe", "token-a", "iPhone")
    rows, starten, _ = wechsel(rows, {"Stibe": True})
    assert len(starten) == 1
    rows, _, beenden = wechsel(rows, {"Stibe": False})
    assert len(beenden) == 1
    # Zwei Minuten später wieder unterwegs - und wieder eine Karte.
    rows, starten, _ = wechsel(rows, {"Stibe": True})
    assert len(starten) == 1


class TestKartenradius:
    """Der Ring liegt aussen an der Zone «zuhause» an, nicht in ihr.

    Der gemeldete Fall: Nach der Umstellung auf hundert Meter kam gar
    keine Karte mehr. Die Entfernung misst bis zur Mitte des Ortes,
    zuhause ist man ab seinem Radius - bei 150 m Radius und 100 m
    Schwelle war der Ring dazwischen leer, und man war zuhause, bevor
    die Karte fällig wurde. Falsch eingetragen war dabei nichts.
    """

    def test_der_ring_liegt_vor_der_zone(self) -> None:
        from homepilot.core.liveaktivitaet import kartenradius

        assert kartenradius(150.0, nah=100.0) == 250.0
        assert kartenradius(50.0, nah=100.0) == 150.0

    def test_ohne_zuhause_bleibt_die_nackte_zahl(self) -> None:
        from homepilot.core.liveaktivitaet import kartenradius

        assert kartenradius(None, nah=100.0) == 100.0

    def test_der_radius_kommt_vom_ort_zuhause(self) -> None:
        from homepilot.core.liveaktivitaet import heimradius

        assert heimradius([]) is None
        assert heimradius([{"id": "home", "radius": 80}]) == 80.0
        assert heimradius([{"id": "arbeit", "radius": 80}]) is None
        # Ein Ort ohne brauchbaren Radius soll nicht die Runde umwerfen.
        assert heimradius([{"id": "home"}]) is None

    def test_ein_weiter_ort_hat_trotzdem_ein_fenster(self) -> None:
        """Die Probe aufs Ganze: 150 m Zone, Ankunft auf 200 m."""
        from homepilot.core.liveaktivitaet import kartenradius

        nah = kartenradius(150.0, nah=100.0)
        assert karte_faellig("away", 200, True, nah) is True
        # Und weiter draussen weiterhin nicht.
        assert karte_faellig("away", 900, True, nah) is False


class TestHeimSeit:
    """Die Ankunftszeit - daran hängt die Nachfrist."""

    def test_setzen_lesen_loeschen(self) -> None:
        from homepilot.core.liveaktivitaet import heim_merken, heim_seit

        rows = heim_merken([], "Stibe", 1000.0)
        assert heim_seit(rows, "Stibe") == 1000.0
        assert heim_seit(rows, "Bine") is None
        rows = heim_merken(rows, "Stibe", None)
        assert heim_seit(rows, "Stibe") is None

    def test_der_vermerk_nimmt_die_ankunft_nicht_mit(self) -> None:
        """Beide wohnen in derselben Zeile. Schriebe weit_merken sie neu,
        ginge die Ankunftszeit bei jedem Wechsel des Vermerks verloren -
        und die Nachfrist wäre je nach Reihenfolge da oder nicht."""
        from homepilot.core.liveaktivitaet import heim_merken, heim_seit

        rows = heim_merken([], "Stibe", 1000.0)
        rows = weit_merken(rows, "Stibe", True)
        assert heim_seit(rows, "Stibe") == 1000.0
        assert war_weit(rows, "Stibe") is True
        # Und je Person bleibt es bei einer Zeile.
        assert len([r for r in rows if r["user"] == "Stibe"]) == 1

    def test_ein_kaputter_wert_gilt_als_unbekannt(self) -> None:
        from homepilot.core.liveaktivitaet import heim_seit

        assert heim_seit([{"user": "Stibe", "heim_seit": "gestern"}], "Stibe") is None
        assert heim_seit([{"user": "Stibe", "heim_seit": True}], "Stibe") is None


class TestDiagnose:
    """Der Satz, den die App unter dem Schalter zeigt.

    Er ist die Antwort auf drei Runden Raten: Zwischen «der Schalter
    steht an» und «die Karte liegt da» hängen acht Glieder, und die
    meisten schweigen, wenn sie fehlen. Von aussen sieht jedes davon
    gleich aus - es passiert nichts.
    """

    def stand(self, **abweichung: object) -> str:
        from homepilot.core.liveaktivitaet import diagnose

        werte: dict = {
            "eingerichtet": True,
            "telefone": 1,
            "abgestellt": False,
            "zone": "stefan",
            "zustand": "away",
            "entfernung": 5000,
            "nah": 450.0,
            "draussen_gewesen": True,
            "laeuft": False,
            "token_da": True,
            "heim_vor": None,
        }
        werte.update(abweichung)
        return diagnose(**werte)  # type: ignore[arg-type]

    def test_das_erste_glied_zaehlt(self) -> None:
        # Fehlt der apns-Block, ist alles andere gleichgültig.
        assert "apns-Block" in self.stand(eingerichtet=False, telefone=0)

    def test_kein_angemeldetes_telefon(self) -> None:
        """Der stillste Fall von allen: Ohne Zeile in live_activities
        kehrt der Takt sofort um, und niemand sieht warum."""
        assert "kein angemeldetes Telefon" in self.stand(telefone=0)

    def test_abgestellt(self) -> None:
        assert "Im Profil abgeschaltet" in self.stand(abgestellt=True)

    def test_keine_zone(self) -> None:
        assert "keine Geofence-Zone" in self.stand(zone=None)

    def test_ohne_ortung(self) -> None:
        assert "weiss gerade nicht" in self.stand(zustand="unknown")

    def test_noch_zu_weit(self) -> None:
        satz = self.stand(entfernung=5000)
        assert "5000 m" in satz and "450 m" in satz

    def test_gleich_soweit(self) -> None:
        assert "müsste jetzt kommen" in self.stand(entfernung=300)

    def test_ohne_auswaertsfahrt(self) -> None:
        assert "war draussen" in self.stand(draussen_gewesen=False, entfernung=300)

    def test_zuhause(self) -> None:
        assert "Heimweg" in self.stand(zustand="home", entfernung=10)

    def test_nachfrist_vorbei(self) -> None:
        satz = self.stand(zustand="home", entfernung=10, heim_vor=3600.0)
        assert "Nachfrist" in satz

    def test_eine_laufende_karte_ohne_token(self) -> None:
        """Ein häufiger halber Zustand: Die Karte liegt, aber der Hub
        kann sie nicht beenden, weil die App das Token nie nachmeldete."""
        satz = self.stand(laeuft=True, token_da=False)
        assert "läuft gerade" in satz
        assert "nie nachgemeldet" in satz

    def test_ohne_entfernung_bleibt_die_zone(self) -> None:
        assert "keine Entfernung" in self.stand(entfernung=None)
