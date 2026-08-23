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
import { PRIVATSPHAERE_AUS, PRIVATSPHAERE_EIN } from '../../lib/szenen';
import { baseCommandOptions, isSceneDevice } from './szenengeraete';

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
