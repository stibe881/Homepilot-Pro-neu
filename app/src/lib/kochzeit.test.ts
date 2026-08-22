/** «20 Minuten backen» → die Küchenuhr weiss Bescheid. */
import { minutenImText } from './kochzeit';

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
