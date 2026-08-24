# Pelletgrill (Pit Boss / Louisiana Grills)

Der Grill erscheint in der App wie jedes andere Gerät – mit Temperatur im
Garraum, den Fleischfühlern und den Störungen, auf die es beim Grillen
ankommt. Zuordnen lässt er sich zum Raum «Grill» oder «Terrasse».

Grundlage ist die Bibliothek [`pytboss`](https://github.com/dknowles2/pytboss).
Sie hat keine Verbindung zum Hersteller.

## Einrichten, ohne zu raten

Zwei Dinge muss man wissen, und beide stehen nicht im Netz: das Modell der
Steuerplatine und ob der Grill lokal antwortet. Der Helfer beantwortet
beides, bevor etwas in die `config.yaml` wandert.

```bash
docker exec homepilot-hub python -m homepilot.integrations.pitboss --modelle PBV
docker exec homepilot-hub python -m homepilot.integrations.pitboss --suchen 10.10.1
docker exec homepilot-hub python -m homepilot.integrations.pitboss \
    --model PBV4PS2 --host 10.10.1.60
```

`--suchen` geht das eigene Netz durch und fragt jede Adresse nach ihrer
Firmware. Die Steuerplatine läuft unter Mongoose OS und antwortet darauf –
so findet man die Adresse, ohne sie im Router zu suchen. Shelly-Geräte
antworten übrigens ebenfalls; deshalb steht der Firmware-Name dabei.

Der zweite Aufruf verbindet sich einmal, holt den Zustand und zeigt ihn an:

```
✓ Verbunden.
  Zustand:     läuft
  Garraum:     110 °C  (Ziel 120 °C)
  Fühler:      1: 63 °C
  Störungen:   keine
```

Darunter steht der fertige Abschnitt zum Kopieren. Stehen dort plausible
Temperaturen, stimmt das Modell; kommt keine Antwort, ist der lokale Weg
für dieses Gerät zu, und man versucht es mit `--grill-id` aus der
Pit-Boss-App. `--name`, `--password` und `--allow-remote-start` gehen
ebenfalls mit und landen im Vorschlag.

Der Helfer schreibt nichts – er schlägt nur vor. Eingetragen wird von
Hand (oder in der App unter *System → Konfiguration*), danach Hub neu
starten.

## Zwei Wege zum Grill

**Lokal (bevorzugt).** Der Grill spricht dieselbe Schnittstelle auch
direkt im Netz. Dann bleibt der Hersteller aussen vor, und der Grill
funktioniert weiter, wenn deren Dienst mal steht.

```yaml
  - integration: pitboss
    scan_interval: 30
    grills:
      - name: Grill
        model: PBV4PS2
        host: 10.10.1.60
```

**Nicht jedes Gerät antwortet lokal.** Die ältere Steuerplatinen-Reihe hat
gar keinen HTTP-Server, und bei den übrigen muss er eingeschaltet sein –
das ist eine Einstellung je Gerät, die sich weder am Modell noch an der
Firmware-Version ablesen lässt. Antwortet der Grill nicht, steht in der
System-Ansicht «pitboss» als fehlgeschlagen; dann ist der Cloud-Weg dran.

**Über die Hersteller-Cloud.** Die Kennung steht in der Pit-Boss-App.

```yaml
  - integration: pitboss
    grills:
      - name: Grill
        model: PBV4PS2
        grill_id: "..."
```

Über die Cloud meldet der Grill Änderungen von selbst; lokal fragt der Hub
alle `scan_interval` Sekunden nach. Beides reicht beim Grillen locker.

**Bluetooth gibt es hier nicht.** Die Bibliothek könnte es, aber der Hub
läuft im Schrank und nicht auf der Terrasse. Für Bluetooth müsste er in
Reichweite stehen.

## Zwei Grills, ein Eintrag

Räucherschrank und Smoker stehen nebeneinander, und beide sollen in die
App. Zwei getrennte `- integration: pitboss`-Einträge sähen richtig aus,
wären es aber nicht: Der Hub führt Integrationen unter ihrem Namen, der
zweite Eintrag verdrängt den ersten – und dann ginge «Smoker aus» an den
Räucherschrank. Deshalb kennt **ein** Eintrag beliebig viele Geräte:

```yaml
  - integration: pitboss
    scan_interval: 30
    grills:
      - name: Räucherschrank
        model: PBV4PS2
        host: 10.10.1.60
      - name: Smoker
        model: PB1150PS2
        host: 10.10.1.61
```

Jeder Grill wird eine eigene Kachel, jeder darf seinen eigenen Weg gehen
(einer lokal, einer über die Cloud), und `allow_remote_start` lässt sich
je Gerät oder für alle setzen. Die Namen müssen sich unterscheiden – aus
ihnen entsteht die Kennung, unter der der Grill in Szenen und Abläufen
steht.

Für einen einzigen Grill genügt weiterhin die kurze Form ohne `grills:`.

## Das Modell muss stehen

`model` ist Pflicht (z.B. `PBV4PS2`, `PB1600PS1`, `LG0800BL`). Die
Steuerplatine lässt sich nicht selbst erkennen, und erst sie sagt, welche
Befehle das Gerät versteht. Die Kennung steht auf dem Typenschild und in
der App. Stimmt sie nicht, meldet der Hub das beim Start.

## Anzünden aus der Ferne ist absichtlich aus

`turn_on` entfacht ein Feuer in einem Gerät, neben dem gerade niemand
stehen muss. Die Steuerplatine nimmt den Befehl in **jedem** Zustand an –
auch mit offenem Deckel, auch ohne Pellets im Behälter, auch wenn das
Gerät unter dem Vordach steht. Diese Entscheidung gehört nicht in eine
Automation, die jemand vor drei Monaten gebaut hat.

Deshalb gibt es das Kommando nur mit:

```yaml
        allow_remote_start: true
```

Ohne diese Zeile hat die Entität den Befehl gar nicht – was es nicht gibt,
kann auch kein Ablauf und keine Szene auslösen. Ist er freigegeben, fragt
die App zusätzlich einmal nach («Wirklich?»), und jeder Fernstart landet
im Protokoll.

**Ausschalten geht immer.** Das ist die sichere Richtung, und dafür soll
niemand erst eine Einstellung suchen müssen.

## Was in der App steht

- **Temperatur** im Garraum, gross
- **Ziel** mit Schritten nach oben und unten. Der Grill nimmt nur
  bestimmte Sollwerte an und rundet selbst auf den nächsten – grobe
  Schritte genügen also.
- **Fleischfühler**, aber nur die eingesteckten. Ein Fühler, der nicht
  drinsteckt, wäre eine Zeile, die dauerhaft «–» zeigt.
- **Störungen** ganz oben und in Warnfarbe: Pellets leer, Übertemperatur,
  Gebläse, Zündung, Förderschnecke, Fühler. Bewusst benannt und nicht nur
  gezählt – Pellets nachfüllen und ein defektes Gebläse führen zu ganz
  verschiedenen Schritten.
- **Licht**, falls das Modell eines hat.

## Ein Ablauf, der sich lohnt

Der Fühler meldet die Kerntemperatur. Ein Ablauf darauf spart das
Nachschauen:

```yaml
  - id: braten_fertig
    alias: Braten fertig
    trigger:
      - type: state
        entity_id: pitboss.grill
        attribute: probes
        # Fühler 1 – die Schwelle je nach Fleisch.
    action:
      - type: notify
        to: all
        title: Braten fertig
        body: Kerntemperatur erreicht.
```

Ebenso nützlich: eine Meldung auf `problem`, damit «Pellets leer» ankommt,
bevor das Fleisch kalt wird.
