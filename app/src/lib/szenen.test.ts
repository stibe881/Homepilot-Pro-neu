/**
 * Der Szenen-Schnappschuss und seine Umkehrung.
 *
 * Der Fall dahinter: Die Szene «Kino» – gedimmt auf 15 % – liess sich in
 * der App nicht bauen, weil der Schnappschuss nur an/aus einsammelte.
 */
import { Entity } from '../api/types';
import { sceneActionsToDraft, snapshotAction, snapshotCommand } from './szenen';

const licht = (state: Entity['state'], commands: string[]): Entity =>
  ({
    id: 'hue.stehlampe',
    kind: 'light',
    name: 'Stehlampe',
    integration: 'hue',
    state,
    commands,
    available: true,
    room: 'Wohnzimmer',
  }) as Entity;

describe('snapshotAction', () => {
  it('nimmt die Helligkeit mit, nicht nur «an»', () => {
    const action = snapshotAction(
      licht({ state: 'on', brightness: 15 }, ['turn_on', 'turn_off', 'set_brightness'])
    );
    expect(action.command).toBe('set_brightness');
    expect(action.brightness).toBe(15);
  });

  it('nimmt die Farbe mit, wenn das Licht eine hat', () => {
    const action = snapshotAction(
      licht({ state: 'on', brightness: 40, color: '#FF8800' }, [
        'turn_on',
        'set_brightness',
        'set_color',
      ])
    );
    expect(action.color).toBe('#FF8800');
  });

  it('bleibt bei an/aus, wo es nichts zu dimmen gibt', () => {
    expect(snapshotAction(licht({ state: 'on' }, ['turn_on', 'turn_off'])).command).toBe(
      'turn_on'
    );
    expect(
      snapshotAction(licht({ state: 'off', brightness: 40 }, ['turn_on', 'set_brightness']))
        .command
    ).toBe('turn_off');
  });

  it('macht aus dem aktuellen Alarm-Modus den passenden Befehl', () => {
    const alarm = (state: Entity['state']) =>
      ({
        id: 'alarm.haus',
        kind: 'alarm',
        name: 'Alarmanlage',
        integration: 'alarm',
        state,
        commands: ['arm_night', 'arm_away', 'arm_vacation', 'disarm'],
        available: true,
      }) as Entity;
    expect(snapshotCommand(alarm({ state: 'unscharf' }))).toBe('disarm');
    expect(snapshotCommand(alarm({ state: 'scharf', mode: 'nacht' }))).toBe('arm_night');
    expect(snapshotCommand(alarm({ state: 'scharf', mode: 'urlaub' }))).toBe('arm_vacation');
  });
});

describe('sceneActionsToDraft', () => {
  it('liest die Werte aus data zurück – die Position ging vorher verloren', () => {
    const draft = sceneActionsToDraft([
      { entity_id: 'overkiz.store', command: 'set_position', data: { position: 50 } },
      { entity_id: 'hue.stehlampe', command: 'set_brightness', data: { brightness: 15 } },
    ]);
    expect(draft[0].position).toBe(50);
    expect(draft[1].brightness).toBe(15);
  });

  it('hängt die set_color-Zeile zurück an ihr Licht', () => {
    const draft = sceneActionsToDraft([
      { entity_id: 'hue.stehlampe', command: 'set_brightness', data: { brightness: 15 } },
      { entity_id: 'hue.stehlampe', command: 'set_color', data: { color: '#FF8800' } },
    ]);
    // Ein Eintrag, nicht zwei – sonst stünde das Licht doppelt in der Liste.
    expect(draft).toHaveLength(1);
    expect(draft[0].color).toBe('#FF8800');
  });
});
