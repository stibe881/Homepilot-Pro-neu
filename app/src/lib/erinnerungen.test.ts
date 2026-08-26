import { faellige, naechsteAt, offene, zeitpunkt } from './erinnerungen';

describe('zeitpunkt', () => {
  it('liest Schweizer Datum und Uhrzeit', () => {
    const ms = zeitpunkt('26.08.2026', '18:30');
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect([d.getDate(), d.getMonth() + 1, d.getFullYear()]).toEqual([26, 8, 2026]);
    expect([d.getHours(), d.getMinutes()]).toEqual([18, 30]);
  });

  it('nimmt auch 7.1.2027 und 7.05', () => {
    expect(zeitpunkt('7.1.2027', '7.05')).not.toBeNull();
  });

  it('weist Unlesbares ab', () => {
    expect(zeitpunkt('', '18:30')).toBeNull();
    expect(zeitpunkt('26.08.2026', '')).toBeNull();
    expect(zeitpunkt('morgen', '18:30')).toBeNull();
    expect(zeitpunkt('26.08.2026', '25:00')).toBeNull();
    expect(zeitpunkt('26.08.2026', '18:75')).toBeNull();
  });

  it('kennt den Kalender: den 31.02. gibt es nicht', () => {
    // JavaScript schöbe ihn stumm in den März - die Erinnerung käme
    // dann irgendwann, nur nicht dann, wann sie sollte.
    expect(zeitpunkt('31.02.2027', '10:00')).toBeNull();
  });
});

describe('faellige und offene', () => {
  const liste = [
    { id: 'a', text: 'Zahnarzt', at: 1000 },
    { id: 'b', text: 'Ofen aus', at: 500 },
    { id: 'c', text: 'Erledigt', at: 100, done: true },
    { id: 'd', text: 'Kaputt', at: 'keine Zahl' },
  ];

  it('offene: unbestätigt, lesbar, nach Zeit sortiert', () => {
    expect(offene(liste).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('fällig ist, was erreicht und nicht bestätigt ist', () => {
    expect(faellige(liste, 600).map((e) => e.id)).toEqual(['b']);
    expect(faellige(liste, 2000).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('eine Erinnerung verfällt nicht von selbst', () => {
    // Wer das Display erst abends sieht, soll die Erinnerung von
    // mittags noch vorfinden - dafür ist das Bestätigen da.
    expect(faellige(liste, 1e15).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('naechsteAt sagt, ob sich das Ticken lohnt', () => {
    expect(naechsteAt(liste)).toBe(500);
    expect(naechsteAt([])).toBeNull();
    expect(naechsteAt(undefined)).toBeNull();
  });
});
