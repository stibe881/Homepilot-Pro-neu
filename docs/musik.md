# Musik im Haus

Was der Hub mit Lautsprechern kann – und wo es steht.

## Die Kachel

Jeder Lautsprecher und jeder Fernseher ist eine Kachel mit Play, Pause,
Weiter, Zurück und einem Lautstärkeregler. Dazu, wo das Gerät es
hergibt:

- **Fortschritt und Restzeit.** Der Balken läuft in der App weiter,
  denn der Hub meldet sich nur bei Änderungen. Er ist griffig, wo sich
  springen lässt, und schmal, wo nicht.
- **Zufall und Wiederholung.** Bei Spotify und bei Cast, mit denselben
  Wörtern: aus, alles, ein Titel.
- **Was als Nächstes kommt** – eine Zeile auf der Karte, die ganze
  Liste beim Antippen.
- **Gruppe.** Eine Kachel, die in Wahrheit mehrere Boxen ist, sagt das.
  Dahinter steht die Lautstärke jeder einzelnen Box: Google stellt in
  einer Gruppe alle gleich laut, im Kinderzimmer darf es leiser sein.
- **Schlummer-Timer.** 15 bis 90 Minuten. Die letzten dreissig Sekunden
  blendet der Hub aus – Musik, die mitten im Takt abbricht, weckt eher,
  als dass sie einschlafen lässt.
- **Woanders weiterhören.** Umziehen kann nicht die Box, sondern der
  Player, der auf sie spielt (Spotify, Radio). Den sucht der Hub. Bei
  einer Box, auf die jemand direkt vom Handy castet, geht es nicht – und
  dann steht das da, statt dass nichts passiert.

## Die Karte «Musik im Haus»

Unter **Lautsprecher**. Sie beantwortet, was eine einzelne Kachel nicht
kann:

- Läuft irgendwo noch etwas? («Es läuft nichts» ist eine Antwort.)
- **Zuletzt gehört** – die letzten zwanzig Titel.
- **Favoriten.** Gemerkt wird die Quelle, nicht der Titel: der Sender
  oder die Playlist. Antippen spielt, lange drücken entfernt.
- **Nachtruhe.** Ein Lautstärke-Deckel zwischen zwei Uhrzeiten. Aus, bis
  du ihn einschaltest. Er greift überall – App, Ablauf, Szene – und nur
  dort, wo eine Zahl mitkommt: «Lauter» bleibt «lauter».
- **Beim Klingeln leiser.** An. Die Musik geht auf ein Viertel zurück,
  nie unter 5 %, und steht danach wieder, wo sie war.
- **Musikwecker.** Weckt mit einem Sender statt mit Piepsen und blendet
  ein.

## Was der Hub selbst tut

- Nach einer **Durchsage** stellt er die Lautstärke zurück und nimmt die
  Musik wieder auf. Vorher blieb die Box auf der Lautstärke der Ansage
  stehen.
- Beim **Klingeln** dämpft er (siehe oben) – ausgelöst an derselben
  Stelle, an der auch die Push entsteht, also nach der Sperrfrist.
  Zweimal klingeln heisst nicht zweimal leiser.

## In einem Ablauf

Der Schritt heisst **Musik** und kann fünf Dinge:

| `do` | Was passiert | Braucht |
| --- | --- | --- |
| `pause_all` | Pause auf jeder Box, auf der etwas läuft | – |
| `favorite` | Einen Favoriten abspielen | `favorite` (Name), optional `device` |
| `sleep` | Schlummer-Timer stellen | `entity_id`, `minutes` |
| `fade` | Leise starten und hochziehen | `entity_id`, `volume` |
| `night` | Nachtruhe ein- oder ausschalten | `on` |

```yaml
- alias: Alle weg – Ruhe im Haus
  trigger: {platform: state, entity_id: person.alle, to: away}
  action:
    - {type: music, do: pause_all}
```

Ein Favorit, den es nicht mehr gibt, hält den Ablauf nicht an – er
hinterlässt eine Zeile im Protokoll. Ein umbenannter Sender soll nicht
dazu führen, dass danach das Licht nicht mehr ausgeht.

## Wo es im Code steht

| Was | Wo |
| --- | --- |
| Einblenden, dämpfen, deckeln, umziehen | `hub/homepilot/core/ton.py` |
| Favoriten, Verlauf, Schlummer, Wecker | `hub/homepilot/core/musik.py` |
| Die Routen dazu | `hub/homepilot/api/routes/medien.py` |
| Fortschritt rechnen | `app/src/lib/fortschritt.ts` |
| Was läuft im Haus | `app/src/lib/hausmusik.ts` |
| Die Karte | `app/src/components/Musikzentrale.tsx` |
| Die Kachel-Zugaben | `app/src/components/entity/medienextras.tsx` |
| Der Musik-Schritt im Ablauf | `hub/homepilot/core/automation.py` (`_musik`) + `app/src/screens/automations/` |
