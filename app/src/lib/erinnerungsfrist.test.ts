import { FRISTEN, fristMinuten, fristSatz } from './erinnerungsfrist';

const um = (stunde: number, minute = 0) => new Date(2026, 7, 28, stunde, minute, 0, 0);

describe('Wann «später» ist', () => {
  it('nimmt eine Minutenzahl, wie sie dasteht', () => {
    expect(fristMinuten('30', um(9))).toBe(30);
    expect(fristMinuten('120', um(9))).toBe(120);
  });

  it('rechnet «heute Abend» aus der Uhrzeit', () => {
    // Wer um 9 Uhr «heute Abend» wählt, meint in zehn Stunden.
    expect(fristMinuten('abend', um(9))).toBe(10 * 60);
    // Und wer um 18:30 wählt, meint in einer halben Stunde.
    expect(fristMinuten('abend', um(18, 30))).toBe(30);
  });

  it('schiebt «heute Abend» auf morgen, wenn er vorbei ist', () => {
    // Sonst wäre es eine Erinnerung in der Vergangenheit - die käme
    // sofort.
    expect(fristMinuten('abend', um(20))).toBe(23 * 60);
  });

  it('rechnet «morgen früh» über Mitternacht', () => {
    expect(fristMinuten('morgen', um(22))).toBe(9 * 60);
  });

  it('gibt nie null Minuten zurück', () => {
    expect(fristMinuten('abend', um(19, 0))).toBeGreaterThan(0);
  });

  it('nennt im Satz die Zeit, nicht die Wahl', () => {
    expect(fristSatz(30)).toBe('Erinnerung in 30 Minuten');
    expect(fristSatz(60)).toBe('Erinnerung in einer Stunde');
    expect(fristSatz(120)).toBe('Erinnerung in 2 Stunden');
  });

  it('bietet vier Fristen an', () => {
    expect(FRISTEN.map((f) => f.key)).toEqual(['30', '120', 'abend', 'morgen']);
  });
});
