import type { Entity } from '../api/types';
import { zustandName } from './hausmusik';

/**
 * Was der Raumkopf über die Musik dieses Zimmers sagt.
 *
 * Die Box des Raums lag bisher rechts in der Spalte - auf dem Tablet
 * unter dem Raumkopf, auf dem Telefon ganz unten unter allen Kacheln.
 * Beides heisst: Wer im Zimmer die Musik leiser stellen will, sucht
 * zuerst. Im Kopf des Zimmers steht sie dort, wo man hinsieht, wenn man
 * das Zimmer öffnet - neben den Szenen, und im leeren Feld rechts
 * daneben, das vorher nichts trug.
 *
 * Reines Rechnen: hinein die Box, heraus zwei Zeilen. Genau zwei, denn
 * mehr trägt ein Streifen neben den Szenenknöpfen nicht.
 */

export interface Kopfmusik {
  /** Erste Zeile: der Titel - und wenn keiner bekannt ist, die Box. */
  titel: string;
  /** Zweite Zeile: Künstler und Box, sonst der Zustand in einem Wort. */
  unter: string;
  /** Läuft gerade etwas? Danach richtet sich der grosse Knopf. */
  laeuft: boolean;
  /** Antwortet die Box überhaupt? */
  da: boolean;
}

/**
 * Die zwei Zeilen des Streifens (rein, testbar).
 *
 * Der Name der Box steht in der zweiten Zeile mit dabei, sobald ein
 * Titel läuft: In einem Zimmer mit zwei Boxen ist «Küche hinten» die
 * Auskunft, die den Streifen erst eindeutig macht - und sie kostet
 * nichts, weil die Zeile sonst nur den Künstler trägt.
 */
export function kopfmusik(entity: Entity): Kopfmusik {
  const da = entity.available !== false;
  const zustand = String(entity.state?.state ?? '');
  const laeuft = zustand === 'playing' || zustand === 'buffering';
  if (!da) {
    // Nicht «Nichts an»: Eine Box, die schweigt, und eine, die nicht
    // antwortet, sind zwei verschiedene Lagen - und nur die zweite ist
    // ein Grund, nachzusehen.
    return { titel: entity.name, unter: 'Nicht erreichbar', laeuft: false, da: false };
  }
  const titel = String(entity.state?.track ?? '').trim();
  const kuenstler = String(entity.state?.artist ?? '').trim();
  if (titel) {
    return {
      titel,
      unter: [kuenstler, entity.name].filter(Boolean).join(' · '),
      laeuft,
      da: true,
    };
  }
  // Ohne Titel trägt die erste Zeile den Namen der Box: «Spielt» allein
  // sagt nicht, welche - und eine leere erste Zeile sähe nach einem
  // Fehler aus.
  return { titel: entity.name, unter: zustandName(zustand), laeuft, da: true };
}

/**
 * Wie der Streifen für die Vorlesefunktion heisst (rein, testbar).
 *
 * Zwei Zeilen untereinander liest VoiceOver als zwei Fundstücke vor;
 * ein Satz ist die Auskunft, die man erwartet.
 */
export function kopfmusikLabel(entity: Entity): string {
  const musik = kopfmusik(entity);
  return `Musik: ${musik.titel} – ${musik.unter}`;
}
