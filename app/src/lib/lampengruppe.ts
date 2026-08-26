/**
 * Die Zeile einer zusammengefassten Lampe – was daraufsteht.
 *
 * Sie zeigte alle Mitglieder als Namensliste: «Levin Spot 1 · Levin
 * Spot 2 · Levin Spot 3 · Levin…». Zwei Zeilen, am Ende abgeschnitten,
 * und dazwischen quetschten sich der Raum-Chip und zwei Symbole. Die
 * Namen sagen dabei nichts, was der Gruppenname nicht schon sagt – wer
 * wissen will, welche Spots drin sind, tippt auf den Stift, dort stehen
 * sie als Liste zum Ankreuzen.
 *
 * Was bleibt, ist die Zahl: «4 Lampen» beantwortet die Frage, die man
 * an eine Gruppe hat.
 */
export interface Gruppe {
  name: string;
  members: string[];
  /** Bleiben die einzelnen Lampen in den Räumen sichtbar? */
  hide_members?: boolean;
}

/** «4 Lampen», «1 Lampe» (rein, testbar). */
export function lampenZahl(gruppe: Gruppe): string {
  const anzahl = gruppe?.members?.length ?? 0;
  return anzahl === 1 ? '1 Lampe' : `${anzahl} Lampen`;
}

/**
 * Die kleine Zeile unter dem Namen (rein, testbar).
 *
 * «einzeln sichtbar» kommt dazu, wo es gilt: Das ist der Unterschied
 * zwischen «eine Deckenlampe» und «eine Deckenlampe und fünf Spots»,
 * und man sieht ihn sonst erst im Raum.
 */
export function gruppenZeile(gruppe: Gruppe): string {
  const teile = [lampenZahl(gruppe)];
  if (gruppe?.hide_members === false) teile.push('einzeln sichtbar');
  return teile.join(' · ');
}
