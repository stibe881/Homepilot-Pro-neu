/**
 * Wofür ein Gerät steht – die Zuordnung, an der die Abläufe hängen.
 *
 * Der Fall, den diese Tests festhalten: Eine zusammengefasste Leuchte
 * sieht in der Liste aus wie ein weiteres Licht, ist aber die
 * Fernbedienung für fünf. Wer das nicht sieht, schaltet im Ablauf einen
 * einzelnen Spot statt der Deckenlampe.
 */
import type { Entity } from '../api/types';
import { deviceKindIcon, deviceKindLabel, isTelevision } from './geraeteart';

function geraet(teile: Partial<Entity>): Entity {
  return {
    id: 'x.y',
    kind: 'light',
    name: 'Gerät',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...teile,
  } as Entity;
}

describe('isTelevision', () => {
  it('erkennt den Fernseher an den Knöpfen, nicht am Hersteller', () => {
    expect(isTelevision(geraet({ kind: 'media_player', commands: ['play', 'launch_app'] }))).toBe(true);
    expect(isTelevision(geraet({ kind: 'media_player', commands: ['play', 'dpad_up'] }))).toBe(true);
  });

  it('lässt den Chromecast eine Box sein', () => {
    // Er kann nur Ton abspielen – und genau dafür braucht ihn die Durchsage.
    const cast = geraet({
      kind: 'media_player',
      integration: 'google_cast',
      commands: ['play', 'pause', 'play_url'],
    });
    expect(isTelevision(cast)).toBe(false);
  });

  it('behauptet bei fehlender Befehlsliste nichts', () => {
    // Diese Prüfung läuft über jedes Medien-Gerät. Ein einziger
    // Ausrutscher darüber nähme den ganzen Player von der Startseite.
    const kaputt = geraet({ kind: 'media_player', commands: undefined as never });
    expect(isTelevision(kaputt)).toBe(false);
  });

  it('gilt nur für Medien-Geräte', () => {
    expect(isTelevision(geraet({ kind: 'light', commands: ['launch_app'] }))).toBe(false);
  });
});

describe('deviceKindLabel', () => {
  it('unterscheidet Leuchte, Licht und Teil einer Leuchte', () => {
    expect(deviceKindLabel(geraet({ kind: 'light', integration: 'group' })))
      .toBe('Leuchte (mehrere Lampen)');
    expect(deviceKindLabel(geraet({ kind: 'light', combined_into: 'group.decke' })))
      .toBe('Licht (Teil einer Leuchte)');
    expect(deviceKindLabel(geraet({ kind: 'light' }))).toBe('Licht');
  });

  it('nennt die Melderart, wenn der Hub sie mitschickt', () => {
    const melder = (klasse: string) =>
      deviceKindLabel(geraet({ kind: 'binary_sensor', state: { device_class: klasse } }));
    expect(melder('motion')).toBe('Bewegungsmelder');
    expect(melder('contact')).toBe('Fenster-/Türkontakt');
    expect(melder('smoke')).toBe('Rauchmelder');
    expect(melder('moisture')).toBe('Wassermelder');
  });

  it('sagt bei unklarer Melderart lieber das Allgemeine', () => {
    expect(deviceKindLabel(geraet({ kind: 'binary_sensor' }))).toBe('Melder');
  });

  it('trennt Anwesenheit von Bewegung', () => {
    // Sie sagt, ob jemand zuhause ist – nicht, ob sich etwas bewegt.
    expect(deviceKindLabel(geraet({ kind: 'binary_sensor', integration: 'geofence' })))
      .toBe('Anwesenheit (Standort)');
    expect(deviceKindLabel(geraet({ kind: 'binary_sensor', integration: 'unifi' })))
      .toBe('Anwesenheit (WLAN)');
  });

  it('erkennt den Messwert notfalls an der Einheit', () => {
    expect(deviceKindLabel(geraet({ kind: 'sensor', state: { unit: '°C' } })))
      .toBe('Temperaturfühler');
    expect(deviceKindLabel(geraet({ kind: 'sensor', state: { device_class: 'power' } })))
      .toBe('Verbrauchsmessung');
    expect(deviceKindLabel(geraet({ kind: 'sensor' }))).toBe('Messwert');
  });

  it('spricht die Sprache der Wohnung, nicht die des Hubs', () => {
    expect(deviceKindLabel(geraet({ kind: 'vacuum' }))).toBe('Saugroboter');
    expect(deviceKindLabel(geraet({ kind: 'cover' }))).toBe('Store / Rollladen');
    expect(deviceKindLabel(geraet({ kind: 'switch', integration: 'helpers' }))).toBe('Merker');
  });

  it('lässt sich von einer unbekannten Art nicht aus der Ruhe bringen', () => {
    expect(deviceKindLabel(geraet({ kind: 'irgendwas' }))).toBe('Gerät');
  });
});

describe('deviceKindIcon', () => {
  it('gibt Fernseher und Box verschiedene Symbole', () => {
    expect(deviceKindIcon(geraet({ kind: 'media_player', commands: ['launch_app'] })))
      .toBe('tv-outline');
    expect(deviceKindIcon(geraet({ kind: 'media_player', commands: ['play'] })))
      .toBe('musical-notes-outline');
  });

  it('hat für jede Art ein Symbol', () => {
    const arten = ['light', 'switch', 'binary_sensor', 'sensor', 'cover', 'lock',
                   'vacuum', 'camera', 'button', 'alarm', 'alert', 'appliance',
                   'weather', 'calendar', 'media_player', 'unbekannt'];
    for (const kind of arten) {
      expect(deviceKindIcon(geraet({ kind }))).toBeTruthy();
    }
  });
});
