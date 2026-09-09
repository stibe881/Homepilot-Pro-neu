/**
 * Wofür ein Gerät steht – die Zuordnung, an der die Abläufe hängen.
 *
 * Der Fall, den diese Tests festhalten: Eine zusammengefasste Leuchte
 * sieht in der Liste aus wie ein weiteres Licht, ist aber die
 * Fernbedienung für fünf. Wer das nicht sieht, schaltet im Ablauf einen
 * einzelnen Spot statt der Deckenlampe.
 */
import type { Entity } from '../api/types';
import {
  deviceKindIcon,
  deviceKindLabel,
  isTelevision,
  kachelHerkunft,
  melderArt,
  zeigtStopp,
} from './geraeteart';

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

  it('sagt Türe und Fenster, wo die Integration es weiss', () => {
    // «Fenster-/Türkontakt» bleibt für Homematic, das den Unterschied
    // nicht kennt. Zigbee und Matter kennen ihn - und an der
    // Alarmanlage entscheidet genau er, was nachts mitwacht.
    const melder = (klasse: string) =>
      deviceKindLabel(geraet({ kind: 'binary_sensor', state: { device_class: klasse } }));
    expect(melder('door')).toBe('Türkontakt');
    expect(melder('window')).toBe('Fensterkontakt');
    expect(melder('vibration')).toBe('Erschütterungsmelder');
    expect(melder('occupancy')).toBe('Präsenzmelder');
  });

  it('sagt bei unklarer Melderart lieber das Allgemeine', () => {
    expect(deviceKindLabel(geraet({ kind: 'binary_sensor' }))).toBe('Melder');
  });

  it('trennt Anwesenheit von Bewegung – und vom WLAN', () => {
    // Anwesenheit sagt, ob jemand zuhause ist – nicht, ob sich etwas
    // bewegt. Und ein Gerät im WLAN ist beides nicht: Das iPad hängt
    // auch dann im Netz, wenn alle weg sind.
    expect(deviceKindLabel(geraet({ kind: 'binary_sensor', integration: 'geofence' })))
      .toBe('Anwesenheit');
    expect(deviceKindLabel(geraet({ kind: 'binary_sensor', integration: 'unifi' })))
      .toBe('Gerät im WLAN');
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

describe('Lichtszenen der Bridge', () => {
  it('heissen «Lichtszene» und nicht «Szene»', () => {
    // Die Szenen des Hubs stehen in der App an anderer Stelle. Zwei
    // Dinge desselben Namens nebeneinander sind eines zu viel.
    const szene = geraet({ kind: 'scene', integration: 'hue', commands: ['activate'] });
    expect(deviceKindLabel(szene)).toBe('Lichtszene');
    expect(deviceKindIcon(szene)).toBe('color-palette-outline');
  });
});

describe('zeigtStopp', () => {
  const box = (state: string, commands: string[] = ['play', 'pause', 'turn_off']) =>
    geraet({ kind: 'media_player', commands, state: { state } });

  it('steht auf Boxen mit laufender oder pausierter Sitzung', () => {
    expect(zeigtStopp(box('playing'))).toBe(true);
    // Gerade die pausierte Sitzung besetzt die Box, ohne dass man es
    // hört - dort ist Stopp am wertvollsten.
    expect(zeigtStopp(box('paused'))).toBe(true);
    expect(zeigtStopp(box('buffering'))).toBe(true);
  });

  it('fehlt im Leerlauf - da gibt es nichts zu beenden', () => {
    expect(zeigtStopp(box('idle'))).toBe(false);
    expect(zeigtStopp(box('off'))).toBe(false);
  });

  it('fehlt, wo Pause schon das Ende ist (Spotify, Radio)', () => {
    // Beide kennen kein turn_off: Ihre Pause beendet die Wiedergabe.
    expect(zeigtStopp(box('playing', ['play', 'pause', 'play_on']))).toBe(false);
  });
});

describe('melderArt', () => {
  const kontakt = geraet({
    id: 'z2m.balkontuere',
    kind: 'binary_sensor',
    state: { device_class: 'door' },
  });

  it('nennt Wort und Symbol zu einem Sensor der Alarmanlage', () => {
    const art = melderArt(
      { entity_id: 'z2m.balkontuere', kind: 'binary_sensor', device_class: 'door' },
      [kontakt]
    );
    expect(art.label).toBe('Türkontakt');
    expect(art.icon).toBe('log-in-outline');
  });

  it('zieht die volle Entität der knappen Liste vor', () => {
    // Der Geofence ist ein binärer Melder wie jeder andere - dass er
    // Anwesenheit meldet und keine Bewegung, weiss nur die Entität.
    const geofence = geraet({
      id: 'geofence.zuhause',
      kind: 'binary_sensor',
      integration: 'geofence',
    });
    const art = melderArt(
      { entity_id: 'geofence.zuhause', kind: 'binary_sensor', device_class: null },
      [geofence]
    );
    expect(art.label).toBe('Anwesenheit');
  });

  it('kommt auch ohne die Entität zu einer Antwort', () => {
    // Die Liste der Alarmanlage kommt vom Hub und kann Geräte nennen,
    // die in der Entitätenliste dieses Bildschirms fehlen. Dann lieber
    // die Art aus den mitgelieferten Feldern als gar keine.
    const art = melderArt(
      { entity_id: 'fehlt.im.haus', kind: 'binary_sensor', device_class: 'motion' },
      []
    );
    expect(art.label).toBe('Bewegungsmelder');
  });
});

describe('kachelHerkunft', () => {
  const store = (patch: Partial<Entity>): Entity =>
    ({
      id: 'overkiz.x',
      kind: 'cover',
      name: 'Sofa',
      integration: 'overkiz',
      state: {},
      commands: [],
      available: true,
      ...patch,
    }) as Entity;

  it('nennt den Raum, wenn es einen gibt', () => {
    expect(kachelHerkunft(store({ room: 'Wohnzimmer' }))).toBe('Wohnzimmer');
  });

  it('sagt bei fehlendem Raum genau das - nicht «overkiz»', () => {
    // Gefragt aus dem Haus: «Weshalb steht bei manchen Storen das Zimmer
    // und bei manchen die Integration?» Der Name eines Programmteils ist
    // keine Auskunft über ein Gerät.
    expect(kachelHerkunft(store({ room: null }))).toBe('ohne Raum');
    expect(kachelHerkunft(store({}))).toBe('ohne Raum');
  });

  it('nennt Art und Raum, wo Gerät und Raum gleich heissen', () => {
    // Zuerst stand hier nur die Art: «Essbereich» über «Essbereich» ist
    // dieselbe Auskunft zweimal. Aus dem Haus kam dazu, dass die Zeile
    // damit als Einzige die Frage «wo steht das?» nicht mehr
    // beantwortet - und die Kachel aussieht, als hätte sie keinen Raum.
    expect(kachelHerkunft(store({ name: 'Essbereich', room: 'Essbereich' }))).toBe(
      'Store / Rollladen · Essbereich'
    );
    // Gross- und Kleinschreibung zählt dabei nicht; hingeschrieben wird
    // der Raum so, wie er im Haus heisst.
    expect(kachelHerkunft(store({ name: 'Terrasse', room: 'terrasse' }))).toBe(
      'Store / Rollladen · terrasse'
    );
  });
});
