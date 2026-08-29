/**
 * Das Tagesband über der Ablaufliste – in welcher Reihenfolge es steht.
 *
 * Der Hub liefert den Tag chronologisch: 07:00, 10:00, 18:30, 22:00.
 * Das Band zeigte ihn genauso – und stand damit abends um elf auf
 * 07:00. Was heute noch kommt, lag rechts ausserhalb des Bildes, und
 * genau das ist die Frage, wegen der man hinsieht.
 *
 * Hier dreht sich das um: Zuerst das Kommende, danach – blasser – das
 * Gelaufene. Das Band öffnet damit auf der Antwort statt auf der
 * Vorgeschichte.
 */
export interface Bandeintrag {
  automation_id: string;
  alias: string;
  at: number;
  art: string;
}

/** Ein Eintrag samt dem, was die Kachel über ihn wissen muss. */
export interface Bandkachel extends Bandeintrag {
  /** Schon gelaufen? Dann Haken statt Uhr, und blasser. */
  vorbei: boolean;
}

/**
 * Das Band in Anzeigereihenfolge (rein, testbar).
 *
 * Innerhalb beider Hälften bleibt es chronologisch: Das Kommende
 * aufsteigend – der nächste Termin zuerst –, das Gelaufene absteigend,
 * denn nach hinten sucht man das zuletzt Geschehene, nicht den Morgen.
 */
export function bandReihenfolge(
  agenda: Bandeintrag[] | undefined,
  jetzt: number
): Bandkachel[] {
  const alle = (agenda ?? []).filter((eintrag) => Number.isFinite(eintrag?.at));
  const kommend = alle
    .filter((eintrag) => eintrag.at * 1000 >= jetzt)
    .sort((a, b) => a.at - b.at)
    .map((eintrag) => ({ ...eintrag, vorbei: false }));
  const vorbei = alle
    .filter((eintrag) => eintrag.at * 1000 < jetzt)
    .sort((a, b) => b.at - a.at)
    .map((eintrag) => ({ ...eintrag, vorbei: true }));
  return [...kommend, ...vorbei];
}

/**
 * Die Zeile über dem Band (rein, testbar).
 *
 * Sie sagt in Worten, was die Kacheln in Symbolen sagen – und vor allem
 * *dass* rechts noch etwas liegt. Ein waagrechtes Band ohne Zeile
 * darüber sieht am rechten Rand abgeschnitten aus, nicht scrollbar.
 * Leer, wenn heute nichts mehr ansteht und nichts gelaufen ist.
 */
export function bandZeile(kacheln: Bandkachel[]): string {
  const kommend = kacheln.filter((kachel) => !kachel.vorbei).length;
  const gelaufen = kacheln.length - kommend;
  const teile: string[] = [];
  if (kommend > 0) {
    teile.push(kommend === 1 ? 'Heute noch 1 Ablauf' : `Heute noch ${kommend} Abläufe`);
  } else if (gelaufen > 0) {
    teile.push('Heute kommt nichts mehr');
  }
  if (gelaufen > 0) teile.push(`${gelaufen} gelaufen`);
  return teile.join(' · ');
}
