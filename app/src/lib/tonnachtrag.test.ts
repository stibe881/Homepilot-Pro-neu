import { nachtragSatz } from './tonnachtrag';

const NAMEN = { 'demo.bad': 'Nest Badezimmer', 'demo.buero': 'Büro' };

describe('nachtragSatz', () => {
  it('schweigt, wenn nichts wartet', () => {
    expect(nachtragSatz([], NAMEN)).toBeNull();
    expect(nachtragSatz(undefined, NAMEN)).toBeNull();
  });

  it('nennt Box und Zielwert', () => {
    expect(nachtragSatz([{ entity_id: 'demo.bad', volume: 20 }], NAMEN)).toBe(
      'Nest Badezimmer wartet auf 20 % – solange dort etwas läuft',
    );
  });

  it('zählt ab zwei nur noch', () => {
    // Vier Boxennamen in einer Zeile liest niemand.
    expect(
      nachtragSatz(
        [
          { entity_id: 'demo.bad', volume: 20 },
          { entity_id: 'demo.buero', volume: 20 },
        ],
        NAMEN,
      ),
    ).toBe('2 Boxen warten auf ihre Lautstärke – solange dort etwas läuft');
  });

  it('nimmt die Kennung, wenn der Name fehlt', () => {
    expect(nachtragSatz([{ entity_id: 'demo.weg', volume: 30 }], NAMEN)).toContain('demo.weg');
  });
});
