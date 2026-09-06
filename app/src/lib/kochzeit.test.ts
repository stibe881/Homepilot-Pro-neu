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

describe('die Feinheiten echter Rezepttexte', () => {
  it('ein Bereich ist EINE Uhr - die kürzere', () => {
    // Man schaut lieber einmal zu früh in den Ofen als einmal zu spät.
    expect(zeitenImText('20-25 Min backen')).toEqual([20]);
    expect(zeitenImText('20–25 Minuten backen')).toEqual([20]);
    expect(zeitenImText('2 bis 3 Stunden schmoren')).toEqual([120]);
  });

  it('versteht Zeiten in Worten und mit Bruchzeichen', () => {
    expect(zeitenImText('eine halbe Stunde köcheln')).toEqual([30]);
    expect(zeitenImText('nach einer Viertelstunde wenden')).toEqual([15]);
    expect(zeitenImText('1½ Std gehen lassen')).toEqual([90]);
    expect(zeitenImText('½ Stunde ziehen lassen')).toEqual([30]);
  });

  it('laesst liegen, was die Kuechenuhr nicht kann', () => {
    // Der Hub deckelt bei 180 Minuten (core/timers.py) - ein Knopf, der
    // still an dieser Grenze scheitert, wäre schlimmer als keiner.
    expect(zeitenImText('4 Stunden marinieren')).toEqual([]);
    expect(zeitenImText('3 Stunden schmoren')).toEqual([180]);
  });
});
