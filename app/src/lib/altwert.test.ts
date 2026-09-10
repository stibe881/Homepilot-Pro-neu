import { ALT_AB, UNBEKANNT_AB, altZusatz, deckkraft, frische } from './altwert';

const JETZT = 1_700_000_000_000;
const vorSekunden = (n: number) => JETZT / 1000 - n;

describe('frische', () => {
  it('lässt alles frisch, solange die Verbindung steht', () => {
    // Ein Fenstersensor meldet sich nur bei einer Änderung - «seit drei
    // Stunden dasselbe» ist dann eine Auskunft, kein Problem.
    expect(frische(vorSekunden(3 * 3600), JETZT, true)).toBe('frisch');
  });

  it('ohne Verbindung wird aus «unverändert» ein «ungeprüft»', () => {
    expect(frische(vorSekunden(ALT_AB - 1), JETZT, false)).toBe('frisch');
    expect(frische(vorSekunden(ALT_AB + 1), JETZT, false)).toBe('alt');
  });

  it('was ohne Verbindung ewig stillsteht, ist unbekannt', () => {
    expect(frische(vorSekunden(UNBEKANNT_AB + 1), JETZT, false)).toBe('unbekannt');
    // Mit Verbindung bleibt es frisch - der Hub weiss es ja.
    expect(frische(vorSekunden(UNBEKANNT_AB + 1), JETZT, true)).toBe('frisch');
  });

  it('ohne Zeitpunkt und ohne Verbindung: unbekannt, nicht frisch', () => {
    expect(frische(null, JETZT, false)).toBe('unbekannt');
    expect(frische(undefined, JETZT, true)).toBe('frisch');
  });
});

describe('Darstellung', () => {
  it('dämpft, statt auszublenden', () => {
    // Der alte Wert ist die beste Auskunft, die es gerade gibt.
    expect(deckkraft('frisch')).toBe(1);
    expect(deckkraft('alt')).toBeLessThan(1);
    expect(deckkraft('alt')).toBeGreaterThan(deckkraft('unbekannt'));
    expect(deckkraft('unbekannt')).toBeGreaterThan(0);
  });

  it('nennt die Uhrzeit, nicht die Dauer', () => {
    const uhr = () => '17:42';
    expect(altZusatz('frisch', vorSekunden(9999), uhr)).toBe('');
    expect(altZusatz('alt', vorSekunden(300), uhr)).toBe('17:42');
    expect(altZusatz('unbekannt', null, uhr)).toBe('Stand unbekannt');
  });
});
