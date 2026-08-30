/**
 * Die Sätze der Startkarte (alle rein, testbar).
 *
 * Der obere Teil der Startseite ist eine gerahmte Karte geworden - eine
 * Begrüssung, die gleich sagt, was Sache ist. Statt neun gleichwertiger
 * Chips stehen dort Sätze: wer zuhause ist, was als Nächstes ansteht,
 * wessen Geburtstag naht. Die Sätze entstehen hier, ohne React - die
 * Karte selbst (TopStrip im Karten-Modus) setzt sie nur.
 */
import type { Entity } from '../api/types';
import { geburtstagsListe } from './kalenderliste';

/**
 * «Stefan & Bine zuhause · Levin unterwegs» - aus den Geofence-Zonen.
 *
 * Nur eingerichtete Personen: Die Zonen des Geofence tragen die Namen.
 * Wer noch nie gemeldet hat (state «unknown»), wird nicht behauptet -
 * weder daheim noch unterwegs. Ohne eine einzige klare Meldung gibt es
 * keinen Satz; dann bleibt die Karte bei «jemand da»/«niemand da».
 */
export function anwesenheitsSatz(entities: Entity[]): string | null {
  const zonen = entities.filter(
    (entity) =>
      entity.integration === 'geofence' &&
      entity.kind === 'binary_sensor' &&
      entity.id !== 'geofence.anyone_home'
  );
  const daheim: string[] = [];
  const weg: string[] = [];
  for (const zone of zonen) {
    const stand = String(zone.state.state ?? 'unknown');
    if (stand === 'unknown' || stand === '') continue;
    // Der Vorname reicht - «Stefan Gross zuhause» liest niemand gern.
    const name = zone.name.trim().split(/\s+/)[0];
    (stand === 'home' ? daheim : weg).push(name);
  }
  if (daheim.length === 0 && weg.length === 0) return null;
  const teile: string[] = [];
  if (daheim.length > 0) teile.push(`${daheim.join(' & ')} zuhause`);
  if (weg.length > 0) teile.push(`${weg.join(' & ')} unterwegs`);
  return teile.join(' · ');
}

/** «17:30 Fussballtraining, Sursee» - der nächste Termin als Satz. */
export function terminSatz(
  zeit: string,
  titel: unknown,
  ort: unknown
): string | null {
  const name = String(titel ?? '').trim();
  if (!name) return null;
  // Nur der lesbare Teil der Adresse - «, 6210 Sursee, Schweiz» steht im
  // Termin selbst, ein Tipp öffnet ihn ja.
  const kurz = String(ort ?? '').split(',')[0].trim();
  return `${zeit} ${name}${kurz ? `, ${kurz}` : ''}`;
}

/** «Flo hat Geburtstag» → «Flo» - auf der Karte zählt der Name (rein,
 *  testbar). Die Formeln stammen aus den Kalendern selbst; was keine
 *  davon trifft, bleibt unangetastet. */
export function geburtstagsName(summary: string): string {
  const name = String(summary ?? '')
    .replace(/\s+hat\s+Geburtstag.*$/i, '')
    .replace(/^Geburtstag\s+von\s+/i, '')
    .replace(/['’]s\s+birthday.*$/i, '')
    .replace(/\s*[–-]\s*Geburtstag.*$/i, '')
    .trim();
  return name || String(summary ?? '').trim();
}

/** «Flo in 5 Tagen» - der nächste Geburtstag, wenn der Kalender einen
 *  kennt. */
export function geburtstagsSatz(events: unknown, jetzt: Date): string | null {
  const liste = geburtstagsListe(Array.isArray(events) ? events : null, jetzt);
  const erster = liste[0];
  if (!erster) return null;
  return `${geburtstagsName(erster.titel)} ${erster.wann}`;
}
