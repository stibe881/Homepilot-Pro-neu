import { GRILLTIMER_MINUTEN, grilltimer, grilltimerText } from './grilltimer';

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

  it('bietet die Stufen an, nach denen beim Grillen gefragt wird', () => {
    expect(GRILLTIMER_MINUTEN[0]).toBe(5);
    expect(GRILLTIMER_MINUTEN).toContain(90);
  });
});
