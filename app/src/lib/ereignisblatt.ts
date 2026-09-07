/**
 * Das Ereignisblatt des Alarms - die Viertelstunde als eine Zeitleiste.
 *
 * Der Hub liefert unter /api/alarm/ereignis vier Listen (Alarm-Verlauf,
 * Geräte-Ereignisse, archivierte Standbilder, Mitschnitte); hier werden
 * sie zu EINER chronologischen Leiste verwoben. Rein und ohne Netz -
 * das Blatt selbst zeigt nur an, was hier herauskommt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Roh = Record<string, any>;

export interface BlattAntwort {
  von?: number;
  bis?: number;
  verlauf?: Roh[];
  events?: Roh[];
  devices?: Record<string, { name?: string; kind?: string; room?: string | null }>;
  bilder?: Roh[];
  clips?: Roh[];
}

export interface BlattZeile {
  at: number;
  art: 'alarm' | 'geraet' | 'bild' | 'clip';
  /** Beim Alarm-Verlauf: die Art des Eintrags (triggered, armed, …). */
  kind?: string;
  titel: string;
  unter: string;
  /** Rot hervorheben - der Alarm selbst und seine zweite Stufe. */
  hervor?: boolean;
  /** Bei Bildern: die Kennung fürs Nachladen über /api/alarm/bild/… */
  kennung?: string;
  /** Bei Mitschnitten: die Kennung fürs Abspielen über /api/clips/… */
  clipId?: string;
}

function geraetZeile(event: Roh, devices: BlattAntwort['devices']): BlattZeile {
  const kennung = String(event.entity_id ?? '');
  const geraet = devices?.[kennung];
  const quelle = event.source?.label ? ` · ${event.source.label}` : '';
  return {
    at: Number(event.at ?? 0),
    art: 'geraet',
    titel: geraet?.name || kennung,
    unter: `${String(event.state ?? '')}${quelle}`,
  };
}

/** Die vier Listen zu einer Zeitleiste verweben (rein, testbar). */
export function blattZeilen(antwort: BlattAntwort): BlattZeile[] {
  const zeilen: BlattZeile[] = [];
  for (const row of antwort.verlauf ?? []) {
    const kind = String(row.kind ?? '');
    zeilen.push({
      at: Number(row.at ?? 0),
      art: 'alarm',
      kind,
      titel: String(row.text ?? ''),
      unter: row.by ? String(row.by) : '',
      hervor: kind === 'triggered' || kind === 'escalated',
    });
  }
  for (const event of antwort.events ?? []) {
    zeilen.push(geraetZeile(event, antwort.devices));
  }
  for (const meta of antwort.bilder ?? []) {
    zeilen.push({
      at: Number(meta.at ?? 0),
      art: 'bild',
      titel: String(meta.name ?? meta.camera ?? 'Kamera'),
      unter: meta.anlass === 'motion' ? 'Bewegung vor der Kamera' : 'Bild vom Alarmmoment',
      kennung: String(meta.id ?? ''),
    });
  }
  for (const meta of antwort.clips ?? []) {
    zeilen.push({
      at: Number(meta.at ?? 0),
      art: 'clip',
      titel: `Mitschnitt: ${String(meta.name ?? meta.camera ?? 'Kamera')}`,
      unter: 'Antippen zum Abspielen',
      clipId: String(meta.id ?? ''),
    });
  }
  // Chronologisch, älteste zuerst: Ein Blatt liest sich wie die
  // Geschichte des Abends, nicht wie ein Posteingang.
  return zeilen.sort((a, b) => a.at - b.at);
}

/** Ist zu diesem Verlaufs-Eintrag überhaupt ein Blatt zu erwarten? */
export function blattWuerdig(kind: string): boolean {
  return ['triggered', 'escalated', 'entry', 'motion'].includes(kind);
}
