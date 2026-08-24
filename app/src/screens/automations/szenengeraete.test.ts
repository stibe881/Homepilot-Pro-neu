/**
 * Welche Geräte in eine Szene dürfen – und was sich mit ihnen anstellen
 * lässt.
 *
 * Der Fall: In den Abläufen stand jedes Gerät zur Auswahl, in den Szenen
 * nur ein Teil. Die Ablauf-Auswahl filtert nämlich gar nicht, die
 * Szenen-Auswahl prüfte gegen eine von Hand gepflegte Liste von
 * Gerätearten. Wer eine vergass – Kameras –, dessen Gerät verschwand.
 */
import { Entity } from '../../api/types';
import { PRIVATSPHAERE_AUS, PRIVATSPHAERE_EIN, STUMM_AUS, STUMM_EIN } from '../../lib/szenen';
import {
  appsVon,
  baseCommandOptions,
  boxenVon,
  commandOptions,
  imSchnappschuss,
  isSceneDevice,
  mischenMoeglich,
  playlistWahl,
  playlistsVon,
} from './szenengeraete';

const geraet = (kind: string, commands: string[], state = {}): Entity =>
  ({
    id: `x.${kind}`,
    name: kind,
    kind,
    integration: 'x',
    commands,
    state,
  }) as unknown as Entity;

const schluessel = (entity: Entity) => baseCommandOptions(entity).map((o) => o.key);

describe('isSceneDevice', () => {
  it('nimmt eine Kamera mit Privatsphäre-Schalter auf', () => {
    // Der Anlass: «eine Szene, bei der die Kamera die Privatsphäre
    // aktiviert und Musik läuft.»
    expect(isSceneDevice(geraet('camera', ['set_privacy']))).toBe(true);
  });

  it('lässt eine Kamera ohne diesen Schalter draussen', () => {
    expect(isSceneDevice(geraet('camera', []))).toBe(false);
  });

  it('nimmt weiterhin Licht, Schalter, Storen, Schloss, Boxen, Sauger und Alarm', () => {
    expect(isSceneDevice(geraet('light', ['turn_on', 'turn_off']))).toBe(true);
    expect(isSceneDevice(geraet('switch', ['turn_on', 'turn_off']))).toBe(true);
    expect(isSceneDevice(geraet('cover', ['open', 'close']))).toBe(true);
    expect(isSceneDevice(geraet('lock', ['lock', 'unlock']))).toBe(true);
    expect(isSceneDevice(geraet('media_player', ['play', 'pause']))).toBe(true);
    expect(isSceneDevice(geraet('vacuum', ['start', 'dock']))).toBe(true);
    expect(isSceneDevice(geraet('alarm', ['arm_night', 'disarm']))).toBe(true);
  });

  it('nimmt eine Hue-Szene auf – sonst liesse sie sich in keine Szene legen', () => {
    expect(isSceneDevice(geraet('scene', ['activate']))).toBe(true);
  });

  it('nimmt auch eine Geräteart auf, die hier niemand eingetragen hat', () => {
    // Genau das war die Ursache: eine Liste, die veraltet. Was schalten
    // kann, gehört hinein – ohne dass jemand sie pflegen muss.
    expect(isSceneDevice(geraet('waermepumpe', ['turn_on', 'turn_off']))).toBe(true);
  });

  it('lässt draussen, was gar nichts kann', () => {
    expect(isSceneDevice(geraet('sensor', []))).toBe(false);
    expect(isSceneDevice(geraet('weather', []))).toBe(false);
    expect(isSceneDevice(geraet('appliance', []))).toBe(false);
  });
});

describe('baseCommandOptions', () => {
  it('bietet der Kamera beide Richtungen an', () => {
    expect(schluessel(geraet('camera', ['set_privacy']))).toEqual([
      PRIVATSPHAERE_EIN,
      PRIVATSPHAERE_AUS,
    ]);
  });

  it('bietet nichts an, was das Gerät nicht kann', () => {
    // Der Hub weist einen unbekannten Befehl ab – ein Chip dafür wäre
    // ein Knopf, der nichts tut.
    expect(schluessel(geraet('cover', ['open']))).toEqual(['open']);
    expect(schluessel(geraet('lock', ['lock']))).toEqual(['lock']);
    expect(schluessel(geraet('alarm', ['arm_night', 'disarm']))).toEqual([
      'arm_night',
      'disarm',
    ]);
  });

  it('bietet «gedimmt» nur an, wo wirklich gedimmt werden kann', () => {
    expect(schluessel(geraet('light', ['turn_on', 'turn_off']))).toEqual([
      'turn_on',
      'turn_off',
    ]);
    expect(schluessel(geraet('light', ['turn_on', 'set_brightness', 'turn_off']))).toEqual([
      'turn_on',
      'set_brightness',
      'turn_off',
    ]);
  });

  it('bietet «Räume saugen» nur mit bekannten Räumen an', () => {
    const ohne = geraet('vacuum', ['start', 'dock', 'clean_rooms']);
    expect(schluessel(ohne)).toEqual(['start', 'dock']);
    const mit = geraet('vacuum', ['start', 'dock', 'clean_rooms'], {
      rooms: [{ id: 1, name: 'Küche' }],
    });
    expect(schluessel(mit)).toContain('clean_rooms');
  });

  it('gibt für einen Fühler eine leere Liste statt eines wirkungslosen Ein/Aus', () => {
    expect(schluessel(geraet('sensor', []))).toEqual([]);
  });
});

// ── Lautsprecher ─────────────────────────────────────────────────────────
// «Musik an / Musik aus» war alles. Für eine Szene «Kino» fehlten
// Lautstärke und was gespielt wird – beides kann der Hub längst.

