# Nintendo Switch anbinden

Punkt 748 (Teil C). Die Switch steht im Hub als Kachel mit heutiger
Spielzeit und Höchstzeit; die Konsolenzeit (`docs/konsolenzeit.md`)
stellt darüber die Höchstzeit von heute.

Code: `hub/homepilot/integrations/nintendo.py`,
`api/routes/nintendo.py`. Bibliothek: `pynintendoparental` (Extra
`nintendo`, im Abbild dabei).

## Was das ist - und was nicht

Es ist Nintendos **Kindersicherung** über die Cloud, nicht die Konsole
selbst. Das heisst:

- Die Konsole muss **online** sein und sich abgleichen. Die Spielzeit
  kommt auf die Minute genau und mit Verzug. Der Zustand «an» der Kachel
  ist darum abgeleitet («die Spielzeit ist zuletzt gewachsen») und trägt
  `verzoegert: true`.
- Es gibt keinen Befehl «Konsole aus». Der Hub setzt die Höchstzeit
  (`set_limit`), und die Konsole beendet das Spiel selbst. Beim ersten
  Eingriff stellt er die Konsole von «Alarm» auf «Software
  unterbrechen» um - sonst läutete sie nur.
- Die Schnittstelle ist **inoffiziell** und kann sich ändern. Die
  Bibliothek kennt die Switch 2 (Gerätekennung `P01`); **ob die Steuerung
  dort greift, ist an einer echten Switch 2 nicht geprüft**, nur gegen
  Attrappen. Das Prüfwerkzeug unten zeigt, was Nintendo wirklich meldet.
- Was die Eltern vorher als Höchstzeit hatten, merkt sich der Hub
  (`limit_vorher` in der Token-Datei) und stellt es zurück, wenn er die
  Konsole loslässt. Hat jemand in Nintendos App **Zusatzzeit** gegeben,
  nimmt Nintendo keine neue Höchstzeit an - das meldet der Hub als Fehler.

## Einrichten

1. In der `config.yaml`:

   ```yaml
   integrations:
     - integration: nintendo
   ```

2. Anmelden mit dem Nintendo-Konto, das die Konsole in der
   «Nintendo Switch Altersbeschränkung»-App verwaltet. Am einfachsten:

   ```bash
   docker exec -it homepilot-hub python -m homepilot.integrations.nintendo /data/nintendo-token.json
   ```

   (Pfad: neben die Datendatei.) Das Programm gibt eine Adresse aus; dort
   anmelden, bei «Dieses Konto verwenden» die Schaltfläche rechts
   anklicken, «Linkadresse kopieren», und die Adresse einfügen. Danach
   zeigt es jede Konsole des Kontos mit heutiger Spielzeit, Höchstzeit,
   Zusatzzeit und letztem Abgleich - das ist auch die Prüfung, ob die
   Switch 2 überhaupt auftaucht.

   Dieselben zwei Schritte gibt es als Routen: `POST /api/nintendo/anmeldung`
   (liefert die Adresse) und `POST /api/nintendo/anmeldung/abschluss`
   (nimmt die kopierte Adresse). Eine Oberfläche dafür in der App fehlt
   noch.

3. Hub neu starten (oder den Abruf abwarten: gleich nach der Anmeldung
   holt er die Konsolen).

Der Schlüssel liegt in `nintendo-token.json` neben der Datendatei und ist
ein Generalschlüssel für das Nintendo-Konto der Eltern - er steht in der
`.gitignore` und gehört nie ins Repository.
