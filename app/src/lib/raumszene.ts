/**
 * «So wie jetzt» – den Zustand eines Zimmers als Szene festhalten.
 *
 * Den Schnappschuss gab es schon, aber nur im Szenen-Editor und nur für
 * das ganze Haus. Der Weg dorthin war der Grund, warum ihn kaum jemand
 * ging: Der Abend sitzt – Licht auf 30 %, Store halb, Twinkly an –, und
 * um daraus eine Szene zu machen, verlässt man das Zimmer, öffnet die
 * Abläufe, legt eine Szene an, nimmt den Zustand des *ganzen Hauses*
 * auf und wirft danach von Hand raus, was nicht ins Wohnzimmer gehört.
 * Bis dahin hat jemand die Küche umgeschaltet.
 *
 * Hier steht deshalb dasselbe Rechnen, aber auf einen Raum begrenzt und
 * gleich in der Form, die der Hub speichert. Reine Funktionen: Was in
 * eine Szene gehört und was daraus wird, ist entscheidbar – und genau
 * an dieser Stelle wohnten schon zwei Fehler (turn_on statt der
 * gedimmten 15 %, die verlorene Storen-Position).
 */
import { Entity } from '../api/types';
import { snapshotAction } from './szenen';
import { imSchnappschuss } from '../screens/automations/szenengeraete';

/** Eine Aktion in der Form, in der der Hub sie speichert. */
export interface SzenenAktion {
  entity_id: string;
  command: string;
  data?: Record<string, unknown>;
}

/**
 * Die Geräte dieses Raums, die in eine Szene gehören (rein, testbar).
 *
 * `imSchnappschuss` hält Alarmanlage, Kamera und Lichtszene heraus –
 * jede aus demselben Grund: Was sie ungefragt einbrächten, hat niemand
 * gewollt (eine Szene «Abend», die heimlich «unscharf» eingesammelt
 * hat, entschärft abends die Anlage).
 *
 * Dazu die Regel dieser Stelle: Nur Geräte, die sich überhaupt schalten
 * lassen. Ein Temperaturfühler hat einen Zustand, aber keinen, den man
 * herstellen kann – in der Szene stünde eine Zeile, die beim Auslösen
 * nichts tut.
 */
export function aufnehmbar(items: Entity[]): Entity[] {
  return items.filter(
    (entity) => imSchnappschuss(entity) && entity.commands.length > 0
  );
}

/**
 * Der Zustand dieser Geräte als gespeicherte Aktionen (rein, testbar).
 *
 * Die Umrechnung, die sonst im Szenen-Editor steht – aber nur der Teil,
 * den ein Schnappschuss überhaupt erzeugen kann: Helligkeit und Farbe.
 * Alles andere ist ein Befehl ohne Beilage.
 */
export function aufnahmeAktionen(items: Entity[]): SzenenAktion[] {
  return aufnehmbar(items).flatMap((entity) => {
    const roh = snapshotAction(entity);
    if (roh.command !== 'set_brightness') {
      return [{ entity_id: roh.entity_id, command: roh.command }];
    }
    return [
      {
        entity_id: roh.entity_id,
        command: 'set_brightness',
        data: { brightness: roh.brightness ?? 50 },
      },
      // Die Farbe ist eine eigene Aktion, kein Feld an der Helligkeit –
      // so speichert der Editor sie auch, und so kommt sie beim
      // Bearbeiten wieder an ihrem Eintrag an (lib/szenen.ts).
      ...(roh.color
        ? [
            {
              entity_id: roh.entity_id,
              command: 'set_color',
              data: { color: roh.color },
            },
          ]
        : []),
    ];
  });
}

/**
 * Was aufgenommen würde, in einem Satz (rein, testbar).
 *
 * Vor dem Speichern soll dastehen, was in die Szene kommt – ein Knopf,
 * der ungesehen zwölf Geräte einsammelt, ist einer, dem man nicht
 * traut. Drei Namen und dann eine Zahl: Die Liste soll nicht länger
 * werden als das, was darüber steht.
 */
export function aufnahmeSatz(items: Entity[]): string {
  const namen = aufnehmbar(items).map((entity) => entity.name);
  if (namen.length === 0) return 'Hier gibt es nichts aufzunehmen.';
  if (namen.length <= 3) return namen.join(', ');
  return `${namen.slice(0, 3).join(', ')} und ${namen.length - 3} weitere`;
}

/**
 * Ein Name, der schon halb stimmt (rein, testbar).
 *
 * Nur ein Vorschlag im Feld, kein gesetzter Name: Wer abends im
 * Wohnzimmer aufnimmt, meint meistens «Wohnzimmer abends» – und wer
 * etwas anderes meint, tippt darüber. Die Tageszeiten sind dieselben
 * wie in lib/tageszeit.ts, nur als Wort im Namen statt als Sortierung.
 */
export function namensvorschlag(room: string, jetzt: Date = new Date()): string {
  const stunde = jetzt.getHours();
  const zeit =
    stunde < 5 ? 'nachts' : stunde < 10 ? 'morgens' : stunde < 17 ? 'tagsüber' : 'abends';
  return `${room} ${zeit}`;
}
