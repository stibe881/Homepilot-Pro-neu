/** Der Ein-Wort-Zustand der Raumfliesen - besonders der Storen. */
import { Entity } from '../api/types';
import { shortState } from './RoomTile';

const store = (state: Record<string, unknown>, commands: string[]): Entity =>
  ({
    id: 'cover1',
    kind: 'cover',
    name: 'Store',
    integration: 'overkiz',
    state,
    commands,
    available: true,
  }) as Entity;

describe('shortState für Storen', () => {
  const lamellen = ['open', 'close', 'set_position', 'set_tilt'];

  it('sagt Beschattung statt «0% offen», wenn die Lamellen offen sind', () => {
    // Der Fall aus dem Essbereich: unten, aber hell. «0 % offen» war
    // die halbe Wahrheit - und ein anderes Wort als auf der
    // Gerätekachel, die «Beschattung» hervorhob.
    expect(shortState(store({ state: 'closed', position: 0, tilt: 50 }, lamellen))).toBe(
      'Beschattung'
    );
  });

  it('sagt Zu bei geschlossenen Lamellen und Offen bei oben', () => {
    expect(shortState(store({ state: 'closed', position: 0, tilt: 0 }, lamellen))).toBe(
      'Zu'
    );
    expect(shortState(store({ state: 'open', position: 100, tilt: 50 }, lamellen))).toBe(
      'Offen'
    );
  });

  it('bleibt dazwischen bei der Prozentzahl', () => {
    expect(shortState(store({ state: 'partial', position: 47 }, lamellen))).toBe(
      '47% offen'
    );
  });

  it('liest ein Rollo ohne Lamellen wie bisher', () => {
    expect(
      shortState(store({ state: 'closed', position: 0 }, ['open', 'close']))
    ).toBe('Zu');
    expect(shortState(store({ state: 'closed' }, ['open', 'close']))).toBe('Zu');
  });
});
