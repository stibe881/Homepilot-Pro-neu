import { Entity } from '../api/types';
import { tuerKnopfWerte } from './widget';

/**
 * Der Öffnen-Knopf auf der Sperrbildschirm-Karte umgeht Entsperren,
 * Face ID und Rückfrage - was in seine Ablage kommt, muss deshalb
 * exakt stimmen: die richtige Türe, der richtige Befehl, und ohne
 * Opt-in gar nichts.
 */

function schloss(teil: Partial<Entity>): Entity {
  return {
    id: 'nuki.tuere',
    kind: 'lock',
    name: 'Haustüre',
    integration: 'nuki',
    state: {},
    commands: ['unlatch', 'open_door'],
    available: true,
    ...teil,
  } as Entity;
}

const einstellungen = { url: 'http://hub.local:8100/', token: 'geheim' };

test('die Ablage traegt Tuere, Befehl und Zugang', () => {
  const werte = tuerKnopfWerte(einstellungen, [schloss({})]);
  expect(werte).toEqual({
    tuerKnopf: '1',
    tuerUrl: 'http://hub.local:8100',
    tuerToken: 'geheim',
    tuerPfad: '/api/entities/nuki.tuere/command',
    tuerBefehl: JSON.stringify({ command: 'open_door' }),
  });
});

test('ohne Tuere gibt es nichts zu hinterlegen', () => {
  // Blick und Timer der Watch kommen ohne Schloss aus - der Türknopf
  // nicht: Ein Knopf, der ins Leere zielt, gehört gar nicht erst hin.
  expect(tuerKnopfWerte(einstellungen, [])).toBeNull();
});

test('ohne Zugangsdaten gibt es nichts zu hinterlegen', () => {
  expect(tuerKnopfWerte({ url: '', token: 'x' }, [schloss({})])).toBeNull();
});
