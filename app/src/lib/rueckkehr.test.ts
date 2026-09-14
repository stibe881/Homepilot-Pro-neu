import { RUECKKEHR_NACH, darfZurueck } from './rueckkehr';

describe('darfZurueck', () => {
  it('kehrt nach drei Minuten ohne Berührung zurück', () => {
    expect(darfZurueck(RUECKKEHR_NACH + 1, 0, false)).toBe(true);
    expect(darfZurueck(RUECKKEHR_NACH, 0, false)).toBe(false);
  });

  it('zählt eine Berührung im Blatt wie eine auf der Seite', () => {
    // Der Fall aus Punkt 582: Der Tipp kam aus dem Kochmodus, einem
    // Modal - er muss die Uhr genauso zurückstellen.
    const beruehrtImBlatt = 100_000;
    expect(darfZurueck(beruehrtImBlatt + RUECKKEHR_NACH, beruehrtImBlatt, false)).toBe(false);
  });

  it('bleibt aus, solange ein Blatt wach hält', () => {
    // Beim Kochen, beim Klingeln und am Grill springt das Panel nicht
    // mittendrin auf die Startseite - egal wie lange niemand tippt.
    expect(darfZurueck(RUECKKEHR_NACH * 10, 0, true)).toBe(false);
  });
});
