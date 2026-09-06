import { besitzerZahl, darfRolleAendern, eineZimmerwahl, zimmerPatch } from './rollenwahl';

const gast = { name: 'Livia', role: 'gast', editable: true };
const besitzer = { name: 'Stibe', role: 'besitzer', editable: true };
const kind = { name: 'Levin', role: 'kind', editable: true };

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

describe('darfRolleAendern mit der Rolle «kind»', () => {
  it('behandelt Kinder nach denselben Schutzregeln wie alle', () => {
    // Punkt 245: Die neue Rolle bringt keine neuen Schranken mit -
    // eigene Rolle nie, letzter Besitzer nie, sonst frei.
    expect(darfRolleAendern(kind, 'Stibe', 1)).toEqual({ erlaubt: true });
    expect(darfRolleAendern({ ...kind, editable: false }, 'Stibe', 1).erlaubt).toBe(
      false
    );
  });
});

describe('eineZimmerwahl', () => {
  it('gilt genau für die Rolle «kind»', () => {
    // Nur dort spiegelt der Hub rooms und simple_rooms (kid_rooms) -
    // zwei getrennte Klappen wären tote Bedienung.
    expect(eineZimmerwahl('kind')).toBe(true);
    expect(eineZimmerwahl('gast')).toBe(false);
    expect(eineZimmerwahl('bewohner')).toBe(false);
    expect(eineZimmerwahl('besitzer')).toBe(false);
  });
});

describe('zimmerPatch', () => {
  it('schickt beide Felder mit derselben Liste', () => {
    // Der Rückgriff des Hubs füllt nur das LEERE Feld - ein alter Wert
    // im anderen liesse Ansicht und Schranke auseinanderlaufen.
    expect(zimmerPatch(['Kinderzimmer'])).toEqual({
      rooms: ['Kinderzimmer'],
      simple_rooms: ['Kinderzimmer'],
    });
  });

  it('hängt nicht an der übergebenen Liste', () => {
    const zimmer = ['Kinderzimmer'];
    const patch = zimmerPatch(zimmer);
    zimmer.push('Flur');
    expect(patch.rooms).toEqual(['Kinderzimmer']);
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
