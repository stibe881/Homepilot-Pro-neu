"""Ring: der Weg, auf dem ein Klingeln hereinkommt.

Die übrigen Ring-Prüfungen stehen in test_new_integrations.py; hier
steht, was den Unterschied zwischen «sofort» und «zehn Sekunden später»
ausmacht - und warum man ihn von aussen bisher nicht sah.
"""

def test_ein_kanal_ueber_den_nichts_kommt_ist_keiner():
    """Der unangenehmste Fall: Alles sieht gut aus, und es klingelt zu spät.

    Die Anmeldung ging durch, der Push-Client sagt «läuft» - und trotzdem
    kommt jedes Klingeln erst über die Abfrage, also zehn Sekunden
    später. Bisher stand daneben «Klingeln kommt sofort an», und man
    suchte den Fehler überall ausser dort.
    """
    from homepilot.integrations.ring import health_detail, kanal_taub

    # Eine einzelne Meldung über die Abfrage ist normal - der Push kann
    # in dem Moment gerade unterwegs sein.
    assert kanal_taub(["push", "abfrage"]) is False
    assert kanal_taub(["abfrage"]) is False
    assert kanal_taub([]) is False
    # Zwei von vier: Der Kanal trägt nicht mehr.
    assert kanal_taub(["push", "abfrage", "abfrage"]) is True
    assert kanal_taub(["abfrage", "abfrage", "abfrage", "abfrage"]) is True
    # Und er erholt sich wieder.
    assert kanal_taub(["abfrage", "abfrage", "push", "push", "push", "push"]) is False

    text = health_detail(True, None, quellen=["abfrage", "abfrage"])
    assert "taub" in text
    assert "Abfrage" in text
    assert health_detail(True, None, quellen=["push", "push"]) == (
        "Ereigniskanal verbunden – Klingeln kommt sofort an"
    )


def test_nach_dem_neuladen_sagt_der_hub_nicht_kaputt():
    """Der Knopf lädt die Integration neu, der Kanal braucht Sekunden.

    «Nicht verbunden» wäre in diesem Moment wahr und trotzdem
    irreführend: Es sieht aus, als hätte das Neuladen ihn zerstört.
    """
    from homepilot.integrations.ring import health_detail

    text = health_detail(False, "Verbindung abgerissen", anlauf=True)
    assert "startet gerade" in text
    assert "nicht verbunden" not in text
