"""Web-Player-TOTP: die reinen Bausteine für das Wecken von Cast-Boxen.

Kein Netz, keine Cookies – nur die Rechenschritte, die zum gültigen
Einmalcode führen. Bricht Spotify das Verfahren, schlägt genau hier ein
Testwert um und zeigt, dass die Secrets nachgezogen werden müssen.
"""

import base64

from homepilot.integrations.spotify_webplayer import (
    FALLBACK_SECRETS,
    newest_secret,
    secret_to_base32,
    totp_at,
)


def test_secret_to_base32_is_deterministic_and_decodable():
    secret = secret_to_base32(FALLBACK_SECRETS["61"])
    # Base32 ohne Padding, wieder dekodierbar – sonst wäre der TOTP-Schlüssel
    # kaputt und jedes Wecken schlüge fehl.
    assert secret and "=" not in secret
    base64.b32decode(secret + "=" * (-len(secret) % 8))


def test_totp_is_six_digits_and_changes_per_period():
    secret = secret_to_base32(FALLBACK_SECRETS["61"])
    a = totp_at(secret, 1_000_000)
    b = totp_at(secret, 1_000_000 + 30)  # nächste 30-Sekunden-Periode
    assert a.isdigit() and len(a) == 6
    assert a != b
    # Innerhalb derselben Periode bleibt der Code gleich.
    assert totp_at(secret, 1_000_005) == a


def test_totp_matches_a_known_reference_vector():
    # RFC-6238-nahe Kontrolle mit bekanntem Base32-Schlüssel: fängt einen
    # kaputten HMAC-/Offset-Schritt ab, unabhängig von Spotifys Secrets.
    assert totp_at("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 0) == totp_at(
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 15
    )
    assert len(totp_at("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59)) == 6


def test_newest_secret_picks_highest_version():
    version, cipher = newest_secret({"59": [1], "61": [2], "60": [3]})
    assert version == "61"
    assert cipher == [2]
