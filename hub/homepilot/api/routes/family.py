"""Familie: geteilte Listen (Aufgaben, Einkauf, Pinnwand …).

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
)

from ...core import rezeptimport
from ...integrations import google_calendar as calendar_module
from ...core import shopping as shopping_module
from ...core.users import Role, User
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
            "recipes", "documents", "staples", "chores", "medications",
            "emergency", "polls", "shops",
        }
    )

    def family_user(request: Request) -> User:
        user = current_user(request)
        if user.role == Role.GUEST and "familie" not in user.features:
            raise HTTPException(status_code=403, detail="Für Gäste nicht sichtbar")
        return user

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

    @app.get("/api/family")
    async def family_all(request: Request) -> dict[str, Any]:
        family_user(request)
        return {name: hub.data.get(f"family_{name}") for name in sorted(FAMILY_COLLECTIONS)}

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
            )
        except Exception as err:  # eine Nachricht ist kein Grund zu scheitern
            log.warning("Zuweisungs-Nachricht an %s fehlgeschlagen: %s", wer, err)

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
        family_user(request)
        return list(hub.data.get(family_key(collection)))

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
        item = {k: v for k, v in body.items() if k not in ("id", "author", "created")}
        item["id"] = secrets.token_urlsafe(8)
        item["author"] = user.name
        item["created"] = datetime.now().isoformat(timespec="seconds")
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
                vorher = str(item.get("member") or "")
                item.update(
                    {k: v for k, v in body.items() if k not in ("id", "author", "created")}
                )
                hub.data.set(key, items)
                await tell_the_assignee(collection, item, user.name, vorher)
                await family_changed(collection)
                return item
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")

    @app.delete("/api/family/{collection}/{item_id}")
    async def family_delete(
        collection: str, item_id: str, request: Request
    ) -> dict[str, Any]:
        family_user(request)
        key = family_key(collection)
        items = hub.data.get(key)
        remaining = [item for item in items if item.get("id") != item_id]
        if len(remaining) == len(items):
            raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
        hub.data.set(key, remaining)
        await family_changed(collection)
        return {"ok": True}

