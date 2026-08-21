/**
 * Nachts soll das Wandpanel dunkler werden – aber nicht dunkel, und nicht
 * schlagartig.
 */
import { sunHours } from '../theme';
import { MAX_SCHLEIER, schleier } from './nachtabsenkung';

// 21. Juni in Zell LU: Sonnenaufgang gegen 5:30, Untergang gegen 21:20.
const sommer = (stunde: number, minute = 0) =>
  new Date(2026, 5, 21, stunde, minute, 0);
// 21. Dezember: Aufgang gegen 8:10, Untergang gegen 16:40.
const winter = (stunde: number, minute = 0) =>
  new Date(2026, 11, 21, stunde, minute, 0);

const LANGE_HER = 0;

describe('schleier', () => {
  it('liegt tagsüber nie über dem Bild', () => {
    expect(schleier(sommer(13), LANGE_HER, true, sommer(13).getTime())).toBe(0);
    expect(schleier(winter(12), LANGE_HER, true, winter(12).getTime())).toBe(0);
  });

  it('dunkelt tief in der Nacht am stärksten ab', () => {
    const d = schleier(sommer(2), LANGE_HER, true, sommer(2).getTime());
    expect(d).toBe(MAX_SCHLEIER);
  });

  it('lässt auch nachts noch etwas durch – ein Panel soll ablesbar bleiben', () => {
    expect(MAX_SCHLEIER).toBeLessThan(0.8);
  });

  it('blendet über, statt schlagartig aufzutauchen', () => {
    // Die Uhrzeiten aus dem Sonnenstand ableiten statt hinzuschreiben:
    // In einer anderen Zeitzone geht die Sonne zu einer anderen Stunde
    // unter, und der Test soll die Überblendung prüfen, nicht die Zone.
    const tag = winter(12);
    const sonne = sunHours(tag)!;
    const beiStunde = (h: number) => {
      const d = new Date(tag);
      d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
      return schleier(d, LANGE_HER, true, d.getTime());
    };
    // Zehn Minuten nach Sonnenuntergang: schon dunkler, aber noch nicht ganz.
    const frueh = beiStunde(sonne.sunset + 1 / 6);
    const spaet = beiStunde(sonne.sunset + 2);
    expect(frueh).toBeGreaterThan(0);
    expect(frueh).toBeLessThan(spaet);
    expect(spaet).toBe(MAX_SCHLEIER);
  });

  it('wird bei einer Berührung sofort hell', () => {
    const nacht = sommer(2);
    expect(schleier(nacht, nacht.getTime() - 1000, true, nacht.getTime())).toBe(0);
  });

  it('gilt nur im Wandpanel-Modus', () => {
    const nacht = sommer(2);
    expect(schleier(nacht, LANGE_HER, false, nacht.getTime())).toBe(0);
  });
});
