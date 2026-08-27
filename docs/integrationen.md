# Alle Integrationen auf einen Blick

Dreissig Stück. Welche es gibt, was sie tun, was sie brauchen – und wo
das Genauere steht.

**Wo die eigentliche Anleitung steht:** oben in der jeweiligen Datei
unter `hub/homepilot/integrations/`. Dort ist sie ausführlich, mit
Konfigurationsbeispiel und den Fallen, die es je Gerät gibt. Diese Seite
duplizert das nicht – sie zeigt darauf. Doppelte Anleitungen laufen
auseinander, und dann glaubt man der falschen.

Ein Beispiel für jede steht ausserdem in
[`config.example.yaml`](../hub/config.example.yaml).

## Im eigenen Netz

Diese brauchen kein Internet. Fällt die Leitung aus, funktionieren sie
weiter – das ist der Grund, warum Licht, Storen und Schlösser hier stehen.

| Integration | Was | Braucht |
| --- | --- | --- |
| **homematic** | Homematic und Homematic IP über die CCU | IP der CCU, Kanaladressen |
| **hue** | Philips Hue Bridge (CLIP v2) | IP, App-Key |
| **hue_sync** | Hue Play HDMI Sync Box | IP, Token (Knopf 3 s halten) |
| **matter** | Matter-Geräte über den Controller-Dienst | Matter-Fabrik in `hub/matter/` |
| **mqtt** | Sonoff und andere Tasmota-Geräte | Broker, Benutzer/Passwort |
| **zigbee2mqtt** | Zigbee-Geräte über den eigenen Stick – Aqara, IKEA, Tuya-Zigbee | Broker, Benutzer/Passwort |
| **bletags** | Bluetooth-Anhänger am Schlüssel oder im Rucksack – in welchem Zimmer? | Broker, ESP32 mit ESPresense ([Anleitung](bluetooth-anhaenger.md)) |
| **overkiz** | Somfy TaHoma – Storen, Rollläden, Markisen | Gateway, Zugangsdaten |

Zeigt eine Store einen Zustand, der nicht stimmt, sagt dieser Aufruf, was
das Gateway wirklich meldet – roh, samt der Rechnung, die der Hub daraus
macht:

```bash
docker exec homepilot-hub python -m homepilot.integrations.overkiz \
    -c /config/config.yaml --geraete
```

Der Fall, für den es gebaut wurde: Eine **Markise** fährt aus statt zu.
Overkiz meldet dafür `core:DeploymentState` (0 eingefahren … 100
draussen) statt `core:ClosureState`. Über die Closure-Rechnung gelesen
stand eine ausgefahrene Markise als «Geschlossen» da.
| **nuki** | Smart Lock: auf, zu, aufziehen | Bridge-Token |
| **tuya** | Lampen, Steckdosen, Projektoren – lokal | Geräte-ID und lokaler Schlüssel |
| **twinkly** | Lichterketten | IP |
| **vzug** | Geschirrspüler, Waschmaschine (Home-API) | IP je Gerät |
| **google_cast** | Chromecasts und Cast-Boxen, Durchsagen | nur mDNS |
| **androidtv** | Fernseher über das Google-TV-Remote-Protokoll | IP, Kopplung |
| **unifi** | Welche Geräte im WLAN sind (keine Anwesenheit – die kommt vom Geofence) | Controller, Zugangsdaten |
| **unifi_protect** | Kameras | Controller, Zugangsdaten |
| **pitboss** | Pelletgrill (auch mehrere) | IP oder Cloud-Kennung, Modell |

## Über eine Cloud

Diese brauchen Internet. Fällt es aus, fällt genau das aus – und sonst
nichts.

| Integration | Was | Braucht |
| --- | --- | --- |
| **ring** | Türklingeln und Kameras | Konto, `ring-token.json` |
| **roborock** | Staubsauger | Konto |
| **spotify** | Was läuft, Wiedergabesteuerung | Konto, App-Registrierung |
| **spotify_webplayer** | Token, um Cast-Boxen zu wecken | wie Spotify |
| **google_calendar** | Nächste Termine | OAuth, `google-token.json` |
| **weather** | Wetterlage und Vorhersage (Open-Meteo) | nur Standort |
| **meteoalarm** | Unwetterwarnungen (offizieller CAP-Feed) | nur Region |
| **life360** | Standort für Telefone **ohne** HomePilot | Life360-Konto, Zuordnung Name → Zone |

## Ohne Gerät – sie rechnen

Diese binden nichts an, sondern machen aus vorhandenen Geräten etwas
Neues. Wer eine davon sucht, sucht sie meist unter dem falschen Namen.

| Integration | Was | Warum keine Automation |
| --- | --- | --- |
| **group** | Mehrere Lampen als **eine** Leuchte | Fünf Spots sind ein Licht, nicht fünf – auch in Räumen, Suche und Zählung |
| **helpers** | Merker: An/Aus ohne Draht | Abläufe brauchen einen Zustand, den sie untereinander setzen |
| **adaptive** | Farbtemperatur folgt dem Sonnenstand | Läuft dauernd, nicht auf einen Auslöser hin |
| **shading** | Storen zu, wenn die Sonne aufs Fenster brennt | Braucht einen Zustand je Fenster und eine Handsperre – als Ablauf wären es drei je Fenster, die sich ins Gehege kommen |
| **alarm** | Die Alarmanlage selbst | Modi, Verzögerungen, Ausnahmen |
| **presence_sim** | Anwesenheitssimulation | Zufall über Stunden, nicht ein Ereignis |
| **geofence** | Ankommen und Weggehen, vom Telefon gemeldet | Nimmt Meldungen entgegen, statt zu fragen |
| **demo** | Virtuelle Wohnung zum Ausprobieren | – |

## Was sie sich merken

Vier Integrationen legen ihre Anmeldung als eigene Datei neben die
`homepilot-data.json`: **ring**, **google_calendar**, **overkiz** und
**roborock**. Diese Dateien gehören ins Backup und **nie** ins
Repository – sie stehen in der `.gitignore`.

Dasselbe gilt für `hub/matter/`: Dort liegen Schlüssel und Zertifikate
aller gekoppelten Matter-Geräte. Geht der Ordner verloren, muss jedes
Gerät neu gekoppelt werden.

## Wenn eine nicht startet

Unter *System* steht je Integration, ob sie läuft und woran es sonst
liegt. Die drei häufigsten Fälle:

| Meldung | Was zu tun ist |
| --- | --- |
| «hat sich in 90 Sekunden nicht gemeldet» | Gerät oder Cloud antwortet nicht. Der Hub versucht es alle paar Minuten erneut – nichts zu tun. |
| «Bibliothek fehlt» | `pip install -e ".[name]"` – die schweren Protokollbibliotheken sind freiwillig. |
| Pflichtfeld leer | Ein dauerhafter Fehler; der Hub versucht es nicht erneut. Die Meldung nennt das Feld. |

Eine kaputte Integration hält den Hub nie auf: Die übrigen laufen, und
der Wiederanlauf holt sie nach.

## Eine neue anbinden

[`hub/docs/neue-integration.md`](../hub/docs/neue-integration.md) – und
danach [`neue-kachel.md`](../hub/docs/neue-kachel.md), damit sie in der
App auch erscheint.
