/** «20 Minuten backen» → die Küchenuhr weiss Bescheid. */
import { minutenImText, zeitenImText } from './kochzeit';

describe('minutenImText', () => {
  it('liest Minuten in allen Schreibweisen', () => {
    expect(minutenImText('20 Minuten backen')).toBe(20);
    expect(minutenImText('ca. 5 Min köcheln lassen')).toBe(5);
    expect(minutenImText('45 min bei 180°')).toBe(45);
  });

  it('rechnet Stunden um', () => {
    expect(minutenImText('1 Stunde ruhen lassen')).toBe(60);
    expect(minutenImText('1,5 Std backen')).toBe(90);
  });

  it('nimmt die erste Angabe, wenn mehrere da sind', () => {
    expect(minutenImText('10 Minuten anbraten, dann 30 Minuten schmoren')).toBe(10);
  });

  it('schweigt ohne Zeitangabe – lieber kein Knopf als einer, der rät', () => {
    expect(minutenImText('Zwiebeln würfeln')).toBeNull();
    expect(minutenImText('250 g Mehl unterheben')).toBeNull();
  });
});

describe('zeitenImText', () => {
  it('findet alle Zeiten eines Schritts - jede wird ein Uhr-Knopf', () => {
    expect(zeitenImText('10 Minuten anbraten, dann 30 Minuten schmoren')).toEqual([10, 30]);
    expect(zeitenImText('1 Std backen, 15 Min ruhen lassen')).toEqual([60, 15]);
  });

  it('meldet dieselbe Zeit nur einmal', () => {
    expect(zeitenImText('5 Min rühren, nochmals 5 Min rühren')).toEqual([5]);
  });

  it('bleibt leer ohne Zeitangabe', () => {
    expect(zeitenImText('Zwiebeln würfeln')).toEqual([]);
  });
});
