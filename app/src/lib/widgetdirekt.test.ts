/** Welche Widget-Knöpfe direkt schalten dürfen – und welche nie. */
import { Entity } from '../api/types';
import { WidgetButton, darfDirekt, mitDirekt } from './widgetButtons';

const entities = [
  { id: 'hue.flur', kind: 'light', name: 'Licht Flur', commands: ['toggle'] },
  { id: 'nuki.tuer', kind: 'lock', name: 'Haustüre', commands: ['open_door', 'unlatch'] },
  // Ein Schloss, das nur ver- und entriegelt - das darf nie direkt.
  { id: 'hm.riegel', kind: 'lock', name: 'Kellerriegel', commands: ['lock', 'unlock'] },
] as Entity[];

const knopf = (key: string): WidgetButton => ({
  key,
  title: key,
  symbol: 'power',
  url: `homepilot://${key}`,
});

describe('darfDirekt', () => {
  it('erlaubt Szenen und Lichter, mit Rückfrage aber keine Schlösser', () => {
    expect(darfDirekt('scene:kino', entities)).toBe(true);
    expect(darfDirekt('entity:hue.flur', entities)).toBe(true);
    expect(darfDirekt('entity:nuki.tuer', entities)).toBe(false);
    expect(darfDirekt('door', entities)).toBe(false);
    expect(darfDirekt('alarm', entities)).toBe(false);
    expect(darfDirekt('alloff', entities)).toBe(false);
  });

  it('lässt Schlösser direkt öffnen, sobald die Tür-Rückfrage aus ist', () => {
    // Die abgestellte Rückfrage gilt überall - auch am Widget.
    expect(darfDirekt('entity:nuki.tuer', entities, true)).toBe(true);
    expect(darfDirekt('door', entities, true)).toBe(true);
    // Nur öffnende Schlösser: Ein reiner Riegel bekäme sonst einen
    // Befehl geschickt, den er nicht kennt.
    expect(darfDirekt('entity:hm.riegel', entities, true)).toBe(false);
    // «Alles aus» und Alarm behalten den Umweg immer.
    expect(darfDirekt('alarm', entities, true)).toBe(false);
    expect(darfDirekt('alloff', entities, true)).toBe(false);
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

  it('hängt der Haustüre den Türbefehl an, wenn die Rückfrage aus ist', () => {
    const [abkuerzung, schloss] = mitDirekt(
      [knopf('door'), knopf('entity:nuki.tuer')],
      ['door', 'entity:nuki.tuer'],
      entities,
      true,
      true
    );
    // Die Abkürzung «door» zielt auf dieselbe Türe wie die Uhr.
    expect(abkuerzung.direct).toBe(true);
    expect(abkuerzung.actionPath).toBe('/api/entities/nuki.tuer/command');
    expect(JSON.parse(abkuerzung.actionBody!)).toEqual({ command: 'open_door' });
    expect(schloss.direct).toBe(true);
    expect(JSON.parse(schloss.actionBody!)).toEqual({ command: 'open_door' });
  });
});
