import type { Ionicons } from '@expo/vector-icons';

/**
 * Die Einführung beim ersten Öffnen: wer sie sieht, und in welcher
 * Fassung.
 *
 * Hier liegt nur die Entscheidung, nicht die Anzeige - das Blatt selbst
 * steht in components/Einfuehrung.tsx. Der Mechanismus ist derselbe wie
 * bei «Was ist neu» (lib/wiederkehr.ts): Das Gesehen-Sein gehört zur
 * Person und liegt in den Hub-Prefs, nicht im Speicher des Geräts -
 * einmal gesehen heisst überall gesehen, und die Neuinstallation fängt
 * nicht wieder von vorne an.
 *
 * Gespeichert wird eine Nummer, kein Ja/Nein: Wer die Schritte einmal
 * grundlegend überarbeitet, zählt EINFUEHRUNG_STAND hoch, und alle sehen
 * die neue Fassung genau einmal - ohne dass jemand von Hand Schlüssel
 * löschen muss.
 */

/** Welche Fassung der Einführung schon weggeklickt wurde. Nur
 *  hochzählen, wenn sich die Schritte so ändern, dass auch alte Hasen
 *  sie noch einmal sehen sollen - nicht bei jedem Wortdreher. */
export const EINFUEHRUNG_STAND = 1;

/** Ein Schritt des Blatts: Symbol, Überschrift, zwei, drei Sätze. */
export interface EinfuehrungSchritt {
  icon: keyof typeof Ionicons.glyphMap;
  titel: string;
  text: string;
}

/** Was die Entscheidung vom angemeldeten Benutzer wissen muss. */
export interface EinfuehrungBenutzer {
  role?: string;
  features?: string[];
}

export type EinfuehrungsFassung = 'haushalt' | 'gast';

/**
 * Welche Fassung diese Person bekommt (rein, testbar).
 *
 * Gäste und Babysitter (die App legt Babysitter als Gäste an, siehe
 * screens/family/babysitter.ts) bekommen die kurze «So funktioniert das
 * hier»-Fassung: nur was sie dürfen, in wenigen Sätzen. Eine Tour durch
 * Bereiche, die sie gar nicht sehen, wäre eine Führung durch
 * verschlossene Türen.
 */
export function fassungFuer(
  user: EinfuehrungBenutzer | null | undefined
): EinfuehrungsFassung {
  return user?.role === 'gast' ? 'gast' : 'haushalt';
}

/**
 * Darf das Blatt jetzt stehen? (rein, testbar)
 *
 * `geladen` aus demselben Grund wie bei «Was ist neu»
 * (lib/wiederkehr.ts): Solange die persönlichen Einstellungen noch nicht
 * da sind, ist «nicht gesehen» keine Aussage - das Blatt blitzte sonst
 * beim Kaltstart auf und verschwände, sobald sie eintreffen. Lieber eine
 * Sekunde später zeigen als kurz etwas zeigen, das gleich wieder weg ist.
 */
export function zeigtEinfuehrung(daten: {
  /** Sind die persönlichen Einstellungen (mit dem Gesehen-Stand) da? */
  geladen: boolean;
  /** Welche Fassung schon weggeklickt wurde - undefined heisst: nie. */
  gesehen: number | undefined;
  /** Für diesen Besuch weggetippt, ohne «fertig» zu sagen. */
  zurueckgestellt: boolean;
}): boolean {
  return (
    daten.geladen &&
    !daten.zurueckgestellt &&
    (daten.gesehen ?? 0) < EINFUEHRUNG_STAND
  );
}

/** Wie ein freigegebener Bereich im Satz heisst - dieselben Schlüssel,
 *  mit denen der Hub Gast-Freigaben führt (User.features). */
const FEATURE_WORT: Record<string, string> = {
  raeume: 'die Räume',
  licht: 'das Licht',
  storen: 'die Storen',
  familie: 'die Familienseite',
  kameras: 'die Kameras',
};

/** «das Licht, die Storen und die Kameras» (rein, testbar). */
export function aufzaehlung(woerter: string[]): string {
  if (woerter.length === 0) return '';
  if (woerter.length === 1) return woerter[0];
  return `${woerter.slice(0, -1).join(', ')} und ${woerter[woerter.length - 1]}`;
}

/**
 * Der eine Satz für Gäste: was diese Person hier darf (rein, testbar).
 *
 * Unbekannte Feature-Schlüssel fallen still weg - ein neuer Bereich im
 * Hub soll die Einführung nicht mit seinem internen Namen füllen.
 */
export function gastSatz(features: string[] | undefined): string {
  const woerter = (features ?? [])
    .map((feature) => FEATURE_WORT[feature])
    .filter((wort): wort is string => !!wort);
  if (woerter.length === 0) {
    return 'Du siehst die Bereiche, die für dich freigegeben sind.';
  }
  return `Für dich freigegeben: ${aufzaehlung(woerter)}.`;
}

/**
 * Die Schritte des Blatts für diese Person (rein, testbar).
 *
 * Bewusst ein blätterbares Blatt mit kurzen Texten und KEIN Overlay, das
 * mit Pfeilen auf echte Bedienelemente zeigt: Die Leiste liegt auf dem
 * Telefon unten, auf dem iPad links, im Browser mal so, mal so - ein
 * Pfeil, der auf allen dreien auf die richtige Stelle träfe, müsste jedes
 * Layout kennen und bräche beim nächsten Umbau still. Ein Blatt, das
 * erklärt statt zu zeigen, überlebt jeden Umbau.
 */
export function schritteFuer(
  user: EinfuehrungBenutzer | null | undefined
): EinfuehrungSchritt[] {
  if (fassungFuer(user) === 'gast') {
    return [
      {
        icon: 'hand-left-outline',
        titel: 'So funktioniert das hier',
        text:
          `${gastSatz(user?.features)} Antippen schaltet, ` +
          'nochmals antippen schaltet zurück. Mehr braucht es nicht - ' +
          'alles andere bleibt, wie es ist.',
      },
    ];
  }
  return [
    {
      icon: 'compass-outline',
      titel: 'Die Bereiche',
      text:
        'In der Leiste (unten auf dem Telefon, links auf dem iPad) ' +
        'liegen die Bereiche: Start, Räume, Licht, Storen, Familie. ' +
        'Auf Start steht, was gerade läuft - von dort erreichst du alles.',
    },
    {
      icon: 'power-outline',
      titel: '«Alles aus»',
      text:
        'Der Knopf auf der Startseite schaltet ab, was gerade an ist - ' +
        'aber erst nach einer Liste zum Abwählen: Laufende Haushaltgeräte ' +
        'bleiben von selbst verschont.',
    },
    {
      icon: 'search-outline',
      titel: 'Suchen statt scrollen',
      text:
        'Unter Einstellungen → Suche findest du jedes Gerät, jeden Raum, ' +
        'jede Szene und jeden Ablauf mit drei getippten Buchstaben.',
    },
    {
      icon: 'settings-outline',
      titel: 'Einstellungen und Hilfe',
      text:
        'Hinter dem Zahnrad in der Leiste liegt alles Übrige - auch die ' +
        'Hilfe mit den häufigsten Fragen, und diese Einführung, falls du ' +
        'sie noch einmal sehen willst.',
    },
  ];
}
