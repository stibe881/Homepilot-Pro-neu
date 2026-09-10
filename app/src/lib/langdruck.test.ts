import { ABSICHT, NORMAL, SCHNELL, dauer, hinweis } from './langdruck';

describe('dauer', () => {
  it('gibt jeder Absicht ihre Zahl', () => {
    expect(dauer('schnell')).toBe(SCHNELL);
    expect(dauer('normal')).toBe(NORMAL);
    expect(dauer('absicht')).toBe(ABSICHT);
  });

  it('hält die Reihenfolge ein', () => {
    // Der Sinn der drei Stufen: Je mehr auf dem Spiel steht, desto
    // länger hält man. Andersherum wäre es eine Falle.
    expect(SCHNELL).toBeLessThan(NORMAL);
    expect(NORMAL).toBeLessThan(ABSICHT);
  });

  it('bleibt beim Öffnen unter einer halben Sekunde', () => {
    // Kurz genug, dass es sich wie ein Teil des Tippens anfühlt.
    expect(SCHNELL).toBeLessThan(500);
  });

  it('macht das Absichtsvolle lang genug für einen Daumen beim Scrollen', () => {
    expect(ABSICHT).toBeGreaterThanOrEqual(1500);
  });
});

describe('hinweis', () => {
  it('sagt der Vorlesehilfe, dass es die Geste gibt', () => {
    // Ohne das ist ein Langdruck-Menü für jemanden, der die App
    // vorlesen lässt, schlicht nicht da.
    expect(hinweis('Öffnet das Menü')).toContain('Gedrückt halten');
  });

  it('nennt die zwei Sekunden, wo es sie braucht', () => {
    expect(hinweis('Löst Alarm aus', 'absicht')).toContain('Zwei Sekunden');
  });
});
