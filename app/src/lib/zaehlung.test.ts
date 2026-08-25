/**
 * Was oben mitzählt.
 *
 * Der Anlass: «Wenn man lange auf eine Licht- oder Schalter-Kachel
 * drückt, soll man die Option haben, dass es hier nicht angezeigt wird»
 * – gemeint war die «3 an» in der Kopfzeile.
 */
import { Entity } from '../api/types';
import { gezaehlteLichter, zaehlbar, zaehltMit } from './zaehlung';

const geraet = (id: string, kind: string, state = 'on', extra = {}): Entity =>
  ({ id, name: id, kind, integration: 'demo', state: { state }, commands: [], ...extra }) as
    unknown as Entity;

describe('zaehltMit', () => {
  it('zählt eingeschaltetes Licht und Schalter', () => {
    expect(zaehltMit(geraet('light.kueche', 'light'), [], [])).toBe(true);
    expect(zaehltMit(geraet('switch.kaffee', 'switch'), [], [])).toBe(true);
  });

  it('zählt nichts Ausgeschaltetes und nichts anderes', () => {
    expect(zaehltMit(geraet('light.kueche', 'light', 'off'), [], [])).toBe(false);
    expect(zaehltMit(geraet('camera.tuere', 'camera'), [], [])).toBe(false);
  });

  it('lässt weg, was ausgeblendet ist', () => {
    expect(zaehltMit(geraet('light.kueche', 'light'), ['light.kueche'], [])).toBe(false);
  });

  it('lässt weg, was nicht mitzählen soll – ohne es auszublenden', () => {
    // Der Kühlschrank, die Umwälzpumpe, ein Grow-Licht: Sie sollen auf
    // der Startseite bleiben, aber nicht als «brennt noch etwas»
    // gezählt werden.
    const grow = geraet('switch.grow', 'switch');
    expect(zaehltMit(grow, [], ['switch.grow'])).toBe(false);
    // Und das ist etwas anderes als ausblenden: Die Kachel bleibt.
    expect(zaehltMit(grow, [], [])).toBe(true);
  });

  it('zählt eine Deckenlampe einmal, nicht sechsmal', () => {
    const spot = geraet('hue.spot_1', 'light', 'on', { combined_into: 'group.decke' });
    expect(zaehltMit(spot, [], [])).toBe(false);
  });
});

describe('gezaehlteLichter', () => {
  it('gibt die Geräte hinter der Zahl', () => {
    const alle = [
      geraet('light.kueche', 'light'),
      geraet('light.bad', 'light', 'off'),
      geraet('switch.grow', 'switch'),
      geraet('camera.tuere', 'camera'),
    ];
    expect(gezaehlteLichter(alle, [], []).map((e) => e.id)).toEqual([
      'light.kueche',
      'switch.grow',
    ]);
    expect(gezaehlteLichter(alle, [], ['switch.grow']).map((e) => e.id)).toEqual([
      'light.kueche',
    ]);
  });
});

describe('zaehlbar', () => {
  it('bietet die Wahl nur dort an, wo sie etwas bewirkt', () => {
    // Ein Eintrag im Menü einer Kamera wäre ein Knopf ohne Wirkung.
    expect(zaehlbar({ kind: 'light' })).toBe(true);
    expect(zaehlbar({ kind: 'switch' })).toBe(true);
    expect(zaehlbar({ kind: 'camera' })).toBe(false);
    expect(zaehlbar({})).toBe(false);
  });
});
