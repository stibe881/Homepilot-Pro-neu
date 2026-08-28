import { Entity } from '../api/types';
import { haustuerFuerWatch, watchKontext } from './watchkontext';

function geraet(teil: Partial<Entity>): Entity {
  return {
    id: 'x',
    kind: 'lock',
    name: 'Schloss',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...teil,
  } as Entity;
}

describe('haustuerFuerWatch', () => {
  test('das Schloss mit open_door gewinnt gegen das blosse Schloss', () => {
    const bloss = geraet({ id: 'lock.keller', commands: ['unlatch'] });
    const tuer = geraet({ id: 'lock.haustuere', commands: ['unlatch', 'open_door'] });
    expect(haustuerFuerWatch([bloss, tuer])?.id).toBe('lock.haustuere');
  });

  test('ohne open_door tut es irgendein Schloss', () => {
    const bloss = geraet({ id: 'lock.keller', commands: ['unlatch'] });
    expect(haustuerFuerWatch([bloss])?.id).toBe('lock.keller');
  });

  test('ohne Schloss gibt es keine Tuere', () => {
    const licht = geraet({ id: 'light.kueche', kind: 'light' });
    expect(haustuerFuerWatch([licht])).toBeNull();
  });
});

describe('watchKontext', () => {
  const einstellungen = { url: 'http://hub.local:8100/', token: 'geheim' };

  test('ohne Zugangsdaten gibt es nichts zu schicken', () => {
    expect(watchKontext({ url: '', token: 'x' }, [])).toBeNull();
    expect(watchKontext({ url: 'http://hub', token: '' }, [])).toBeNull();
  });

  test('mit Tuere reisen Pfad und Befehl als Text mit', () => {
    const tuer = geraet({
      id: 'nuki.tuere',
      name: 'Haustüre',
      commands: ['unlatch', 'open_door'],
    });
    const kontext = watchKontext(einstellungen, [tuer]);
    expect(kontext).toEqual({
      hubUrl: 'http://hub.local:8100',
      token: 'geheim',
      doorLabel: 'Haustüre',
      doorPath: '/api/entities/nuki.tuere/command',
      doorBody: JSON.stringify({ command: 'open_door' }),
    });
  });

  test('ohne open_door bleibt unlatch', () => {
    const tuer = geraet({ id: 'l1', commands: ['unlatch'] });
    const kontext = watchKontext(einstellungen, [tuer]);
    expect(kontext?.doorBody).toBe(JSON.stringify({ command: 'unlatch' }));
  });

  test('ohne Schloss geht der Rest trotzdem hinueber', () => {
    const kontext = watchKontext(einstellungen, []);
    expect(kontext?.hubUrl).toBe('http://hub.local:8100');
    expect(kontext?.doorPath).toBe('');
    expect(kontext?.doorLabel).toBe('');
  });
});
