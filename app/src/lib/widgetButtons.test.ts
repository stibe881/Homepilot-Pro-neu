import { Entity } from '../api/types';
import { direktMoeglich, standardDirekt } from './widgetButtons';


describe('Warum ein Widget-Knopf nicht schaltet', () => {
  /**
   * Der gemeldete Fall: «Mit den Widgets steuert man nichts, es öffnet
   * sich nur die App.» Beides konnte zutreffen – der Knopf durfte nicht,
   * oder der Hausstand war aus. Unterschieden hat die App es nicht, und
   * gesagt hat sie gar nichts.
   */
  const lampe: Entity = {
    id: 'hue.wohnzimmer',
    kind: 'light',
    name: 'Licht Wohnzimmer',
    integration: 'hue',
    state: { state: 'off' },
    commands: ['toggle'],
  } as Entity;

  const tuer: Entity = {
    id: 'nuki.haustuer',
    kind: 'lock',
    name: 'Haustüre',
    integration: 'nuki',
    state: { state: 'locked' },
    commands: ['unlock', 'open_door'],
  } as Entity;

  it('geht bei einem Licht, sobald der Hausstand an ist', () => {
    expect(direktMoeglich('entity:hue.wohnzimmer', [lampe], true)).toBe('geht');
  });

  it('nennt den fehlenden Hausstand beim Namen', () => {
    expect(direktMoeglich('entity:hue.wohnzimmer', [lampe], false)).toBe('kein-hausstand');
  });

  it('nennt beim Schloss die Rückfrage als Grund – nicht «geht nicht»', () => {
    // Der gemeldete Fall die zweite: zwei Schlösser auf dem Widget,
    // jeder Tipp öffnete nur die App. Der Grund war die Tür-Rückfrage,
    // und die App soll ihn beim Namen nennen können.
    expect(direktMoeglich('entity:nuki.haustuer', [tuer], true)).toBe('rueckfrage');
    expect(direktMoeglich('entity:nuki.haustuer', [tuer], true, true)).toBe('geht');
    // «Alles aus» bleibt endgültig verboten, das ist keine Rückfrage-Sache.
    expect(direktMoeglich('alloff', [tuer], true, true)).toBe('nicht-erlaubt');
  });

  it('nimmt ohne eigene Wahl alles, was darf', () => {
    expect(
      standardDirekt(['entity:hue.wohnzimmer', 'entity:nuki.haustuer'], [lampe, tuer])
    ).toEqual(['entity:hue.wohnzimmer']);
    // Ohne Rückfrage rutscht das Schloss in die Vorgabe mit hinein.
    expect(
      standardDirekt(['entity:hue.wohnzimmer', 'entity:nuki.haustuer'], [lampe, tuer], true)
    ).toEqual(['entity:hue.wohnzimmer', 'entity:nuki.haustuer']);
    // Szenen dürfen immer.
    expect(standardDirekt(['scene:kino'], [])).toEqual(['scene:kino']);
  });
});
