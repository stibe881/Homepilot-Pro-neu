import { Entity } from '../api/types';
import { ablageBefund, tuerKnopfWerte } from './widget';

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

test('die beiden stummen Faelle der Ablage bleiben auseinander', () => {
  // «Das Widget zeigt meine Knöpfe nicht» hat zwei Ursachen mit zwei
  // Abhilfen: Hülle ohne Ablage-Modul (TestFlight-Build nötig) und
  // App-Gruppe ohne Portal-Eintrag (Apple-Portal, dann Build). Eine
  // Anzeige, die beide zusammenwarf, schickte einen ins Portal, wenn
  // ein Build fällig war.
  expect(ablageBefund(false, false)).toBe('huelle-alt');
  // Ohne Modul ist auch ein «gelesen» nichts wert - es kam von der
  // Attrappe, nicht aus der geteilten Ablage.
  expect(ablageBefund(false, true)).toBe('huelle-alt');
  expect(ablageBefund(true, false)).toBe('fehlt');
  expect(ablageBefund(true, true)).toBe('ok');
});
