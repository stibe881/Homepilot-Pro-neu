import type { Entity, EntityState } from '../api/types';
import { kopfmusik, kopfmusikLabel } from './kopfmusik';

function box(state: EntityState, extra: Partial<Entity> = {}): Entity {
  return {
    id: 'sonos.kueche',
    kind: 'media_player',
    name: 'Küche',
    integration: 'sonos',
    state,
    commands: ['play', 'pause', 'next'],
    available: true,
    room: 'Küche',
    ...extra,
  };
}

describe('kopfmusik', () => {
  it('nennt Titel, Künstler und Box, während etwas läuft', () => {
    const musik = kopfmusik(
      box({ state: 'playing', track: 'Ain’t No Sunshine', artist: 'Bill Withers' })
    );
    expect(musik.titel).toBe('Ain’t No Sunshine');
    // Die Box steht mit dabei: In einem Zimmer mit zwei Boxen ist sie
    // die Auskunft, die den Streifen eindeutig macht.
    expect(musik.unter).toBe('Bill Withers · Küche');
    expect(musik.laeuft).toBe(true);
  });

  it('nimmt beim Puffern trotzdem den Pausenknopf', () => {
    // «Lädt» ist kein Stillstand - der richtige Knopf ist Pause.
    expect(kopfmusik(box({ state: 'buffering', track: 'Etwas' })).laeuft).toBe(true);
  });

  it('stellt ohne Titel die Box voran und sagt den Zustand', () => {
    const musik = kopfmusik(box({ state: 'standby' }));
    expect(musik.titel).toBe('Küche');
    expect(musik.unter).toBe('Nichts an');
    expect(musik.laeuft).toBe(false);
  });

  it('unterscheidet eine stille Box von einer, die nicht antwortet', () => {
    // Nur die zweite ist ein Grund, nachzusehen.
    const weg = kopfmusik(box({ state: 'playing', track: 'Etwas' }, { available: false }));
    expect(weg.unter).toBe('Nicht erreichbar');
    expect(weg.da).toBe(false);
    expect(weg.laeuft).toBe(false);
  });

  it('kommt ohne Künstler aus', () => {
    // Ein Radiosender meldet oft nur den Titel.
    expect(kopfmusik(box({ state: 'playing', track: 'SRF 3' })).unter).toBe('Küche');
  });

  it('spricht die zwei Zeilen als einen Satz', () => {
    expect(kopfmusikLabel(box({ state: 'paused', track: 'Etwas', artist: 'Wer' }))).toBe(
      'Musik: Etwas – Wer · Küche'
    );
  });
});
