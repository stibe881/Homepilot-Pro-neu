/**
 * Wer welchen Bereich sieht.
 *
 * Der Anlass: «Mitbewohner sollen in den Einstellungen auch die Geräte
 * sehen.» Die Liste gibt Auskunft über das Haus – wer darin wohnt, darf
 * sie haben; ein Gast nicht.
 */
import { Bereich, siehtBereich } from './einstellungsmenue';

const BESITZERIN = [
  'control',
  'view_history',
  'view_automations',
  'pause_automations',
  'edit_automations',
  'view_system',
  'manage_users',
  'edit_config',
];
const MITBEWOHNER = [
  'control',
  'view_history',
  'view_automations',
  'pause_automations',
  'view_system',
];
const GAST = ['control'];

const sichtbar = (rechte: string[]) =>
  (
    [
      'search',
      'users',
      'automations',
      'alarm',
      'devices',
      'speakers',
      'energy',
      'system',
      'activity',
      'widgets',
      'account',
    ] as Bereich[]
  ).filter((bereich) => siehtBereich(rechte, bereich));

describe('siehtBereich', () => {
  it('zeigt Mitbewohnern die Geräteliste', () => {
    // Sie verändert nichts, sie gibt Auskunft: was im Haus steht, wie
    // die Batterien stehen, wann etwas zuletzt gesehen wurde.
    expect(siehtBereich(MITBEWOHNER, 'devices')).toBe(true);
  });

  it('lässt Gäste draussen', () => {
    // «Gäste dürfen bedienen, aber nichts über das Haus erfahren»
    // (hub/core/users.py).
    expect(siehtBereich(GAST, 'devices')).toBe(false);
    expect(sichtbar(GAST)).toEqual(['search', 'widgets', 'account']);
  });

  it('behält die Einrichtung bei der Besitzerin', () => {
    for (const bereich of ['users', 'alarm', 'speakers', 'energy', 'system', 'activity'] as Bereich[]) {
      expect(siehtBereich(MITBEWOHNER, bereich)).toBe(false);
      expect(siehtBereich(BESITZERIN, bereich)).toBe(true);
    }
  });

  it('gibt der Besitzerin alles, auch ohne das genaue Recht', () => {
    // Sie darf ohnehin jeden Knopf drücken; eine Liste, in der ihr
    // etwas fehlt, wäre nur verwirrend.
    expect(siehtBereich(['manage_users'], 'devices')).toBe(true);
    expect(siehtBereich(['manage_users'], 'automations')).toBe(true);
  });

  it('zeigt jedem, was ihm selbst gehört', () => {
    for (const rechte of [BESITZERIN, MITBEWOHNER, GAST]) {
      expect(siehtBereich(rechte, 'search')).toBe(true);
      expect(siehtBereich(rechte, 'widgets')).toBe(true);
      expect(siehtBereich(rechte, 'account')).toBe(true);
    }
  });

  it('nennt für Mitbewohner genau die drei Bereiche mehr', () => {
    expect(sichtbar(MITBEWOHNER)).toEqual([
      'search',
      'automations',
      'devices',
      'widgets',
      'account',
    ]);
  });
});
