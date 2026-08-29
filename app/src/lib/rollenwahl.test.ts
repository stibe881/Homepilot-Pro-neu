import { besitzerZahl, darfRolleAendern } from './rollenwahl';

const gast = { name: 'Livia', role: 'gast', editable: true };
const besitzer = { name: 'Stibe', role: 'besitzer', editable: true };

describe('darfRolleAendern', () => {
  it('lässt den Besitzer eine Rolle ändern', () => {
    expect(darfRolleAendern(gast, 'Stibe', 1)).toEqual({ erlaubt: true });
  });

  it('lässt die Datei die Wahrheit sein', () => {
    // Eine Änderung, die der nächste Neustart zurückdreht, wäre schlimmer
    // als die Fehlermeldung.
    const urteil = darfRolleAendern({ ...gast, editable: false }, 'Stibe', 2);
    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toContain('config.yaml');
  });

  it('lässt niemanden an der eigenen Rolle drehen', () => {
    const urteil = darfRolleAendern(besitzer, 'Stibe', 2);
    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toContain('eigene');
  });

  it('hält den letzten Besitzer fest', () => {
    // Ein Haus ohne Besitzer verwaltet niemand mehr.
    const urteil = darfRolleAendern(besitzer, 'Bine', 1);
    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toContain('letzte Besitzer');
    // Mit einem zweiten geht es.
    expect(darfRolleAendern(besitzer, 'Bine', 2).erlaubt).toBe(true);
  });
});

describe('besitzerZahl', () => {
  it('zählt, wer das Haus verwalten darf', () => {
    expect(
      besitzerZahl([{ role: 'besitzer' }, { role: 'bewohner' }, { role: 'besitzer' }])
    ).toBe(2);
    expect(besitzerZahl([])).toBe(0);
  });
});
