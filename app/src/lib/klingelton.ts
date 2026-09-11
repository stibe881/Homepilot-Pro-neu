/**
 * Der Klingelton: welcher Klang auf welchen Boxen spielt, wenn es klingelt.
 *
 * Gehört zur Regel «Es klingelt» (core/notifyrules.py) und steht deshalb in
 * deren Karte, wie die Storen-Auswahl der Wächter-Regeln in ihrer eigenen.
 * Anders als dort heisst eine leere Auswahl hier «still», nicht «alle
 * Boxen» - ein Klingelton soll erst losgehen, wenn ihn jemand eingerichtet
 * hat, nicht beim ersten Klingeln nach der Auslieferung auf jeder Box im
 * Haus (core/klingelton.py).
 */

export interface Lautsprecher {
  id: string;
  name: string;
  room?: string | null;
}

export interface Klang {
  key: string;
  label: string;
}

/**
 * Eine gewählte Box - mit ihrer eigenen Lautstärke und Zeitspanne.
 *
 * Beides gehört je Box und nicht ins Haus: Die Küchenbox steht neben dem
 * Esstisch und darf leise sein, im Keller hört man sonst nichts; und die
 * Box im Kinderzimmer soll abends nicht mehr losgehen, während die im
 * Flur immer darf. Der Hub liest beide Formen - eine blosse Kennung aus
 * einer älteren Fassung bekommt die Vorgaben (core/klingelton.py).
 */
export interface Klingelbox {
  id: string;
  volume: number;
  /** «07:00» - von wann an es auf dieser Box klingelt. */
  from: string;
  /** «20:00», oder «24:00» für «bis Mitternacht». */
  to: string;
}

export interface Klingeltonstand {
  sound: string;
  speakers: Klingelbox[];
  sounds: Klang[];
  candidates: Lautsprecher[];
}

/** Lautstärke einer Box, solange niemand daran gedreht hat. */
export const LAUTSTAERKE_VORGABE = 55;
/** Und ihre Zeitspanne: den ganzen Tag. Wer eine Box wählt, will sie hören. */
export const SPANNE_VORGABE = { from: '00:00', to: '24:00' };

/** Ist diese Box gewählt? (rein, testbar) */
export function istGewaehlt(speakers: Klingelbox[], id: string): boolean {
  return speakers.some((box) => box.id === id);
}

/** Die Einstellungen einer Box - oder die Vorgaben (rein, testbar). */
export function boxStand(speakers: Klingelbox[], id: string): Klingelbox {
  return (
    speakers.find((box) => box.id === id) ?? {
      id,
      volume: LAUTSTAERKE_VORGABE,
      ...SPANNE_VORGABE,
    }
  );
}

/** Name und Raum in einer Zeile (rein, testbar). */
export function lautsprecherName(box: Lautsprecher): string {
  const raum = (box.room ?? '').trim();
  if (!raum || box.name.toLowerCase().includes(raum.toLowerCase())) {
    return box.name;
  }
  return `${box.name} · ${raum}`;
}

/**
 * Eine Box aus der Auswahl nehmen oder dazunehmen (rein, testbar).
 *
 * Eine neue Box kommt mit den Vorgaben herein. Eine abgewählte verliert
 * ihre Einstellungen - das ist gewollt: Wer sie später wieder dazunimmt,
 * fängt sichtbar bei den Vorgaben an, statt eine halb vergessene
 * Nachtsperre von vor drei Monaten zu erben.
 */
export function boxUmschalten(gewaehlt: Klingelbox[], id: string): Klingelbox[] {
  return istGewaehlt(gewaehlt, id)
    ? gewaehlt.filter((box) => box.id !== id)
    : [...gewaehlt, { id, volume: LAUTSTAERKE_VORGABE, ...SPANNE_VORGABE }];
}

/** Eine Einstellung einer einzelnen Box ändern (rein, testbar). */
export function boxAendern(
  gewaehlt: Klingelbox[],
  id: string,
  aenderung: Partial<Omit<Klingelbox, 'id'>>
): Klingelbox[] {
  return gewaehlt.map((box) => (box.id === id ? { ...box, ...aenderung } : box));
}

/** Die Lautstärken zur Wahl - dieselbe Leiter wie beim Wecker. */
export const LAUTSTAERKEN = [20, 40, 55, 70, 85];

/**
 * Getipptes zu einer Uhrzeit machen (rein, testbar).
 *
 * «7» wird «07:00», «730» wird «07:30», «7:5» wird «07:05». Was gar
 * nicht geht, fällt auf die Vorgabe zurück statt die Box stumm zu
 * schalten: Eine kaputte Eingabe darf dazu führen, dass es zu oft
 * klingelt, nicht dass es nie klingelt (dieselbe Regel wie im Hub,
 * core/klingelton.py).
 */
export function uhrzeitSauber(text: string, vorgabe: string): string {
  const roh = (text ?? '').trim();
  if (roh === '24:00' || roh === '2400') return '24:00';
  const ziffern = roh.replace(/[^0-9]/g, '');
  // Ohne eine einzige Ziffer ist es keine Uhrzeit, sondern ein Wort.
  // Ohne diese Zeile wurde aus «abends» ein «00:00» - und damit aus
  // einem Vertipper still Mitternacht.
  if (!ziffern) return vorgabe;
  let stunde: number;
  let minute: number;
  if (roh.includes(':')) {
    const [links, rechts] = roh.split(':');
    stunde = Number(links);
    minute = Number(rechts === '' ? 0 : rechts);
  } else if (ziffern.length <= 2) {
    stunde = Number(ziffern);
    minute = 0;
  } else {
    stunde = Number(ziffern.slice(0, ziffern.length - 2));
    minute = Number(ziffern.slice(-2));
  }
  if (!Number.isInteger(stunde) || !Number.isInteger(minute)) return vorgabe;
  if (stunde < 0 || stunde > 23 || minute < 0 || minute > 59) return vorgabe;
  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Was die Zeitspanne einer Box bedeutet, in einem Satz (rein, testbar).
 *
 * «00:00 bis 24:00» als Zahlenpaar dastehen zu lassen wäre die
 * schlechtere Auskunft: Wer es liest, rechnet nach, ob das nun immer
 * heisst oder nie.
 */
export function spanneSatz(box: Klingelbox): string {
  if (box.from === box.to || (box.from === '00:00' && box.to === '24:00')) {
    return 'immer';
  }
  return `${box.from} – ${box.to === '24:00' ? '24:00' : box.to}`;
}

/**
 * Was die Wahl gerade bewirkt, in einem Satz (rein, testbar).
 *
 * Ohne Box steht hier bewusst, was *nicht* passiert - sonst sucht man
 * den versprochenen Ton und hält sein Ausbleiben für einen Fehler.
 */
export function klingeltonSatz(stand: Klingeltonstand | null): string {
  if (!stand || stand.speakers.length === 0) {
    return 'Keine Box gewählt – es bleibt bei der Push-Nachricht allein.';
  }
  const klang = stand.sounds.find((eintrag) => eintrag.key === stand.sound)?.label ?? stand.sound;
  const namen = stand.speakers
    .map((eintrag) => stand.candidates.find((box) => box.id === eintrag.id))
    .filter((box): box is Lautsprecher => box != null)
    .map(lautsprecherName);
  const boxenText =
    namen.length <= 2 ? namen.join(' und ') : `${namen.length} Boxen`;
  return `«${klang}» spielt auf ${boxenText}.`;
}
