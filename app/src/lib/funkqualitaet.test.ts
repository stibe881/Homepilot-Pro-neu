/**
 * Der Abschnitt «Funk» in der Geräte-Gesundheit (Punkt 230).
 *
 * Der Fall dahinter: Ein Gerät, dessen linkquality seit Wochen fällt,
 * verstummt irgendwann – und dann sucht man den Fehler bei der
 * Batterie. Die Liste soll genau die Geräte zeigen, bei denen sich
 * vorher etwas tun lässt.
 */
import { funkRows, funkStufe, funkWort, type FunkZeile } from './funkqualitaet';

const zeile = (teile: Partial<FunkZeile>): FunkZeile => ({
  entity_id: 'zigbee.melder',
  name: 'Melder',
  room: 'Flur',
  value: 120,
  mean_from: null,
  mean_to: null,
  direction: null,
  weak: false,
  ...teile,
});

describe('funkRows', () => {
  it('zeigt nur Schwache und Fallende, die schwächsten zuerst', () => {
    const rows = funkRows([
      zeile({ entity_id: 'a', name: 'Solide', value: 200, direction: 'steady' }),
      zeile({
        entity_id: 'b',
        name: 'Fällt',
        value: 130,
        mean_from: 255,
        mean_to: 127,
        direction: 'falling',
      }),
      zeile({
        entity_id: 'c',
        name: 'Schwach',
        value: 34,
        mean_from: 180,
        mean_to: 40,
        direction: 'falling',
        weak: true,
      }),
    ]);
    expect(rows.map((row) => row.entity_id)).toEqual(['c', 'b']);
  });

  it('erfindet für junge Reihen nichts – ohne Trend keine Zeile', () => {
    // Der Hub liefert direction: null, solange die Reihe unter drei
    // Wochen alt ist. Ein frisch angelerntes Gerät ist keine Sorge.
    expect(funkRows([zeile({ value: 90 })])).toEqual([]);
  });

  it('übersteht eine leere Antwort', () => {
    expect(funkRows(undefined as unknown as FunkZeile[])).toEqual([]);
  });
});

describe('funkStufe', () => {
  it('nennt kritisch, was der Hub schwach nennt – daraus wird auch die Push', () => {
    expect(funkStufe(zeile({ weak: true }))).toBe('kritisch');
    expect(funkStufe(zeile({ direction: 'falling' }))).toBe('warnung');
  });
});

describe('funkWort', () => {
  it('nennt die Entwicklung mit beiden Zahlen', () => {
    expect(
      funkWort(zeile({ mean_from: 180, mean_to: 40 }))
    ).toBe('von 180 auf 40 gefallen');
  });

  it('erzählt keinen Absturz, wo keiner war', () => {
    // Ein Gerät, das seit je bei 25 funkt, ist schwach - mehr nicht.
    expect(funkWort(zeile({ mean_from: 26, mean_to: 24, weak: true }))).toBe(
      'seit Wochen schwach (24 von 255)'
    );
  });

  it('fällt ohne Wochenmittel auf den aktuellen Wert zurück', () => {
    expect(funkWort(zeile({ value: 28.6, weak: true }))).toBe(
      'seit Wochen schwach (29 von 255)'
    );
  });
});
