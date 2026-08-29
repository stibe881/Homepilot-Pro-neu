"""Das Kamerabild in der Push-Nachricht.

Die Adresse ist bewusst ohne Anmeldung erreichbar – anders kann das
Telefon das Bild nicht holen, denn es zeigt die Nachricht an, bevor die App
läuft. Was diesen Handel vertretbar macht, wird hier geprüft: raten geht
nicht, und nach zehn Minuten ist die Adresse tot.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub
from homepilot.core.snapshots import SnapshotStore, image_url

from .conftest import make_config

JPEG = b"\xff\xd8\xff\xe0 ein Bild"


def test_a_stored_image_comes_back():
    store = SnapshotStore()
    token = store.put(JPEG, now=1000)
    assert store.get(token, now=1000) == JPEG


def test_the_address_dies_after_ten_minutes():
    store = SnapshotStore(ttl=600)
    token = store.put(JPEG, now=1000)
    assert store.get(token, now=1599) == JPEG
    assert store.get(token, now=1600) is None
    # Und ist danach auch nicht mehr im Speicher.
    assert len(store) == 0


def test_an_unknown_token_looks_exactly_like_an_expired_one():
    """Sonst liesse sich am Unterschied ablesen, ob geraten wurde."""
    store = SnapshotStore()
    assert store.get("gibtsnicht") is None


def test_tokens_are_long_and_never_repeat():
    store = SnapshotStore()
    tokens = {store.put(JPEG) for _ in range(5)}
    assert len(tokens) == 5
    assert all(len(token) >= 40 for token in tokens)


def test_the_oldest_image_falls_out_when_it_gets_crowded():
    """Ein Daueralarm soll den Speicher nicht vollschreiben."""
    store = SnapshotStore(limit=3)
    tokens = [store.put(JPEG, now=1000 + index) for index in range(5)]
    assert len(store) == 3
    assert store.get(tokens[0], now=1010) is None
    assert store.get(tokens[-1], now=1010) == JPEG


def test_expired_images_are_swept_up_even_without_being_asked_for():
    store = SnapshotStore(ttl=100)
    store.put(JPEG, now=1000)
    store.put(JPEG, now=2000)
    assert len(store) == 1


def test_without_a_public_address_there_is_no_link():
    """Eine geratene Adresse wäre schlimmer als keine: Das Telefon zeigte
    dann einen leeren Kasten, wo ein Bild sein sollte."""
    assert image_url(None, "abc") is None
    assert image_url("", "abc") is None
    assert image_url("haus.example.ch", "abc") is None


def test_the_link_is_built_from_the_configured_address():
    assert (
        image_url("https://haus.example.ch/", "abc")
        == "https://haus.example.ch/api/push/image/abc"
    )


def test_the_endpoint_serves_the_image_without_a_token():
    """Genau das ist der Punkt: Das Betriebssystem hat keinen Token."""
    hub = Hub(make_config(token="geheim"))
    token = hub.snapshots.put(JPEG)
    with TestClient(create_app(hub)) as client:
        # Alles andere ist ohne Anmeldung zu.
        assert client.get("/api/entities").status_code == 401

        response = client.get(f"/api/push/image/{token}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["cache-control"] == "no-store"
        assert response.content == JPEG

        assert client.get("/api/push/image/geraten").status_code == 404


def test_the_media_type_comes_from_the_first_bytes():
    """Einen Dateinamen gibt es hier nicht – und iOS zeigt eine Datei mit
    falschem Typ schlicht nicht an."""
    from homepilot.core.snapshots import media_type

    assert media_type(b"\xff\xd8\xff\xe0 jpeg") == "image/jpeg"
    assert media_type(b"\x89PNG\r\n\x1a\n") == "image/png"
    assert media_type(b"\x00\x00\x00\x20ftypisom0000") == "video/mp4"


# ── Reservieren und Nachreichen ────────────────────────────────────────
#
# Warum es das gibt, steht in core/personenbild.py: Das beste Bild ist
# nicht das vom Moment des Auslösers, sondern das vom Moment, in dem die
# Kamera wirklich jemanden sieht. Die Nachricht trägt nur die Adresse und
# darf darauf nicht warten – also wird die Adresse zuerst vergeben.


def test_a_reserved_address_looks_empty_until_it_is_filled():
    store = SnapshotStore()
    token = store.reserve()
    # Von aussen ununterscheidbar von «gibt es nicht» – und das ist gut so.
    assert store.get(token) is None
    store.fuellen(token, JPEG)
    assert store.get(token) == JPEG


@pytest.mark.asyncio
async def test_waiting_ends_the_moment_the_image_arrives():
    store = SnapshotStore()
    token = store.reserve()

    async def spaeter():
        await asyncio.sleep(0.02)
        store.fuellen(token, JPEG)

    asyncio.get_running_loop().create_task(spaeter())
    assert await store.warten(token, 2.0) == JPEG


@pytest.mark.asyncio
async def test_no_image_is_an_answer_too_and_comes_at_once():
    """Sonst hinge das Telefon die volle Frist auf etwas, das feststeht."""
    store = SnapshotStore()
    token = store.reserve()
    store.fuellen(token, None)

    begonnen = asyncio.get_running_loop().time()
    assert await store.warten(token, 5.0) is None
    assert asyncio.get_running_loop().time() - begonnen < 1.0


@pytest.mark.asyncio
async def test_an_address_that_falls_out_of_the_store_wakes_its_waiters():
    """Beim Überlaufen fliegt das älteste – wer darauf wartet, erfährt es."""
    store = SnapshotStore(limit=2)
    token = store.reserve()

    async def voll_machen():
        await asyncio.sleep(0.02)
        for _ in range(3):
            store.put(JPEG)

    asyncio.get_running_loop().create_task(voll_machen())
    begonnen = asyncio.get_running_loop().time()
    assert await store.warten(token, 5.0) is None
    assert asyncio.get_running_loop().time() - begonnen < 1.0


@pytest.mark.asyncio
async def test_waiting_on_an_address_nobody_ever_gave_out_returns_at_once():
    store = SnapshotStore()
    assert await store.warten("geraten", 5.0) is None
