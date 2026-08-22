/**
 * Der Hinweis neben der Begrüssung: Was läuft, und wie lange noch?
 *
 * Der Fall dahinter: Am Geschirrspüler stand «noch 233 min». Richtig,
 * aber niemand rechnet das im Vorbeigehen in «kurz vor vier» um.
 */
import { Entity } from '../api/types';
import { workingAppliances } from './haushalt';

const geraet = (teile: Partial<Entity>): Entity =>
  ({
    id: 'vzug.spueler',
    name: 'Geschirrspüler',
    kind: 'appliance',
    state: {},
    commands: [],
    available: true,
    ...teile,
  }) as Entity;

describe('workingAppliances', () => {
  it('schreibt die Restzeit in Stunden und Minuten', () => {
    const [lauft] = workingAppliances([
      geraet({ state: { state: 'running', minutes_left: 233 } }),
    ]);
    expect(lauft.note).toBe('noch 3 h 53 min');
  });

  it('lässt kurze Restzeiten in Minuten stehen', () => {
    const [lauft] = workingAppliances([
      geraet({ state: { state: 'running', minutes_left: 12 } }),
    ]);
    expect(lauft.note).toBe('noch 12 min');
  });

  it('nennt ohne Restzeit das Programm', () => {
    const [lauft] = workingAppliances([
      geraet({ state: { state: 'running', program: 'Eco' } }),
    ]);
    expect(lauft.note).toBe('Eco');
  });

  it('zählt ein stilles Gerät nicht mit', () => {
    expect(workingAppliances([geraet({ state: { state: 'idle', minutes_left: 5 } }) ])).toEqual([]);
  });
});
