# PlayStation 5 anbinden

Punkt 643 der Werkbank. Die Konsole steht im Hub wie der Android TV:
eine Kachel mit Zustand und laufendem Spiel, die Fernbedienung in der
App, die Karte auf dem Sperrbildschirm, solange sie läuft. Gekoppelt
wird einmal, in der App unter Einstellungen → Verbindungen.

Code: `hub/homepilot/integrations/playstation.py` (Hub),
`hub/homepilot/api/routes/playstation.py` (Routen), die Karte in
`core/livekarten.py` (`karten_tv`).

## Was ohne Zusatzpaket geht - und was nicht

Die Konsole spricht zwei Sprachen. Die eine ist das Discovery-Protokoll
(DDP): ein UDP-Paket hin, eines zurück, lokal, ohne Anmeldung. Darüber
weiss der Hub, ob sie läuft oder ruht und welches Spiel offen ist - und
darüber weckt er sie. Das ist eigener Code und braucht keine Bibliothek.

Die andere ist Remote Play: verschlüsselt, an ein PSN-Konto gebunden.
Nur darüber lässt sich die Konsole in den Ruhemodus schicken oder eine
Taste drücken. Dafür braucht der Hub `pyremoteplay`:

```bash
pip install "homepilot[playstation]"
```

Im Abbild ist es dabei (`hub/Dockerfile`). Fehlt es, bleiben Zustand
und Wecken; Ruhemodus und Tasten antworten mit dem Satz oben, und die
Systemseite nennt das Extra unter «Was fehlt».

## Einrichtung, Schritt für Schritt

**1. Die Konsole eintragen** - in der `config.yaml`:

```yaml
  - integration: playstation
    devices:
      - host: 192.168.1.60
        name: PlayStation 5
```

Der Konsole in der Fritzbox (oder wo auch immer) eine feste Adresse
geben; der Hub spricht sie über die IP an. Nach dem Hub-Start steht die
Kachel da - «nicht erreichbar», falls die Konsole ganz aus ist (nicht
Ruhemodus), sonst mit Zustand.

**2. Die PSN-Anmeldung** - in der App unter Einstellungen → Verbindungen,
Abschnitt «PlayStation», «Mit PSN anmelden». Es öffnet sich die
Anmeldeseite von Sony. Nach dem Anmelden landet man auf einer Seite,
die nur «redirect» zeigt und deren Adresse mit
`https://remoteplay.dl.playstation.net/remoteplay/redirect` beginnt.
**Diese Adresse** kopieren und in der App einfügen. Der Hub holt sich
daraus die Kontokennung und legt sie in `playstation-token.json` neben
die Datendatei - kein Passwort, kein Token, nur die Kennungen.

Der häufigste Fehler: Man kopiert die Anmeldeseite statt der Seite
danach. Die App sagt es dann so.

Ab hier kann der Hub die Konsole aus dem Ruhemodus wecken.

**3. Der Code von der Konsole** - die Konsole muss dabei an sein. Auf
der PS5: Einstellungen → System → Remote Play → «Gerät verbinden». Dort
steht ein achtstelliger Code; in der App eintippen (Leerzeichen sind
egal). Der Hub registriert sich damit als Remote-Play-Gerät; die
Registrierung liegt in `playstation-profile.json` neben der Datendatei.

Ab hier gehen Ruhemodus und Tasten. Die Kachel zeigt «gekoppelt».

Beide Dateien stehen in der `.gitignore` und gehören ins Backup, nie ins
Repository. «Neu koppeln» in der App legt sie als `.alt` beiseite und
beginnt von vorn - nötig, wenn die Konsole zurückgesetzt wurde oder ein
anderes Konto her soll.

## Was die Kachel kann

- Ein/Aus: Einschalten weckt aus dem Ruhemodus (DDP), Ausschalten
  schickt in den Ruhemodus (Remote Play). Eine ruhende Konsole
  auszuschalten gilt als erledigt, damit «niemand mehr zuhause» nicht an
  ihr hängen bleibt.
- Tasten: Steuerkreuz, Kreuz, Kreis, Dreieck, Quadrat, Options, Share,
  PS. Die bestehende Fernbedienung der App funktioniert ohne Änderung:
  `ok` ist Kreuz, `back` Kreis, `home` die PS-Taste.
- Zustand: `state` on/off, `standby`, `app` (Spielname), `title_id`,
  `konsole` (PS5/PS4), `paired`, `remote_play`.

## Bekannte Grenzen

- **Kein App-Start.** Das Protokoll kann nichts starten, nur sehen, was
  läuft. `apps` bleibt leer, `launch_app` gibt es nicht.
- **Die Sitzung ist sichtbar.** Für Tasten und Ruhemodus baut der Hub
  eine Remote-Play-Sitzung auf (ohne Video) und trennt sie nach einer
  halben Minute ohne weitere Taste. Solange sie steht, zeigt die Konsole
  «Remote Play verbunden» - und wer gerade am Controller spielt, sieht
  das im Bildschirm-Eck. Deshalb keine Dauer-Sitzung.
- **Ganz aus ist ganz aus.** Nur der Ruhemodus antwortet auf DDP und
  lässt sich wecken. Wer die Konsole ausschaltet statt in den Ruhemodus
  zu schicken, sieht «nicht erreichbar».
- **Eine Remote-Play-Sitzung auf einmal.** Spielt jemand über die
  Remote-Play-App am Telefon, kommt die Sitzung des Hubs nicht zustande;
  die Absage sagt es.
- **Quellport 9303.** Die PS5 antwortet nur auf Anfragen von diesem
  Port. Läuft auf dem Hub-Rechner ein zweites Programm, das ihn belegt
  (etwa ein zweiter Hub), schweigt die PS5; eine PS4 antwortet weiterhin.

## Wenn es nicht geht

```bash
docker exec homepilot-hub python -m homepilot.integrations.playstation 192.168.1.60
```

zeigt roh, was die Konsole auf eine Statusanfrage antwortet - oder dass
sie schweigt. Antwortet sie, steht in der ersten Zeile `200 Ok` (läuft)
oder `620 Server Standby` (ruht); `running-app-name` ist das Spiel.

Auf der Sperrbildschirm-Karte trägt die Konsole einen Controller statt
des Fernsehers und «Spielt: …» statt des nackten Namens. Sie ist dort
ein eigenes Gerät: Steht im selben Zimmer ein Android TV, gibt es zwei
Karten mit zwei Fernbedienungen - und die Zusammenlegung von Cast und
Android TV bleibt, wie sie war (`core/livekarten.py`, `eigenstaendig`).