const box = (commands: string[], state: Record<string, unknown> = {}) =>
  geraet('media_player', commands, state);

describe('Lautsprecher in einer Szene', () => {
  it('bietet Lautstärke und stumm an, wo das Gerät es kann', () => {
    expect(schluessel(box(['play', 'pause', 'set_volume', 'mute']))).toEqual([
      'play',
      'pause',
      'set_volume',
      STUMM_EIN,
      STUMM_AUS,
    ]);
  });

  it('bietet «ein» und «aus» nur beim Fernseher an', () => {
    // Eine Cast-Box hat keinen Netzschalter.
    expect(schluessel(box(['play', 'pause']))).toEqual(['play', 'pause']);
    expect(schluessel(box(['turn_on', 'turn_off', 'play', 'pause']))).toEqual([
      'turn_on',
      'turn_off',
      'play',
      'pause',
    ]);
  });

  it('macht aus der Playlist keinen zweiten Chip neben «Musik an»', () => {
    // Zwei Chips waren zwei Antworten auf dieselbe Frage: Wer «Musik an»
    // wählte, sah keine Playlist und suchte sie dort, wo sie nicht war.
    // Sie hängt jetzt an «Musik an» – `playlistWahl` sagt, ob es sie gibt.
    expect(schluessel(box(['play', 'play_playlist']))).toEqual(['play']);
    expect(
      schluessel(box(['play', 'play_playlist'], { playlists: ['Sonntagmorgen'] }))
    ).toEqual(['play']);
  });

  it('bietet die Playlist-Wahl nur an, wenn das Gerät welche meldet', () => {
    expect(playlistWahl(box(['play', 'play_playlist']))).toBe(false);
    expect(
      playlistWahl(box(['play', 'play_playlist'], { playlists: ['Sonntagmorgen'] }))
    ).toBe(true);
    // Eine Google-Home-Box kann keine Playlist starten – sie ist Ziel,
    // nicht Quelle.
    expect(playlistWahl(box(['play', 'pause'], { playlists: ['Sonntagmorgen'] }))).toBe(
      false
    );
  });

  it('fragt nach der Reihenfolge nur, wo sich mischen lässt', () => {
    expect(mischenMoeglich(box(['play', 'play_playlist', 'shuffle']))).toBe(true);
    expect(mischenMoeglich(box(['play', 'play_playlist']))).toBe(false);
  });

  it('bietet die App nur an, wenn der Fernseher welche kennt', () => {
    expect(schluessel(box(['play', 'launch_app']))).toEqual(['play']);
    expect(
      schluessel(
        box(['play', 'launch_app'], { apps: [{ name: 'Netflix', app: 'com.netflix.ninja' }] })
      )
    ).toContain('launch_app');
  });
});

describe('playlistsVon und appsVon', () => {
  it('liest die Namen der Playlists', () => {
    expect(playlistsVon(box([], { playlists: ['A', 'B'] }))).toEqual(['A', 'B']);
  });

  it('verträgt fehlende oder unsinnige Angaben', () => {
    expect(playlistsVon(box([]))).toEqual([]);
    expect(playlistsVon(box([], { playlists: 'keine Liste' }))).toEqual([]);
    expect(appsVon(box([]))).toEqual([]);
  });

  it('wirft Apps ohne Paket-ID weg – auf ihnen liesse sich nichts starten', () => {
    const apps = appsVon(
      box([], {
        apps: [
          { name: 'Netflix', app: 'com.netflix.ninja' },
          { name: 'Kaputt' },
        ],
      })
    );
    expect(apps).toEqual([{ name: 'Netflix', app: 'com.netflix.ninja' }]);
  });
});

describe('boxenVon', () => {
  it('liest die Boxen, auf denen gespielt werden kann', () => {
    // Google-Home-Boxen tauchen genau hier auf: Sie starten selbst keine
    // Playlist, empfangen aber eine.
    expect(boxenVon(box([], { devices: ['Küche', 'Wohnzimmer'] }))).toEqual([
      'Küche',
      'Wohnzimmer',
    ]);
  });

  it('verträgt fehlende Angaben', () => {
    expect(boxenVon(box([]))).toEqual([]);
    expect(boxenVon(box([], { devices: 'keine Liste' }))).toEqual([]);
  });
});

describe('Lichtszenen der Bridge', () => {
  it('bieten genau eine Handlung an: aufrufen', () => {
    const szene = geraet('scene', ['activate']);
    expect(baseCommandOptions(szene)).toEqual([{ key: 'activate', label: 'aufrufen' }]);
  });

  it('bekommen kein «umschalten» – die Bridge kann eine Szene nicht zurücknehmen', () => {
    expect(commandOptions(geraet('scene', ['activate']), true)).toEqual([
      { key: 'activate', label: 'aufrufen' },
    ]);
  });
});

describe('imSchnappschuss', () => {
  it('sammelt Alarmanlage, Kamera und Lichtszene nicht von selbst ein', () => {
    // Jede aus demselben Grund: Was sie ungefragt in die Szene brächten,
    // hat niemand gewollt – «unscharf», «Privatsphäre aus», und eine
    // Hue-Szene, die gerade gar nicht gilt.
    expect(imSchnappschuss(geraet('alarm', ['disarm']))).toBe(false);
    expect(imSchnappschuss(geraet('camera', ['set_privacy']))).toBe(false);
    expect(imSchnappschuss(geraet('scene', ['activate']))).toBe(false);
  });

  it('lässt alles andere mit', () => {
    expect(imSchnappschuss(geraet('light', ['turn_on']))).toBe(true);
    expect(imSchnappschuss(geraet('cover', ['open']))).toBe(true);
  });
});

