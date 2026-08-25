/**
 * Wohin ein gezogener Eintrag fällt.
 *
 * Der Fehler, wegen dem es diese Datei gibt, lag in der Geste: Der
 * PanResponder wurde bei jeder Fingerbewegung neu gebaut und verlor
 * dabei den Startpunkt. Gemeldet wurde deshalb nie der ganze Weg,
 * sondern der letzte Wimpernschlag – die Zeile rührte sich kaum, und
 * beim Loslassen war das Ziel dieselbe Stelle. Das lässt sich nur im
 * Browser prüfen; hier steht die Rechnung dahinter, damit wenigstens
 * sie festgehalten ist.
 */
import { ROW, verschoben, zielIndex } from './ziehen';

describe('zielIndex', () => {
  it('rundet auf die nächste Zeile, statt abzuschneiden', () => {
    // Zwei Drittel einer Zeilenhöhe meint die nächste Zeile.
    expect(zielIndex(0, ROW * 0.7, 4)).toBe(1);
    expect(zielIndex(0, ROW * 0.4, 4)).toBe(0);
    expect(zielIndex(3, -ROW * 2, 4)).toBe(1);
  });

  it('bleibt in der Liste', () => {
    expect(zielIndex(0, -ROW * 10, 4)).toBe(0);
    expect(zielIndex(3, ROW * 10, 4)).toBe(3);
  });

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(zielIndex(0, ROW, 0)).toBe(0);
  });

  it('meldet den winzigen Weg, den der kaputte Responder lieferte', () => {
    // Genau das kam vorher an: zwölf Punkte statt zweihundert. Die
    // Rechnung ist unschuldig – bei diesem Weg *ist* das Ziel dieselbe
    // Stelle, und deshalb sah es aus, als ginge das Ziehen nicht.
    expect(zielIndex(3, -12, 4)).toBe(3);
    expect(zielIndex(3, -204, 4)).toBe(0);
  });
});

describe('verschoben', () => {
  it('setzt den Eintrag an die neue Stelle', () => {
    expect(verschoben(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(verschoben(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('sagt «nichts geändert», wenn nichts zu ändern ist', () => {
    // Dann muss auch nichts gespeichert werden.
    expect(verschoben(['a', 'b'], 1, 1)).toBeNull();
    expect(verschoben(['a', 'b'], 5, 0)).toBeNull();
    expect(verschoben([], 0, 0)).toBeNull();
  });
});
