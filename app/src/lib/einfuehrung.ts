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
// Von 1 auf 2, als die Seitenhilfe dazukam: Der letzte Schritt sagt
// jetzt etwas anderes - dass es auf jeder Seite ein Fragezeichen gibt -,
// und das soll auch sehen, wer die Einführung längst weggeklickt hat.
export const EINFUEHRUNG_STAND = 2;

/** Ein Schritt des Blatts: Symbol, Überschrift, zwei, drei Sätze -
 *  und auf Wunsch ein Schaubild, das zeigt statt zu beschreiben. */
export interface EinfuehrungSchritt {
  icon: keyof typeof Ionicons.glyphMap;
  titel: string;
  text: string;
  /** Was über dem Text steht: die antippbare Leiste, der
   *  «Alles aus»-Knopf oder das Suchfeld - gezeichnet in
   *  components/Einfuehrung.tsx. */
  schaubild?: 'leiste' | 'allesaus' | 'suche';
}

/**
 * Die Bereiche der Leiste, wie sie das Schaubild zeigt.
 *
 * Dieselben Symbole und Wörter wie in components/Rail.tsx (ITEMS) - wer
 * dort etwas umbenennt, benennt es hier mit um, sonst erklärt die
 * Einführung eine Leiste, die es nicht mehr gibt. Die Kameras fehlen
 * bewusst: Sie erscheinen nur in Häusern, die welche haben, und die
 * Einführung kennt die Geräte nicht.
 */
export const BEREICHE: {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { key: 'start', icon: 'home-outline', label: 'Start' },
  { key: 'home', icon: 'grid-outline', label: 'Räume' },
  { key: 'light', icon: 'bulb-outline', label: 'Licht' },
  { key: 'covers', icon: 'reorder-four-outline', label: 'Storen' },
  { key: 'family', icon: 'people-outline', label: 'Familie' },
  { key: 'settings', icon: 'settings-outline', label: 'Mehr' },
];

/** Was die Entscheidung vom angemeldeten Benutzer wissen muss. */
export interface EinfuehrungBenutzer {
  role?: string;
  features?: string[];
}

export type EinfuehrungsFassung = 'haushalt' | 'gast' | 'kind';

/**
 * Welche Fassung diese Person bekommt (rein, testbar).
 *
 * Gäste und Babysitter (die App legt Babysitter als Gäste an, siehe
 * screens/family/babysitter.ts) bekommen die kurze «So funktioniert das
 * hier»-Fassung: nur was sie dürfen, in wenigen Sätzen. Eine Tour durch
 * Bereiche, die sie gar nicht sehen, wäre eine Führung durch
 * verschlossene Türen. Kinder (Punkt 245 der Werkbank) ebenso: Sie sehen
 * die Kinder-Ansicht ihrer Zimmer, nicht die Leiste mit den Bereichen -
 * die Haushalts-Tour beschriebe eine App, die sie gar nicht vor sich
 * haben.
 */
export function fassungFuer(
  user: EinfuehrungBenutzer | null | undefined
): EinfuehrungsFassung {
  if (user?.role === 'gast') return 'gast';
  if (user?.role === 'kind') return 'kind';
  return 'haushalt';
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
 * Bewusst ein blätterbares Blatt und KEIN Overlay, das mit Pfeilen auf
 * echte Bedienelemente zeigt: Die Leiste liegt auf dem Telefon unten,
 * auf dem iPad links, im Browser mal so, mal so - ein Pfeil, der auf
 * allen dreien auf die richtige Stelle träfe, müsste jedes Layout kennen
 * und bräche beim nächsten Umbau still.
 *
 * Gezeigt wird trotzdem, nicht nur erzählt: Jeder Schritt trägt ein
 * Schaubild IM Blatt - die Leiste mit ihren echten Symbolen (antippbar,
 * die App wechselt dahinter live mit), der «Alles aus»-Knopf, das
 * Suchfeld. Eine Aufzählung «Start, Räume, Licht, …» in Prosa musste
 * jeder erst im Kopf auf Symbole übersetzen; das Schaubild spart ihm
 * genau diese Übersetzung.
 */
export function schritteFuer(
  user: EinfuehrungBenutzer | null | undefined
): EinfuehrungSchritt[] {
  const fassung = fassungFuer(user);
  if (fassung === 'gast') {
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
  if (fassung === 'kind') {
    return [
      {
        icon: 'happy-outline',
        titel: 'Deine Zimmer',
        text:
          'Du siehst deine Zimmer mit grossen Knöpfen. Antippen macht ' +
          'das Licht an, nochmals antippen macht es wieder aus - und ' +
          'genauso gehen die Storen. Mehr musst du nicht wissen.',
      },
    ];
  }
  return [
    {
      icon: 'compass-outline',
      titel: 'Die Bereiche',
      schaubild: 'leiste',
      text:
        'Das ist die Leiste - unten auf dem Telefon, links auf dem iPad. ' +
        'Tipp oben einen Bereich an: Die App wechselt dahinter gleich mit. ' +
        'Auf Start steht, was gerade läuft.',
    },
    {
      icon: 'power-outline',
      titel: '«Alles aus»',
      schaubild: 'allesaus',
      // Wo er WIRKLICH wohnt: Von der Startseite wurde der Knopf bewusst
      // entfernt (er stand dort im Weg), und ohne eingeschaltete Geräte
      // zeigt er sich gar nicht. Genau das muss die Einführung sagen -
      // sonst sucht jemand einen Knopf, den es «gar nirgends gibt».
      text:
        'Sobald etwas an ist, steht dieser Knopf im Bereich Räume - für ' +
        'den gewählten Raum oder das ganze Haus. Er zeigt erst eine Liste ' +
        'zum Abwählen: Laufende Haushaltgeräte bleiben von selbst ' +
        'verschont. Als Widget liegt er auch auf dem Sperrbildschirm.',
    },
    {
      icon: 'search-outline',
      titel: 'Suchen statt scrollen',
      schaubild: 'suche',
      text:
        'Unter Einstellungen → Suche findest du jedes Gerät, jeden Raum, ' +
        'jede Szene und jeden Ablauf mit drei getippten Buchstaben.',
    },
    {
      icon: 'help-circle-outline',
      titel: 'Auf jeder Seite ein Fragezeichen',
      // Der wichtigste Schritt, seit es die Seitenhilfe gibt
      // (lib/seitenhilfe.ts): Diese Einführung muss die App nicht mehr
      // erklären, sie muss nur noch zeigen, wo die Erklärung steht -
      // und zwar die zu der Seite, auf der jemand gerade nicht
      // weiterweiss. Alles auf einmal zu erzählen hat noch nie
      // funktioniert; man liest es, bevor man die Frage hat.
      text:
        'Hinter dem Zahnrad in der Leiste liegen die Einstellungen. Oben ' +
        'rechts steht dort auf jeder Seite ein Fragezeichen: Es sagt, ' +
        'wofür genau diese Seite da ist, und führt dich hin, wo etwas ' +
        'anderes wohnt. Diese Einführung findest du dort auch wieder.',
    },
  ];
}
