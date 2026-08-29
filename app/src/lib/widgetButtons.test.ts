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
    commands: ['unlock'],
  } as Entity;

  it('geht bei einem Licht, sobald der Hausstand an ist', () => {
    expect(direktMoeglich('entity:hue.wohnzimmer', [lampe], true)).toBe('geht');
  });

  it('nennt den fehlenden Hausstand beim Namen', () => {
    expect(direktMoeglich('entity:hue.wohnzimmer', [lampe], false)).toBe('kein-hausstand');
  });

  it('bleibt bei Tür und Alarm beim Umweg – auch mit Hausstand', () => {
    expect(direktMoeglich('entity:nuki.haustuer', [tuer], true)).toBe('nicht-erlaubt');
  });

  it('nimmt ohne eigene Wahl alles, was darf', () => {
    expect(
      standardDirekt(['entity:hue.wohnzimmer', 'entity:nuki.haustuer'], [lampe, tuer])
    ).toEqual(['entity:hue.wohnzimmer']);
    // Szenen dürfen immer.
    expect(standardDirekt(['scene:kino'], [])).toEqual(['scene:kino']);
  });
});
