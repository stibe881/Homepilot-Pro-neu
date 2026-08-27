/**
 * Was im Haus los war – der Rückblick über alle Geräte.
 *
 * Der Verlauf je Gerät beantwortet «warum ging *das* an?». Diese Frage
 * ist eine andere: «Was war heute Nacht los?» Sie liess sich nur
 * beantworten, indem man jede Kachel einzeln aufmachte – und wer das
 * täte, hätte die Antwort nach zwanzig Kacheln vergessen.
 *
 * Reines Rechnen: hinein die Ereignisse des Hubs, heraus die Abschnitte
 * für die Liste. Gruppiert wird wie beim Geräteverlauf nach Tagen, damit
 * beide Listen sich gleich lesen (siehe lib/verlaufliste.ts).
 */
import { VerlaufEreignis, tagTitel, zustandName } from './verlaufliste';

export interface HausEreignis extends VerlaufEreignis {
  entity_id?: string;
}

export interface GeraetAngabe {
  name: string;
  kind?: string;
  room?: string | null;
}

export interface HausZeile {
  key: string;
  at: number;
  /** «Küche · Licht» – Gerät und Raum, wo bekannt. */
  wer: string;
  /** «Eingeschaltet», «Geöffnet» … */
  was: string;
  /** Wer es war: ein Mensch, ein Ablauf, das Gerät selbst. */
  quelle: string;
  detail: string | null;
  kind: string;
}

export interface HausAbschnitt {
  titel: string;
  zeilen: HausZeile[];
}

/** Wer den Wechsel ausgelöst hat, als Satzteil (rein, testbar). */
export function quelleName(quelle: HausEreignis['source']): string {
  const art = quelle?.kind ?? '';
  const label = quelle?.label ?? '';
  if (art === 'user') return label || 'Benutzer';
  if (art === 'automation') return `Ablauf «${label}»`;
  if (art === 'scene') return `Szene «${label}»`;
  if (art === 'simulation') return label || 'Anwesenheitssimulation';
  return 'am Gerät';
}

/**
 * Die Zeilen in Tagesabschnitte (rein, testbar).
 *
 * Erwartet die Reihenfolge des Hubs: jüngstes zuerst.
 */
export function hausAbschnitte(
  ereignisse: HausEreignis[],
  geraete: Record<string, GeraetAngabe>,
  jetzt: number = Date.now(),
): HausAbschnitt[] {
  const abschnitte: HausAbschnitt[] = [];
  ereignisse.forEach((ereignis, index) => {
    const kennung = String(ereignis.entity_id ?? '');
    const angabe = geraete[kennung];
    // Ein Gerät, das es nicht mehr gibt, behält seinen Platz in der
    // Liste: Was passiert ist, ist passiert – auch wenn die Kachel weg
    // ist. Ohne Namen steht dann die Kennung da, und das ist immer noch
    // mehr als eine leere Zeile.
    const name = angabe?.name || kennung || 'Unbekannt';
    const zeile: HausZeile = {
      key: `${kennung}-${ereignis.at}-${index}`,
      at: ereignis.at,
      wer: angabe?.room ? `${name} · ${angabe.room}` : name,
      was: zustandName(ereignis.state),
      quelle: quelleName(ereignis.source),
      detail: ereignis.detail ?? null,
      kind: angabe?.kind ?? '',
    };
    const titel = tagTitel(ereignis.at, jetzt);
    const letzter = abschnitte[abschnitte.length - 1];
    if (letzter && letzter.titel === titel) letzter.zeilen.push(zeile);
    else abschnitte.push({ titel, zeilen: [zeile] });
  });
  return abschnitte;
}

/** Die Arten, nach denen sich der Rückblick filtern lässt (rein, testbar).
 *
 *  Nur die, die auch vorkommen: Ein Filter für etwas, das nicht dasteht,
 *  ist ein Knopf, der nichts tut. */
export function vorhandeneArten(zeilen: HausZeile[]): string[] {
  const gesehen = new Set<string>();
  for (const zeile of zeilen) if (zeile.kind) gesehen.add(zeile.kind);
  return [...gesehen].sort();
}

/** Wie eine Geräteart im Filter heisst (rein, testbar). */
const ART_NAMEN: Record<string, string> = {
  light: 'Licht',
  switch: 'Schalter',
  cover: 'Storen',
  lock: 'Schlösser',
  binary_sensor: 'Melder',
  media_player: 'Musik',
  climate: 'Heizung',
  vacuum: 'Sauger',
  appliance: 'Haushalt',
  alarm: 'Alarm',
};

export function artName(kind: string): string {
  return ART_NAMEN[kind] ?? kind;
}
