"""Familie: geteilte Listen (Aufgaben, Einkauf, Pinnwand …).

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import (
    beleglesen,
    bilder,
    dateien,
    familienbuch,
    gleichzeitig,
    gutscheine,
    rezeptimport,
)
from ...core import shopping as shopping_module
from ...core import trash as trash_module
from ...core import vorrat as vorrat_module
from ...core.users import Role, User
from ...integrations import google_calendar as calendar_module
from ..context import ApiContext
from ..models import RecipeImportRequest

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user

    # ── Familie: geteilte Listen (Aufgaben, Einkauf, Pinnwand …) ──────────
    # Alle Bewohner sehen und pflegen dieselben Daten; Gäste bleiben aussen
    # vor. Die Struktur ist bewusst generisch: eine Sammlung ist eine Liste
    # von Einträgen mit id, author und created – was sonst drinsteht,
    # bestimmt die App (Aufgabe, Pin, Rezept …).

    FAMILY_COLLECTIONS = frozenset(
        {
            "tasks", "shopping", "pins", "meals", "contacts", "routines",
            "rewards", "rewards_catalog", "packlists", "countdowns",
            # «reminders»: Erinnerungen mit Datum und Uhrzeit. Fällig
            # rechnet jedes Gerät selbst aus seiner Uhr - der Hub ist nur
            # die geteilte Ablage, und family_changed sagt allen offenen
            # Apps sofort Bescheid, wenn jemand bestätigt.
            "reminders",
            "recipes", "documents", "staples", "chores", "medications",
            "emergency", "polls", "shops", "babysitter",
            # «members»: wer zum Haushalt gehört, ohne einen Zugang zu
            # haben. Aufgaben, Ämtli und Punkte hingen an /api/users -
            # wer ein Kind eintragen wollte, musste ihm einen Anmeldenamen
            # samt Token geben. Siehe app/src/lib/mitglieder.ts.
            "members",
            # «lessons» und «activities»: der Stundenplan eines Kindes und
            # seine regelmässigen Termine (Fussball, Jugi). Beide gehören
            # zu einem Namen aus «members» und sind das, was ein
            # Kalendereintrag nicht ist: Sie wiederholen sich jede Woche
            # und stehen in keinem Kalender, weil sie niemand zwanzigmal
            # eintippt. Siehe app/src/lib/kindseite.ts.
            "lessons",
            "activities",
            # «gear»: was an welchem Wochentag in den Thek gehört
            # (Turnsack am Di, Flöte am Do) - je Kind, auf Wunsch nur in
            # der A- oder B-Woche. Der Wächter fasst am Vorabend
            # zusammen (core/packliste.py).
            "gear",
            # «vouchers»: Geschenk- und Einkaufsgutscheine (Punkt 264 der
            # Werkbank) - Brack 100 CHF, Kinderparadies 1 Eintritt. Die
            # einzige Sammlung mit einer Sichtbarkeit je Eintrag: Ein
            # «privater» Gutschein gehört dem, der ihn eingetragen hat,
            # und sonst niemandem, auch nicht dem Besitzer des Hubs. Die
            # Regel dazu rechnet core/gutscheine.py; hier wird sie an
            # jeder Stelle angewandt, die Einträge herausgibt oder ändert.
            "vouchers",
        }
    )

    def family_user(request: Request) -> User:
        user = current_user(request)
        if user.role == Role.GUEST and "familie" not in user.features:
            raise HTTPException(status_code=403, detail="Für Gäste nicht sichtbar")
        return user

    def nur_sichtbare(
        collection: str, rows: list[dict[str, Any]], user: User
    ) -> list[dict[str, Any]]:
        """Eine Sammlung so, wie diese Person sie sehen darf.

        Für alle Listen ausser den Gutscheinen ist das die ganze Liste -
        bewusst keine allgemeine Sichtbarkeit je Eintrag: Eine Aufgabe,
        die nur ihr Autor sieht, erledigt niemand.
        """
        if collection != "vouchers":
            return rows
        return gutscheine.sichtbar(rows, user.name)

    def sichtbar_oder_403(collection: str, item: dict[str, Any], user: User) -> None:
        """Ändern und Löschen fremder privater Gutscheine abweisen.

        403 und nicht 404: Die Kennung stammt aus einer Liste, die die
        Person gar nicht bekommen hat - wer sie trotzdem schickt, hat
        sie erraten oder abgeschrieben, und dem sagt man «nein», nicht
        «gibt es nicht».
        """
        if collection == "vouchers" and not gutscheine.darf_sehen(item, user.name):
            raise HTTPException(
                status_code=403, detail="Dieser Gutschein gehört jemand anderem"
            )

    def family_key(collection: str) -> str:
        if collection not in FAMILY_COLLECTIONS:
            raise HTTPException(status_code=404, detail=f"Unbekannte Liste: {collection}")
        return f"family_{collection}"

    async def family_changed(collection: str) -> None:
        """Allen offenen Apps sagen, dass sich eine Liste geändert hat.

        Die App fragte bisher im Minutentakt nach - wer beim Einkaufen
        etwas abhakt, dessen Änderung erschien beim anderen bis zu eine
        Minute später. Über den WebSocket kommt nur der Fingerzeig
        («shopping hat sich geändert»); die Daten holt die App selbst,
        derselbe Weg wie bisher.
        """
        await hub.bus.publish("family_changed", {"collection": collection})

    # ── Bilder der Familienlisten: Rezepte (Punkt 193), Gutscheine (264) ──
    #
    # Bilder gehören neben die Daten, nicht hinein: In hub.data geht jedes
    # Foto bei jedem Öffnen der Familienseite komplett über die Leitung,
    # als eigene Datei holt das Telefon es einmal und behält es.
    #
    # Zuerst nur für Rezepte gebaut; die Gutscheine brauchten dasselbe
    # (ein Foto der Karte, damit man im Laden den Strichcode zeigen
    # kann). Welche Sammlung einen Ordner hat, weiss bilder.ORDNER.

    def bilder_ordner(collection: str) -> Path | None:
        return bilder.ordner(hub.data.path, collection)

    def bild_adresse(collection: str, kennung: str) -> str:
        # Die Rezepte behalten ihre alte Adresse: Sie steht in jedem
        # gespeicherten Rezept und in jedem Telefon-Cache. Alles Neue
        # wohnt unter seiner Sammlung.
        if collection == "recipes":
            return f"/api/recipes/{kennung}/bild"
        return f"/api/family/{collection}/{kennung}/bild"

    def bild_ablegen(collection: str, item: dict[str, Any]) -> None:
        """Ein mitgeschicktes Foto auf die Platte legen (in place).

        Kommt kein data-URI, bleibt alles, wie es ist - auch die
        Rezepte, deren Bild noch als base64 im Datenspeicher steckt.
        Umgestellt wird beim nächsten Speichern von selbst.
        """
        ordner = bilder_ordner(collection)
        kennung = bilder.safe_id(item.get("id"))
        entschluesselt = bilder.decode_data_uri(item.get("image_url"))
        if ordner is None or kennung is None or entschluesselt is None:
            return
        roh, endung = entschluesselt
        try:
            ordner.mkdir(parents=True, exist_ok=True)
            # Alte Fassung mit anderer Endung wegräumen, sonst lägen zwei
            # Bilder da und das ausgelieferte wäre Zufall.
            for vorher in ordner.glob(f"{kennung}.*"):
                vorher.unlink(missing_ok=True)
            (ordner / f"{kennung}.{endung}").write_bytes(roh)
        except OSError as err:
            # Ein Foto ist kein Grund, den Eintrag nicht zu speichern.
            log.warning("Bild %s/%s nicht geschrieben: %s", collection, kennung, err)
            return
        item["image_url"] = (
            f"{bild_adresse(collection, kennung)}?v={bilder.fingerprint(roh)}"
        )

    def bild_loeschen(collection: str, item_id: str) -> None:
        bilder.loeschen(bilder_ordner(collection), item_id)

    def anhang_eintrag(
        collection: str, kennung: str, user: User, sonst: str
    ) -> dict[str, Any] | None:
        """Den Eintrag holen, wenn diese Person ihn sehen darf.

        Nur die Gutscheine haben etwas zu verbergen; für jede andere
        Sammlung kommt None zurück, und die Route liefert einfach aus -
        das Foto einer Lasagne verrät niemanden.

        404 und nicht 403 (anders als beim Ändern in sichtbar_oder_403):
        Eine Adresse, die «verboten» sagt, verrät, dass es dort etwas
        gibt. Beim Ändern ist das hinnehmbar - die Kennung stammt dann
        aus einer Liste, die man abgeschrieben hat. Eine Bild- oder
        Dateiadresse dagegen landet in Verläufen und Vorschauen, und
        «gibt es nicht» ist dort die einzige Antwort, die nichts sagt.
        """
        if collection != "vouchers":
            return None
        eintrag = next(
            (
                row
                for row in hub.data.get(gutscheine.KEY)
                if isinstance(row, dict) and row.get("id") == kennung
            ),
            None,
        )
        if eintrag is None or not gutscheine.darf_sehen(eintrag, user.name):
            raise HTTPException(status_code=404, detail=sonst)
        return eintrag

    def bild_liefern(collection: str, item_id: str, request: Request, v: str) -> Response:
        """Das Foto eines Eintrags – als eigene Datei, damit es im Cache bleibt.

        Die Kennung im `v`-Parameter ist der Fingerabdruck des Bildes:
        Ein neues Foto ist eine neue Adresse, ein altes darf ein Jahr
        lang liegen bleiben. Ohne das müsste die App bei jedem Öffnen
        neu fragen, ob sich etwas geändert hat.

        Bei den Gutscheinen gilt am Bild dieselbe Regel wie am Eintrag:
        Das Foto einer privaten Karte zeigt Nummer und Strichcode - wer
        den Eintrag nicht sehen darf, bekommt auch das Bild nicht, und
        zwar als «Kein Bild», damit die Adresse nichts verrät.
        """
        user = family_user(request)
        ordner = bilder_ordner(collection)
        kennung = bilder.safe_id(item_id)
        if ordner is None or kennung is None:
            raise HTTPException(status_code=404, detail="Kein Bild")
        anhang_eintrag(collection, kennung, user, "Kein Bild")
        for datei in sorted(ordner.glob(f"{kennung}.*")) if ordner.exists() else []:
            return Response(
                content=datei.read_bytes(),
                media_type=bilder.media_type(datei.name),
                headers={
                    "Cache-Control": "public, max-age=31536000, immutable"
                    if v
                    else "public, max-age=300"
                },
            )
        raise HTTPException(status_code=404, detail="Kein Bild")

    @app.get("/api/recipes/{recipe_id}/bild")
    async def recipe_image(recipe_id: str, request: Request, v: str = "") -> Response:
        """Die alte Adresse der Rezeptbilder - siehe bild_adresse()."""
        return bild_liefern("recipes", recipe_id, request, v)

    @app.get("/api/family/{collection}/{item_id}/bild")
    async def family_image(
        collection: str, item_id: str, request: Request, v: str = ""
    ) -> Response:
        """Das Bild eines Eintrags, für jede Sammlung mit Bildordner."""
        if collection not in bilder.ORDNER:
            raise HTTPException(status_code=404, detail="Diese Liste führt keine Bilder")
        return bild_liefern(collection, item_id, request, v)

    # ── Dateien der Familienlisten: Gutscheine (Punkt 266) ────────────────
    #
    # Der Zwilling der Bilder von oben, in derselben Bauart: hereingereicht
    # als data-URI, abgelegt neben den Daten, ausgeliefert unter einer
    # Adresse mit Fingerabdruck. Ein Gutschein kommt meist als PDF im
    # Mail-Anhang, und ein Foto der Karte hilft dann niemandem.
    #
    # Zwei Unterschiede, beide in core/dateien.py begründet: Die Datei
    # trägt einen Namen (der geht in den Content-Disposition-Kopf, und der
    # Name kommt von aussen), und eine unbrauchbare Datei wird abgelehnt
    # statt stillschweigend übergangen - ein Bild kann man weglassen, eine
    # angehängte Datei nicht.

    def dateien_ordner(collection: str) -> Path | None:
        return dateien.ordner(hub.data.path, collection)

    def datei_adresse(collection: str, kennung: str) -> str:
        return f"/api/family/{collection}/{kennung}/datei"

    def datei_aufnehmen(
        collection: str, item_id: Any, anhang: Any, fileid: str = ""
    ) -> dict[str, Any] | None:
        """Eine mitgeschickte Datei ablegen und ihren Block zurückgeben.

        Hereingereicht wird `{"data": "<data-URI>", "name": "…"}`; zurück
        kommt der Block, wie er am Eintrag steht (dateien.block). None
        heisst «nichts Neues dabei» - dann bleibt stehen, was schon am
        Eintrag ist: Ein unveränderter Block mit fertiger Adresse geht bei
        jedem Speichern mit hin und her und darf das überleben.

        Wird VOR jeder Änderung am Eintrag gerufen: Eine abgelehnte Datei
        wirft hier, und dann soll der Eintrag noch unberührt sein.
        """
        if not isinstance(anhang, dict) or "data" not in anhang:
            return None
        ordner = dateien_ordner(collection)
        kennung = bilder.safe_id(item_id)
        if ordner is None or kennung is None:
            return None
        try:
            roh, endung, typ = dateien.entpacke(anhang.get("data"))
        except dateien.DateiFehler as err:
            # 413 für «zu gross», 415 für «solche nicht» - warum
            # überhaupt abgelehnt und nicht geklemmt, steht bei
            # dateien.entpacke().
            raise HTTPException(status_code=err.status, detail=str(err)) from err
        try:
            ordner.mkdir(parents=True, exist_ok=True)
            # Alte Fassung mit anderer Endung wegräumen, sonst lägen zwei
            # Dateien da und die ausgelieferte wäre Zufall.
            for vorher in ordner.glob(dateien.datei_muster(kennung, fileid)):
                vorher.unlink(missing_ok=True)
            (ordner / dateien.datei_name(kennung, fileid, endung)).write_bytes(roh)
        except OSError as err:
            # Hier anders als beim Bild: Ein Foto, das nicht auf die
            # Platte kam, ist ein fehlendes Foto; eine Datei, die nicht
            # ankam, ist ein Gutschein, den jemand für gesichert hält.
            # Also sagen, dass es schiefging.
            log.warning("Datei %s/%s nicht geschrieben: %s", collection, kennung, err)
            raise HTTPException(
                status_code=500, detail="Die Datei liess sich nicht ablegen"
            ) from err
        return dateien.block(
            f"{datei_adresse(collection, kennung)}?"
            + (f"f={fileid}&" if fileid else "")
            + f"v={bilder.fingerprint(roh)}",
            dateien.sauberer_name(anhang.get("name"), endung),
            typ,
            len(roh),
            fileid,
        )

    def anhaenge_aufnehmen(
        collection: str, item_id: Any, body: dict[str, Any]
    ) -> list[dict[str, Any]] | None:
        """Die Liste ``files`` (Punkt 520) ablegen - None ohne diese Liste.

        Neue Dateien (mit ``data``) bekommen eine Kennung und werden
        abgelegt; fertige Blöcke reisen unverändert weiter. Ohne die
        Liste schickt eine ältere App-Fassung nur ``file`` - dann gilt
        der alte Weg über datei_aufnehmen.
        """
        if "files" not in body or not isinstance(body.get("files"), list):
            return None
        bloecke: list[dict[str, Any]] = []
        for eintrag in body["files"][: dateien.MAX_DATEIEN]:
            if not isinstance(eintrag, dict):
                continue
            if "data" in eintrag:
                # Die erste neue Datei ohne alte Vorgängerin darf die alte,
                # kennungslose Form nehmen - sonst immer mit Kennung.
                neu = datei_aufnehmen(collection, item_id, eintrag, dateien.neue_kennung())
                if neu is not None:
                    bloecke.append(neu)
                continue
            fertig = dateien.bereinigen(eintrag)
            if fertig is not None:
                bloecke.append(fertig)
        return bloecke

    def anhaenge_abgleichen(collection: str, item: dict[str, Any]) -> None:
        """``file`` und ``files`` zusammenhalten und Verwaistes wegräumen.

        ``file`` bleibt der erste Block - ältere App-Fassungen sehen so
        weiterhin einen Beleg. Was auf der Platte liegt und an keinem
        Block mehr hängt, verschwindet: Es bliebe sonst unter seiner
        alten Adresse abrufbar, obwohl am Gutschein nichts mehr steht.
        """
        bloecke = dateien.anhaenge(item)
        item["files"] = bloecke
        if bloecke:
            item["file"] = bloecke[0]
        elif "file" in item:
            item["file"] = None
        dateien.aufraeumen(
            dateien_ordner(collection),
            item.get("id"),
            {str(block.get("id") or "") for block in bloecke},
        )

    def datei_loeschen(collection: str, item_id: str) -> None:
        dateien.loeschen(dateien_ordner(collection), item_id)

    def datei_liefern(
        collection: str, item_id: str, request: Request, v: str, f: str = ""
    ) -> Response:
        """Die Datei eines Eintrags – wie das Bild, nur mit Namen.

        Derselbe Fingerabdruck im `v` und dasselbe Zwischenspeichern wie
        beim Bild, dieselbe Sichtbarkeitsprüfung (siehe anhang_eintrag):
        Das PDF eines privaten Gutscheins ist der Gutschein.

        Der Name kommt aus dem Eintrag und damit ursprünglich aus einer
        Mail - er geht durch dateien.disposition(), damit ein
        Zeilenumbruch darin nicht die Kopfzeile sprengt.
        """
        user = family_user(request)
        ordner = dateien_ordner(collection)
        kennung = bilder.safe_id(item_id)
        if ordner is None or kennung is None:
            raise HTTPException(status_code=404, detail="Keine Datei")
        eintrag = anhang_eintrag(collection, kennung, user, "Keine Datei") or {}
        fileid = bilder.safe_id(f) or "" if f else ""
        anhang = next(
            (
                block
                for block in dateien.anhaenge(eintrag)
                if str(block.get("id") or "") == fileid
            ),
            eintrag.get("file"),
        )
        gewuenscht = anhang.get("name") if isinstance(anhang, dict) else ""
        for datei in (
            sorted(ordner.glob(dateien.datei_muster(kennung, fileid))) if ordner.exists() else []
        ):
            return Response(
                content=datei.read_bytes(),
                media_type=dateien.media_type(datei.name),
                headers={
                    # «inline», damit das PDF im Telefon aufgeht statt im
                    # Download-Ordner zu verschwinden - man zeigt den
                    # Gutschein an der Kasse.
                    "Content-Disposition": dateien.disposition(
                        dateien.sauberer_name(gewuenscht, datei.suffix.lstrip("."))
                    ),
                    "Cache-Control": "public, max-age=31536000, immutable"
                    if v
                    else "public, max-age=300",
                },
            )
        raise HTTPException(status_code=404, detail="Keine Datei")

    @app.get("/api/family/{collection}/{item_id}/datei")
    async def family_file(
        collection: str, item_id: str, request: Request, v: str = "", f: str = ""
    ) -> Response:
        """Die Datei eines Eintrags, für jede Sammlung mit Dateiordner.

        ``f`` ist die Kennung einer weiteren Datei (Punkt 520); ohne sie
        kommt die erste, wie bisher.
        """
        if collection not in dateien.ORDNER:
            raise HTTPException(status_code=404, detail="Diese Liste führt keine Dateien")
        return datei_liefern(collection, item_id, request, v, f)

    @app.get("/api/family/{collection}/{item_id}/belegtext")
    async def family_file_text(
        collection: str, item_id: str, request: Request
    ) -> dict[str, Any]:
        """Der Text des angehängten Belegs (Punkt 298 der Werkbank).

        Damit die App Betrag, Nummer und Ablaufdatum vorschlagen kann,
        statt dass jemand sie abtippt - gelesen wird der Text drüben
        (lib/gutscheinlesen.ts), hier wird er nur herausgeholt.

        Dieselbe Sichtbarkeitsprüfung wie bei der Datei selbst: Der Text
        eines privaten Gutscheins ist der Gutschein.

        Fehlt das Extra `pypdf`, kommt `verfuegbar: false` zurück und
        kein Fehler - der Knopf bleibt dann dunkel, eintragen geht
        weiterhin von Hand.
        """
        if collection not in dateien.ORDNER:
            raise HTTPException(status_code=404, detail="Diese Liste führt keine Dateien")
        user = family_user(request)
        ordner = dateien_ordner(collection)
        kennung = bilder.safe_id(item_id)
        if ordner is None or kennung is None:
            raise HTTPException(status_code=404, detail="Keine Datei")
        anhang_eintrag(collection, kennung, user, "Keine Datei")
        # Alle Belege hintereinander (Punkt 520): Der Betrag steht im
        # einen, die Nummer im anderen - die App sucht in beidem.
        dateien_hier = (
            sorted(ordner.glob(f"{kennung}.*")) + sorted(ordner.glob(f"{kennung}{dateien.TRENNER}*"))
            if ordner.exists()
            else []
        )
        if not dateien_hier:
            raise HTTPException(status_code=404, detail="Keine Datei")
        texte = [
            beleglesen.aus_datei(datei.read_bytes(), dateien.media_type(datei.name))
            for datei in dateien_hier
        ]
        return {
            "text": "\n\n".join(t for t in texte if t),
            "verfuegbar": beleglesen.verfuegbar(),
            # Ob auch Fotos lesbar sind (Punkt 533) - die App sagt sonst
            # beim Bild «kann Fotos nicht lesen» statt «PDF».
            "ocr": beleglesen.ocr_verfuegbar(),
        }

    @app.get("/api/family")
    async def family_all(request: Request) -> dict[str, Any]:
        user = family_user(request)
        return {
            name: nur_sichtbare(name, hub.data.get(f"family_{name}"), user)
            for name in sorted(FAMILY_COLLECTIONS)
        }

    @app.post("/api/recipes/import")
    async def recipe_import(body: RecipeImportRequest, request: Request) -> dict[str, Any]:
        """Ein Rezept von einer Web-Seite lesen (Punkt 136 der Werkbank).

        Holt die Seite und liest das schema.org/Recipe aus dem Seitenkopf
        - gespeichert wird hier nichts: Die App öffnet das Formular
        vorbefüllt, nachbessern und sichern bleibt beim Benutzer.
        """
        family_user(request)
        url = body.url.strip()
        if not url.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Das ist keine Web-Adresse")
        import aiohttp

        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                # Mit Browser-Kennung: Manche Rezeptseiten liefern nackten
                # Clients eine Hinweisseite statt des Rezepts.
                async with session.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (HomePilot Rezeptimport)"},
                    max_redirects=5,
                ) as antwort:
                    if antwort.status >= 400:
                        raise HTTPException(
                            status_code=502,
                            detail=f"Die Seite antwortet mit {antwort.status}",
                        )
                    seite = await antwort.text(errors="replace")
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"Seite nicht erreichbar: {err}"
            ) from err

        rezept = rezeptimport.recipe_from_html(seite)
        if rezept is None:
            raise HTTPException(
                status_code=422,
                detail="Auf dieser Seite steckt kein maschinenlesbares Rezept",
            )
        rezept["source"] = url
        return {"recipe": rezept}

    async def tell_the_assignee(
        collection: str, item: dict[str, Any], by: str, vorher: str | None = None
    ) -> None:
        """Der zugewiesenen Person Bescheid geben.

        Eine Liste ohne Namen erledigt niemand - und ein Name, den die
        betroffene Person nie sieht, auch nicht. Deshalb geht eine
        Nachricht raus, sobald jemandem etwas zugeteilt wird.

        Nicht an sich selbst: Wer sich eine Aufgabe notiert, weiss davon.
        Und nur bei einer Änderung - sonst käme bei jedem Abhaken eine
        neue Nachricht für dieselbe Zuteilung.
        """
        if collection not in ("tasks", "chores"):
            return
        wer = str(item.get("member") or "").strip()
        if not wer or wer == by or wer == str(vorher or "").strip():
            return
        was = str(item.get("text") or "").strip() or "Ein Eintrag"
        frist = str(item.get("due") or "").strip()
        tokens = hub.push.recipients(hub.users.users, to=wer, category="tasks")
        if not tokens:
            return
        try:
            await hub.push.send(
                tokens,
                "Aufgaben" if collection == "tasks" else "Ämtli",
                f"{was} ist jetzt bei dir" + (f" - bis {frist}" if frist else "."),
                data={"kind": "family", "collection": collection},
                category="tasks",
            )
        except Exception as err:  # eine Nachricht ist kein Grund zu scheitern
            log.warning("Zuweisungs-Nachricht an %s fehlgeschlagen: %s", wer, err)

    # ── Eine Übergabe braucht eine Annahme (Punkt 377 der Werkbank) ────────
    #
    # Drei eigene Routen statt eines PUT auf die Sammlung: Ein
    # vorgeschlagener Gutschein bleibt bis zur Annahme fremd (siehe
    # gutscheine.darf_sehen) - die eingeladene Person darf ihn also nicht
    # per GET sehen. Der schmale Auszug hier ist eigens dafür da.

    @app.get("/api/family/vouchers/eingehend")
    async def vouchers_eingehend(request: Request) -> list[dict[str, Any]]:
        """Was auf mich zur Annahme wartet."""
        user = family_user(request)
        return gutscheine.eingehende_uebergaben(
            hub.data.get(gutscheine.KEY), user.name
        )

    @app.post("/api/family/vouchers/{item_id}/annehmen")
    async def voucher_annehmen(item_id: str, request: Request) -> dict[str, Any]:
        user = family_user(request)
        rows = hub.data.get(gutscheine.KEY)
        for row in rows:
            if row.get("id") != item_id:
                continue
            neu, fehler = gutscheine.uebergabe_annehmen(row, user.name, datetime.now())
            if fehler:
                raise HTTPException(status_code=403, detail=fehler)
            assert neu is not None
            row.clear()
            row.update(neu)
            hub.data.set(gutscheine.KEY, rows)
            await family_changed("vouchers")
            return row
        raise HTTPException(status_code=404, detail="Gutschein nicht gefunden")

    @app.post("/api/family/vouchers/{item_id}/ablehnen")
    async def voucher_ablehnen(item_id: str, request: Request) -> dict[str, Any]:
        user = family_user(request)
        rows = hub.data.get(gutscheine.KEY)
        for row in rows:
            if row.get("id") != item_id:
                continue
            neu, fehler = gutscheine.uebergabe_ablehnen(row, user.name, datetime.now())
            if fehler:
                raise HTTPException(status_code=403, detail=fehler)
            assert neu is not None
            row.clear()
            row.update(neu)
            hub.data.set(gutscheine.KEY, rows)
            await family_changed("vouchers")
            return row
        raise HTTPException(status_code=404, detail="Gutschein nicht gefunden")

    async def tell_the_recipient_of_transfer(
        item: dict[str, Any], empfaenger_name: str, von: str
    ) -> None:
        """Ohne diese Nachricht wüsste die eingeladene Person nie, dass
        etwas auf sie wartet - der Gutschein selbst bleibt bis zur
        Annahme unsichtbar für sie (siehe gutscheine.darf_sehen)."""
        tokens = hub.push.recipients(hub.users.users, to=empfaenger_name, category="vouchers")
        if not tokens:
            return
        shop = str(item.get("shop") or "Gutschein").strip()
        try:
            await hub.push.send(
                tokens,
                "Gutschein für dich",
                f"{von} möchte dir den Gutschein «{shop}» übergeben - unter "
                "Familie → Gutscheine → Eingehend annehmen oder ablehnen.",
                data={"kind": "family", "collection": "vouchers", "id": item.get("id")},
                category="vouchers",
            )
        except Exception as err:  # eine Nachricht ist kein Grund zu scheitern
            log.warning("Übergabe-Nachricht an %s fehlgeschlagen: %s", empfaenger_name, err)

    @app.get("/api/calendar/events")
    async def calendar_events(request: Request, month: str = "") -> dict[str, Any]:
        """Termine eines Monats – für die Monatsansicht in der App.

        Der Zustand der Kalender-Entität trägt nur die nächsten zwölf
        Termine. Das ist für die Kachel richtig und für ein Monatsraster
        zu wenig: Wer einen Monat zurückblätterte, sah ein leeres Raster
        und musste glauben, es sei nichts gewesen.

        `month` als «JJJJ-MM»; ohne Angabe der laufende Monat.
        """
        current_user(request)
        service = hub.integrations.get("google_calendar")
        if service is None or not hasattr(service, "events_between"):
            raise HTTPException(
                status_code=404,
                detail=(
                    "Dafür braucht es die Kalender-Anbindung "
                    "(integration: google_calendar)."
                ),
            )
        heute = datetime.now()
        try:
            jahr, monat = (
                (int(month[:4]), int(month[5:7])) if month else (heute.year, heute.month)
            )
            von, bis = calendar_module.month_window(jahr, monat)
        except (ValueError, IndexError):
            raise HTTPException(
                status_code=400, detail="'month' erwartet die Form JJJJ-MM"
            ) from None
        try:
            return {"events": await service.events_between(von, bis)}
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"Kalender nicht erreichbar: {err}"
            ) from err

    @app.get("/api/family/{collection}")
    async def family_one(collection: str, request: Request) -> list[dict[str, Any]]:
        """Eine einzelne Liste.

        Ohne diesen Weg blieb nur /api/family - und das liefert alles auf
        einmal, Rezepte und Dokumente eingeschlossen. Für die Kopfzeile,
        die jede Minute nach der Einkaufsliste fragt, ist das die falsche
        Grössenordnung; und wer es trotzdem einzeln versuchte, bekam vom
        Server ein «Methode nicht erlaubt» und in der App eine leere
        Liste, die aussah, als wäre nichts einzukaufen.
        """
        user = family_user(request)
        return nur_sichtbare(collection, hub.data.get(family_key(collection)), user)

    @app.get("/api/shopping/known")
    async def shopping_known(request: Request, q: str = "") -> list[str]:
        """Schon einmal eingekaufte Artikel – für die Vervollständigung.

        Bewusst im Hub und nicht auf dem Telefon: Was Livia einträgt, soll
        Stefan vorgeschlagen bekommen. Ein Gedächtnis je Gerät wäre nach
        einer Neuinstallation ausserdem leer.

        Eigener Weg statt /api/family/{collection}: Das ist keine
        Familienliste, die man ansieht und abhakt, sondern eine Zutat der
        Eingabe.
        """
        family_user(request)
        return shopping_module.suggestions(hub.data.get("shopping_known"), q)

    @app.post("/api/family/{collection}")
    async def family_add(
        collection: str, body: dict[str, Any], request: Request
    ) -> dict[str, Any]:
        import secrets

        user = family_user(request)
        key = family_key(collection)
        item = {
            k: v for k, v in body.items() if k not in ("id", "author", "created", "updated")
        }
        item["id"] = secrets.token_urlsafe(8)
        item["author"] = user.name
        item["created"] = datetime.now().isoformat(timespec="seconds")
        # Der Startwert für den Gleichzeitig-Stempel (Punkt 341) - erst ab
        # hier gibt es etwas, womit ein späteres PUT verglichen werden kann.
        item["updated"] = time.time()
        # Die Datei vor dem Bereinigen: bereinigen() wirft alles weg, was
        # kein fertiger Block ist - der data-URI wäre danach fort.
        if collection in dateien.ORDNER:
            bloecke = anhaenge_aufnehmen(collection, item["id"], item)
            if bloecke is not None:
                item["files"] = bloecke
            else:
                anhang = datei_aufnehmen(collection, item["id"], item.get("file"))
                if anhang is not None:
                    item["file"] = anhang
        if collection == "vouchers":
            item = gutscheine.bereinigen(item)
        if collection in dateien.ORDNER:
            anhaenge_abgleichen(collection, item)
        if collection in bilder.ORDNER:
            bild_ablegen(collection, item)
        hub.data.set(key, [*hub.data.get(key), item])
        # Einkaufsartikel gehen ins Gedächtnis für die Vervollständigung.
        # Nicht die Liste selbst dafür nehmen: Erledigtes wird irgendwann
        # entfernt, und dann wäre «Milch» wieder unbekannt.
        if collection == "shopping":
            hub.data.set(
                "shopping_known",
                shopping_module.remember(
                    hub.data.get("shopping_known"), str(item.get("text") or "")
                ),
            )
            # Zusätzlich mit Zeitpunkt: Daraus entsteht der Rhythmus, den
            # die App als Vorschlag zeigt (Punkt 176). Das Gedächtnis
            # oben weiss nur *was*, nicht *wie oft*.
            hub.data.set(
                "shopping_log",
                shopping_module.log_item(
                    hub.data.get("shopping_log"),
                    str(item.get("text") or ""),
                    time.time(),
                ),
            )
        await tell_the_assignee(collection, item, user.name)
        await family_changed(collection)
        return item

    @app.put("/api/family/{collection}/{item_id}")
    async def family_update(
        collection: str, item_id: str, body: dict[str, Any], request: Request
    ) -> dict[str, Any]:
        user = family_user(request)
        key = family_key(collection)
        items = hub.data.get(key)
        for item in items:
            if item.get("id") == item_id:
                sichtbar_oder_403(collection, item, user)
                # Gleichzeitiges Bearbeiten (Punkt 341): Der Stempel, den
                # diese App beim Laden gesehen hat, muss noch zum
                # gespeicherten passen - sonst hat ein anderes Telefon
                # inzwischen gespeichert, und dieses PUT trüge dessen
                # Änderung sonst still wieder weg.
                if not gleichzeitig.stempel_passt(item.get("updated"), body.get("updated")):
                    raise HTTPException(
                        status_code=409,
                        detail="Der Eintrag wurde inzwischen von jemand anderem geändert.",
                    )
                # Die Datei zuerst, noch bevor am Eintrag etwas steht:
                # Eine zu grosse oder verbotene Datei wirft hier, und
                # dann soll der Gutschein unverändert geblieben sein -
                # die Einträge in `items` sind dieselben Objekte wie im
                # Datenspeicher.
                bloecke = (
                    anhaenge_aufnehmen(collection, item_id, body)
                    if collection in dateien.ORDNER
                    else None
                )
                anhang = (
                    datei_aufnehmen(collection, item_id, body.get("file"))
                    if collection in dateien.ORDNER and bloecke is None
                    else None
                )
                vorher = str(item.get("member") or "")
                war_erledigt = bool(item.get("done"))
                # Vor dem Überschreiben festhalten, was der Hub am
                # Verlauf schon kennt (Punkt 371 der Werkbank) - danach
                # ist item["transactions"] schon die Sicht der App, und
                # genau die darf hier nicht einfach ersetzen, was ein
                # anderes Telefon inzwischen gebucht hat.
                vorherige_buchungen = [
                    t for t in (item.get("transactions") or []) if isinstance(t, dict)
                ]
                # Für die Nachricht bei einer vorgeschlagenen Übergabe
                # (Punkt 377): nur bei einem frischen Vorschlag melden,
                # nicht bei jedem weiteren Speichern desselben Gutscheins.
                vorher_pending = str(item.get("pending_transfer_to") or "")
                item.update(
                    {
                        k: v
                        for k, v in body.items()
                        if k not in ("id", "author", "created", "updated")
                    }
                )
                if bloecke is not None:
                    item["files"] = bloecke
                elif anhang is not None:
                    item["file"] = anhang
                    # Die alte App schickt nur `file`: Dann ist die Liste
                    # genau diese eine Datei.
                    item["files"] = [anhang]
                elif "file" in body and bloecke is None:
                    # `file: null` einer älteren App heisst: keine Datei mehr.
                    item["files"] = [body["file"]] if isinstance(body.get("file"), dict) else []
                if collection == "vouchers":
                    neue_buchungen = body.get("transactions")
                    frische_buchung = False
                    if isinstance(neue_buchungen, list):
                        zusammengefuehrt = gutscheine.transaktionen_zusammenfuehren(
                            vorherige_buchungen, neue_buchungen
                        )
                        frische_buchung = len(zusammengefuehrt) > len(vorherige_buchungen)
                        item["transactions"] = zusammengefuehrt
                    # `left` klemmt bereinigen() nicht mehr nach dem, was
                    # die App schickt, sondern rechnet es aus dem
                    # zusammengeführten Verlauf - das ist die andere
                    # Hälfte der Absicherung.
                    sauber = gutscheine.bereinigen(item)
                    # Wer den Gutschein damit auf null gebracht hat (eine
                    # frische Buchung, kein blosses Formular-Speichern),
                    # bekommt ihn automatisch aus der Liste genommen
                    # (Punkt 372 der Werkbank) - ein leerer Gutschein ist
                    # erledigt, kein offener Posten mehr.
                    if frische_buchung and gutscheine.aufgebraucht(sauber):
                        sauber["archived"] = True
                    # Ein frischer Übergabe-Vorschlag (Punkt 377): über
                    # die reine Funktion, damit er dieselbe Merkzeile im
                    # Verlauf bekommt wie die spätere Annahme/Ablehnung -
                    # nicht nur ein stilles Feld.
                    neuer_vorschlag = str(sauber.get("pending_transfer_to") or "")
                    if neuer_vorschlag and neuer_vorschlag != vorher_pending:
                        sauber = gutscheine.uebergabe_vorschlagen(
                            sauber, neuer_vorschlag, user.name, datetime.now()
                        )
                    item.clear()
                    item.update(sauber)
                # Wer einen Anhang wegnimmt, nimmt ihn ganz weg: Bliebe die
                # Datei liegen, wäre sie unter ihrer alten Adresse weiter
                # abrufbar, obwohl am Gutschein nichts mehr davon steht.
                if collection in dateien.ORDNER:
                    anhaenge_abgleichen(collection, item)
                # Wann etwas abgehakt wurde, weiss sonst niemand - und
                # ohne das kann Erledigtes nicht von selbst verschwinden
                # (Punkt 170).
                if item.get("done") and not war_erledigt:
                    item["done_at"] = datetime.now().isoformat(timespec="seconds")
                    # Abgehakt heisst gekauft: Ein Standardartikel mit
                    # Takt beginnt hier von vorn. Ab dem *Eintragen* zu
                    # rechnen ginge daneben - eine Liste, die zwei Wochen
                    # liegen bleibt, schlüge den Kaffee sonst zwei Wochen
                    # zu früh wieder vor (siehe core/vorrat.py).
                    if collection == "shopping":
                        staples, geaendert = vorrat_module.nachgekauft(
                            hub.data.get("family_staples"), str(item.get("text") or "")
                        )
                        if geaendert:
                            hub.data.set("family_staples", staples)
                            await family_changed("staples")
                elif not item.get("done"):
                    item.pop("done_at", None)
                if collection in bilder.ORDNER:
                    bild_ablegen(collection, item)
                # Der neue Stempel - unabhängig vom Gutschein-Zweig oben
                # (der item.clear()/item.update() nutzt), damit jede
                # Änderung, gleich welcher Art, einen frischen bekommt.
                item["updated"] = time.time()
                hub.data.set(key, items)
                await tell_the_assignee(collection, item, user.name, vorher)
                if collection == "vouchers":
                    neu_pending = str(item.get("pending_transfer_to") or "")
                    if neu_pending and neu_pending != vorher_pending:
                        await tell_the_recipient_of_transfer(item, neu_pending, user.name)
                await family_changed(collection)
                return item
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")

    @app.delete("/api/family/{collection}/{item_id}")
    async def family_delete(
        collection: str, item_id: str, request: Request
    ) -> dict[str, Any]:
        """Löschen - aber nicht endgültig (Punkt 167).

        Abläufe und Szenen haben seit je einen Papierkorb; die
        Familienlisten hatten keinen. Ein Fehlgriff neben dem Häkchen
        löschte die Aufgabe, das Rezept, den Kontakt - für immer.
        """
        user = family_user(request)
        key = family_key(collection)
        items = hub.data.get(key)
        weg = next((item for item in items if item.get("id") == item_id), None)
        if weg is None:
            raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
        sichtbar_oder_403(collection, weg, user)
        # Das Bild bleibt liegen, solange der Eintrag im Papierkorb ist:
        # Zurückholen soll das Rezept samt Foto bringen, den Gutschein
        # samt Karte. Weg kommt es mit dem Korb - beim Leeren hier unten
        # oder nach dreissig Tagen durch den Wächter.
        hub.data.set(key, [item for item in items if item.get("id") != item_id])
        hub.data.set(
            "family_trash",
            trash_module.put(hub.data.get("family_trash"), collection, weg, user.name),
        )
        await family_changed(collection)
        return {"ok": True}

    # ── Papierkorb der Familienlisten (Punkt 167) ─────────────────────────

    @app.get("/api/family-trash")
    async def family_trash_list(request: Request) -> dict[str, Any]:
        """Was gelöscht wurde – dreissig Tage lang.

        Ein privater Gutschein bleibt auch im Korb privat: Sonst wäre
        der Umweg über Löschen und Papierkorb der Weg, ihn doch zu lesen.
        """
        user = family_user(request)
        rows = [
            row
            for row in trash_module.purge(hub.data.get("family_trash"))
            if row.get("kind") != "vouchers"
            or gutscheine.darf_sehen(row.get("item") or {}, user.name)
        ]
        return {"items": rows, "days": trash_module.KEEP_DAYS}

    @app.post("/api/family-trash/{collection}/{item_id}/restore")
    async def family_trash_restore(
        collection: str, item_id: str, request: Request
    ) -> dict[str, Any]:
        """Zurückholen – an dieselbe Stelle, mit derselben Kennung."""
        user = family_user(request)
        key = family_key(collection)
        row, rest = trash_module.take(hub.data.get("family_trash"), collection, item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Im Papierkorb ist das nicht")
        item = row.get("item") or {}
        sichtbar_oder_403(collection, item, user)
        hub.data.set("family_trash", rest)
        # Doppelt anlegen wäre schlimmer als gar nicht: Wer zweimal auf
        # «zurück» tippt, soll einen Eintrag bekommen, nicht zwei.
        vorhanden = hub.data.get(key)
        if not any(x.get("id") == item.get("id") for x in vorhanden):
            hub.data.set(key, [*vorhanden, item])
        await family_changed(collection)
        return {"ok": True, "item": item}

    @app.delete("/api/family-trash")
    async def family_trash_empty(request: Request) -> dict[str, Any]:
        """Den Korb leeren – für den, der sofort aufräumen will."""
        user = family_user(request)
        korb = hub.data.get("family_trash")
        for row in korb:
            art = str(row.get("kind") or "")
            kennung = str((row.get("item") or {}).get("id") or "")
            if art in bilder.ORDNER:
                bild_loeschen(art, kennung)
            # Und die angehängte Datei dazu (Punkt 266): Das PDF eines
            # Gutscheins ist der Gutschein - es darf nicht länger auf der
            # Platte liegen als der Eintrag.
            if art in dateien.ORDNER:
                datei_loeschen(art, kennung)
        hub.data.set("family_trash", [])
        log.info("%s hat den Familien-Papierkorb geleert (%d Einträge)", user.name, len(korb))
        return {"ok": True, "removed": len(korb)}

    # ── Was jede Woche fehlt (Punkt 176) ──────────────────────────────────

    @app.get("/api/shopping/due")
    async def shopping_due(request: Request) -> dict[str, Any]:
        """Posten, die nach dem üblichen Abstand wieder fällig wären.

        Ein Vorschlag zum Antippen, kein Eintrag: Wer die Milch selbst
        holt, will sie nicht jede Woche wegwischen müssen.
        """
        family_user(request)
        offen = {
            str(row.get("text") or "").strip().lower()
            for row in hub.data.get("family_shopping")
            if not row.get("done")
        }
        faellig = [
            row
            for row in shopping_module.rhythm(hub.data.get("shopping_log"), time.time())
            if row["text"].lower() not in offen
        ]
        return {"items": faellig[:8]}

    # ── Familienbuch und Hausadresse ──────────────────────────────────────

    # Eigener Weg, nicht /api/family/buch: Dort steht schon
    # /api/family/{collection}, und «buch» wäre eine unbekannte Liste.
    @app.get("/api/family-book")
    async def family_book(request: Request) -> Response:
        """Die Familiendaten als lesbare Seite (Punkt 169).

        Dieselbe Seite, die der Hub monatlich neben die Sicherungen
        legt - hier auf Zuruf, zum Ansehen, Drucken oder Weitergeben.
        """
        family_user(request)
        stand = datetime.now().strftime("%d.%m.%Y")
        return Response(
            content=familienbuch.render(hub.data.snapshot(), stand),
            media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/haus/adresse")
    async def haus_adresse(request: Request) -> dict[str, Any]:
        """Wo dieses Haus steht (Punkt 213).

        Wer 144 wählt, muss als Erstes sagen, WO er ist - und genau das
        weiss ein Babysitter in einem fremden Haus nicht auswendig. Die
        Adresse steht in der config.yaml unter `location.address`; ohne
        Eintrag kommt sie leer zurück und die App zeigt sie nicht.
        """
        family_user(request)
        loc = hub.config.location or {}
        return {
            "address": str(loc.get("address") or "").strip(),
            "note": str(loc.get("address_note") or "").strip(),
        }

