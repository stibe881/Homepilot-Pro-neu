/** Welche Widget-Knöpfe direkt schalten dürfen – und welche nie. */
import { Entity } from '../api/types';
import { WidgetButton, darfDirekt, mitDirekt } from './widgetButtons';

const entities = [
  { id: 'hue.flur', kind: 'light', name: 'Licht Flur', commands: ['toggle'] },
  { id: 'nuki.tuer', kind: 'lock', name: 'Haustüre', commands: ['unlatch'] },
] as Entity[];

const knopf = (key: string): WidgetButton => ({
  key,
  title: key,
  symbol: 'power',
  url: `homepilot://${key}`,
});

describe('darfDirekt', () => {
  it('erlaubt Szenen und Lichter, nie Tür oder Alarm', () => {
    expect(darfDirekt('scene:kino', entities)).toBe(true);
    expect(darfDirekt('entity:hue.flur', entities)).toBe(true);
    expect(darfDirekt('entity:nuki.tuer', entities)).toBe(false);
    expect(darfDirekt('door', entities)).toBe(false);
    expect(darfDirekt('alarm', entities)).toBe(false);
    expect(darfDirekt('alloff', entities)).toBe(false);
  });
});

describe('mitDirekt', () => {
  it('hängt Pfad und Body an erlaubte, gewählte Knöpfe', () => {
    const [szene, licht] = mitDirekt(
      [knopf('scene:kino'), knopf('entity:hue.flur')],
      ['scene:kino', 'entity:hue.flur'],
      entities,
      true
    );
    expect(szene.direct).toBe(true);
    expect(szene.actionPath).toBe('/api/scenes/kino/activate');
    expect(licht.actionPath).toBe('/api/entities/hue.flur/command');
    expect(JSON.parse(licht.actionBody!)).toEqual({ command: 'toggle' });
  });

  it('streicht alles Direkte, wenn der Hausstand aus ist', () => {
    // Direkt schalten braucht das Token in der App-Gruppe – und das
    // liegt nur dort, wenn man sich für den Hausstand entschieden hat.
    const [szene] = mitDirekt([{ ...knopf('scene:kino'), direct: true }], ['scene:kino'], entities, false);
    expect(szene.direct).toBeUndefined();
    expect(szene.actionPath).toBeUndefined();
  });

  it('ignoriert gewählte Schlüssel, die nicht dürfen', () => {
    const [tuer] = mitDirekt([knopf('door')], ['door'], entities, true);
    expect(tuer.direct).toBeUndefined();
  });
});
