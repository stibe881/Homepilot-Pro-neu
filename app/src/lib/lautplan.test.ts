import { geordnet, minuten, neueStufe, stufeJetzt, stufenSatz, uhrzeit } from './lautplan';

const STUFEN = [
  { at: '07:00', volume: 20 },
  { at: '10:00', volume: 70 },
  { at: '20:00', volume: 20 },
  { at: '23:45', volume: 10 },
];

const um = (hhmm: string) => minuten(hhmm) as number;

describe('minuten / uhrzeit', () => {
  it('rechnet hin und zurück', () => {
    expect(minuten('07:00')).toBe(420);
    expect(uhrzeit(420)).toBe('07:00');
  });

  it('weist Unsinn ab', () => {
    expect(minuten('25:00')).toBeNull();
    expect(minuten('7')).toBeNull();
    expect(minuten('07:70')).toBeNull();
  });

  it('füllt einstellige Stunden auf', () => {
    expect(uhrzeit(65)).toBe('01:05');
  });
});

describe('stufeJetzt', () => {
  it('hält die Morgenstufe bis zur Tagstufe', () => {
    expect(stufeJetzt(STUFEN, um('08:30'))?.volume).toBe(20);
  });

  it('schaltet auf die Minute genau', () => {
    expect(stufeJetzt(STUFEN, um('10:00'))?.volume).toBe(70);
  });

  it('trägt die letzte Stufe über Mitternacht', () => {
    // Sonst wäre die Nacht ein Loch im Plan - und genau dort liegt sie.
    expect(stufeJetzt(STUFEN, um('02:00'))?.volume).toBe(10);
  });

  it('liest auch einen unsortierten Plan richtig', () => {
    expect(stufeJetzt([...STUFEN].reverse(), um('12:00'))?.volume).toBe(70);
  });

  it('sagt nichts ohne Stufen', () => {
    expect(stufeJetzt([], um('12:00'))).toBeNull();
  });
});

describe('geordnet', () => {
  it('sortiert und wirft Vertipper zusammen', () => {
    const liste = geordnet([
      { at: '10:00', volume: 70 },
      { at: '7:00', volume: 20 },
      { at: '07:00', volume: 25 },
    ]);
    expect(liste).toEqual([
      { at: '07:00', volume: 25 },
      { at: '10:00', volume: 70 },
    ]);
  });
});

describe('stufenSatz', () => {
  it('nennt das Bis', () => {
    expect(stufenSatz(STUFEN, 1)).toBe('70 % – bis 20:00');
  });

  it('schliesst über Mitternacht zur ersten Stufe', () => {
    expect(stufenSatz(STUFEN, 3)).toBe('10 % – bis 07:00');
  });

  it('sagt bei einer einzigen Stufe, dass sie durchgilt', () => {
    expect(stufenSatz([{ at: '07:00', volume: 20 }], 0)).toBe('20 % – den ganzen Tag');
  });
});

describe('neueStufe', () => {
  it('legt sich in die grösste Lücke', () => {
    // 10:00 bis 20:00 sind zehn Stunden - die Mitte ist 15:00.
    expect(neueStufe(STUFEN).at).toBe('15:00');
  });

  it('rechnet die Lücke über Mitternacht mit', () => {
    const zwei = [
      { at: '08:00', volume: 20 },
      { at: '09:00', volume: 70 },
    ];
    // Von 09:00 bis 08:00 sind 23 Stunden; die Mitte liegt um 20:30.
    expect(neueStufe(zwei).at).toBe('20:30');
  });

  it('schlägt bei leerem Plan etwas Brauchbares vor', () => {
    expect(neueStufe([])).toEqual({ at: '07:00', volume: 30 });
  });
});
