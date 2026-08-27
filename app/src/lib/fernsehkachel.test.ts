import { Entity } from '../api/types';
import { tvKopf, tvTeile } from './fernsehkachel';

const tv = (state: Record<string, unknown>, commands: string[] = []): Entity =>
  ({
    id: 'androidtv.wohnzimmer',
    kind: 'media_player',
    name: 'Fernseher Wohnzimmer',
    integration: 'androidtv',
    state,
    commands,
    available: true,
  }) as unknown as Entity;

describe('tvKopf', () => {
  it('nennt die App einmal, nicht zweimal', () => {
    // Der Android-TV meldet die laufende App als «track» und als «app».
    // Oben stand sie gross, darunter noch einmal in der Auswahl.
    expect(tvKopf(tv({ state: 'on', app: 'Plex', track: 'Plex' }))).toEqual({
      text: 'Plex',
      unter: null,
    });
  });

  it('stellt einen echten Titel voran und die App darunter', () => {
    // Am Chromecast läuft ein Film mit Namen - der ist die Auskunft.
    expect(
      tvKopf(tv({ state: 'playing', app: 'Netflix', track: 'Der Pate' }))
    ).toEqual({ text: 'Der Pate', unter: 'Netflix' });
  });

  it('sagt «Aus», sobald der Fernseher aus ist', () => {
    // Auch wenn der letzte Zustand noch eine App mitträgt.
    expect(tvKopf(tv({ state: 'off', app: 'Plex', track: 'Plex' })).text).toBe('Aus');
  });

  it('sagt wenigstens «An», wenn das Gerät nichts über sich verrät', () => {
    expect(tvKopf(tv({ state: 'on' })).text).toBe('An');
  });
});

describe('tvTeile', () => {
  const ALLES = [
    'next',
    'volume_up',
    'launch_app',
    'sleep_timer',
    'dpad_up',
  ];

  it('zeigt am laufenden Fernseher alles', () => {
    expect(tvTeile(tv({ state: 'on' }, ALLES))).toEqual({
      transport: true,
      lautstaerke: true,
      apps: true,
      timer: true,
      fernbedienung: true,
    });
  });

  it('lässt am dunklen Fernseher nur die App-Auswahl stehen', () => {
    // Sie weckt ihn und startet die App in einem Griff. Pause, Timer und
    // Steuerkreuz wären Knöpfe, die nichts tun.
    expect(tvTeile(tv({ state: 'off' }, ALLES))).toEqual({
      transport: false,
      lautstaerke: false,
      apps: true,
      timer: false,
      fernbedienung: false,
    });
  });

  it('lässt dem Schieber den Vortritt', () => {
    // Wer die Lautstärke setzen kann, bekommt den Balken - er sagt mehr
    // als zwei Knöpfe.
    expect(tvTeile(tv({ state: 'on' }, [...ALLES, 'set_volume'])).lautstaerke).toBe(
      false
    );
  });

  it('kommt mit einem Gerät ohne Befehlsliste zurecht', () => {
    const kaputt = { ...tv({ state: 'on' }), commands: undefined } as unknown as Entity;
    expect(tvTeile(kaputt).apps).toBe(false);
  });
});
