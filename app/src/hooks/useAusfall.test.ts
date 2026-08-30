/**
 * Die Gnadenfrist vor dem Ausfall-Balken.
 *
 * Der Fall aus dem Haus: «Ich muss meistens zweimal klicken.» Der
 * Balken erschien bei jedem Öffnen der App für die ein, zwei Sekunden
 * des Neu-Verbindens, schob die Seite nach unten und liess sie beim
 * Verschwinden zurückspringen - der erste Tipp traf den Inhalt im
 * Sprung.
 */
import { GNADE_MS, restGnade } from './useAusfall';

describe('restGnade', () => {
  it('meldet nichts, solange die Verbindung steht', () => {
    expect(restGnade(null, 1_000_000)).toBeNull();
  });

  it('lässt dem Neu-Verbinden beim Aufwachen seine Zeit', () => {
    // Eine Sekunde nach der Trennung fehlt noch der Rest der Frist -
    // der Balken bleibt weg, die Kopfzeile sagt derweil «verbinde …».
    expect(restGnade(1_000_000, 1_001_000)).toBe(GNADE_MS - 1000);
  });

  it('zeigt einen echten Ausfall nach der Frist', () => {
    expect(restGnade(1_000_000, 1_000_000 + GNADE_MS)).toBe(0);
    expect(restGnade(1_000_000, 1_000_000 + GNADE_MS + 5000)).toBe(0);
  });
});
