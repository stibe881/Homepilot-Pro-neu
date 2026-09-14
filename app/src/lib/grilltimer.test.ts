import { grilltimer, grilltimerText, minutenAusEingabe, minutenSchritt } from './grilltimer';

describe('grilltimer', () => {
  it('erkennt den Timer des Grills an seinem Text', () => {
    // Punkt 561: Der Hub führt Timer ohne Herkunft - der Text ist die
    // einzige Spur, die Speichern und Neustart übersteht.
    const timers = [
      { id: 'a', text: 'Pasta', ends_at: 200 },
      { id: 'b', text: 'Smoker – nachsehen', ends_at: 300 },
      { id: 'c', text: 'Smoker – nachsehen', ends_at: 100 },
    ];
    expect(grilltimer(timers, 'Smoker').map((t) => t.id)).toEqual(['c', 'b']);
    expect(grilltimer(timers, 'Räucherschrank')).toEqual([]);
    expect(grilltimer(undefined, 'Smoker')).toEqual([]);
  });

  it('macht aus dem Namen einen Satz, der auch als Push verständlich ist', () => {
    expect(grilltimerText('Smoker')).toBe('Smoker – nachsehen');
    expect(grilltimerText('  ')).toBe('Grill – nachsehen');
  });

  it('nimmt die Dauer, wie man sie tippt', () => {
    // Punkt 568: selber stellen statt Vorauswahl - «45», «1:30», «1h30».
    expect(minutenAusEingabe('45')).toBe(45);
    expect(minutenAusEingabe(' 1:30 ')).toBe(90);
    expect(minutenAusEingabe('1h30')).toBe(90);
    expect(minutenAusEingabe('1 h')).toBe(60);
    expect(minutenAusEingabe('1.5h')).toBe(90);
  });

  it('lehnt ab, was kein Timer werden kann', () => {
    expect(minutenAusEingabe('')).toBeNull();
    expect(minutenAusEingabe('0')).toBeNull();
    expect(minutenAusEingabe('abc')).toBeNull();
    // Länger als der Küchen-Timer des Hubs kann.
    expect(minutenAusEingabe('200')).toBeNull();
  });

  it('schreitet mit − und + in Fünfern, innerhalb der Grenzen', () => {
    expect(minutenSchritt(30, 1)).toBe(35);
    expect(minutenSchritt(3, -1)).toBe(1);
    expect(minutenSchritt(178, 1)).toBe(180);
  });
});
