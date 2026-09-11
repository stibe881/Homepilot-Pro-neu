/**
 * Die Schriftgrössen des Wandpanels (Punkt 445 der Werkbank).
 *
 * Der Fall: Das Panel im Flur bekam das Telefonlayout mit mehr Spalten -
 * dieselben Schriftgrössen, nur breiter verteilt. Eine 13-Punkt-Zeile,
 * die man in der Hand liest, ist an der Wand ein grauer Strich.
 */
import { PANEL_MASS, type, typFuer } from '../theme';

describe('Das Wandpanel schreibt grösser', () => {
  it('lässt das Telefon, wie es war', () => {
    expect(typFuer(false)).toBe(type);
  });

  it('vergrössert jede Stufe um dasselbe Mass', () => {
    const panel = typFuer(true);
    for (const name of Object.keys(type) as (keyof typeof type)[]) {
      expect(panel[name]).toBe(Math.round(type[name] * PANEL_MASS));
      expect(panel[name]).toBeGreaterThan(type[name]);
    }
  });

  it('bleibt bei ganzen Punkten', () => {
    // Halbe Punkte ändern auf keinem Bildschirm etwas, und zwei fast
    // gleiche Grössen nebeneinander sehen unruhig aus.
    for (const groesse of Object.values(typFuer(true))) {
      expect(Number.isInteger(groesse)).toBe(true);
    }
  });

  it('hält das Mass in einem Rahmen, der noch Kacheln übrig lässt', () => {
    // Grösser heisst auch weniger auf dem Bildschirm. Ein Panel, das
    // drei Kacheln zeigt statt zwölf, ist kein Panel mehr.
    expect(PANEL_MASS).toBeGreaterThan(1);
    expect(PANEL_MASS).toBeLessThanOrEqual(1.35);
  });
});
