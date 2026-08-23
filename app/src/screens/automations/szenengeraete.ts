/**
 * Welche Geräte in eine Szene dürfen – und was sich mit ihnen anstellen
 * lässt (rein, testbar).
 *
 * Herausgelöst aus dem Szenen-Editor, weil genau hier ein Fehler wohnte,
 * den man nur mit einem bestimmten Gerät sieht: Kameras standen nicht in
 * der Auswahl. In den Abläufen standen sie – deren Geräteliste filtert
 * gar nicht –, in den Szenen nicht, denn hier prüfte eine von Hand
 * gepflegte Liste von Gerätearten. Wer eine vergisst, dessen Gerät
 * verschwindet lautlos.
 *
 * In der Bildschirm-Datei liess sich das nicht prüfen: Sie zieht die
 * Symbolschriften von Expo mit, und Jest lädt sie deshalb nicht.
 */

import { Entity } from '../../api/types';
import {
  PRIVATSPHAERE_AUS,
  PRIVATSPHAERE_EIN,
  STUMM_AUS,
  STUMM_EIN,
} from '../../lib/szenen';
import { vacuumRooms } from './entwurf';

/** Ein Gerät, das in eine Szene gehört (rein, testbar).
 *
 * Die Frage ist nicht «welche Geräteart ist das», sondern «lässt sich
 * damit überhaupt etwas anstellen». Beides fiel früher auseinander: Hier
 * stand eine von Hand gepflegte Liste von Arten, und wer eine vergass,
 * dessen Gerät verschwand aus dem Szenen-Editor – während es in den
 * Abläufen selbstverständlich dastand, denn deren Auswahl filtert gar
 * nicht. Die Alarmanlage fiel schon einmal so durchs Sieb; danach eine
 * Art mehr einzutragen behebt den Fall, nicht die Ursache.
 *
 * Deshalb entscheidet jetzt dasselbe, was auch die Chips füllt: Gibt es
 * mindestens einen Zielzustand anzubieten, gehört das Gerät in die
 * Liste. Gibt es keinen, wäre die Zeile eine Attrappe.
 */
export function isSceneDevice(entity: Entity): boolean {
  return baseCommandOptions(entity).length > 0;
}

export function commandOptions(
  entity: Entity,
  allowToggle = false
): { key: string; label: string }[] {
  const options = baseCommandOptions(entity);
  // Nur anbieten, wo das Gerät es wirklich kann – Storen etwa können es nicht.
  if (allowToggle && entity.commands.includes('toggle')) {
    options.push({ key: 'toggle', label: 'umschalten' });
  }
  return options;
}

export function baseCommandOptions(entity: Entity): { key: string; label: string }[] {
  // Nur anbieten, was das Gerät wirklich kann: Der Hub weist jeden Befehl
  // ab, der nicht in `commands` steht (UnsupportedCommandError). Ein Chip
  // dafür wäre ein Knopf, der nichts tut.
  const kann = (command: string) => entity.commands.includes(command);
  const nimm = (paare: [string, string][]) =>
    paare.filter(([key]) => kann(key)).map(([key, label]) => ({ key, label }));

  if (entity.kind === 'cover') {
    return nimm([
      ['open', 'hoch'],
      ['close', 'runter'],
      // Halb runter für den Hitzeschutz – ganz zu wäre dunkel, ganz auf heiss.
      ['set_position', 'auf Position'],
    ]);
  }
  if (entity.kind === 'lock') {
    return nimm([
      ['lock', 'abschliessen'],
      ['unlock', 'aufschliessen'],
    ]);
  }
  if (entity.kind === 'vacuum') {
    const options = nimm([
      ['start', 'saugen'],
      ['dock', 'zur Station'],
    ]);
    if (kann('clean_rooms') && vacuumRooms(entity).length > 0) {
      options.push({ key: 'clean_rooms', label: 'Räume saugen' });
    }
    return options;
  }
  if (entity.kind === 'camera') {
    // Kameras bleiben sonst lesend; der Privatsphäre-Modus ist die eine
    // Ausnahme (schwarze Zone, Mikrofon stumm, Aufnahme aus). Genau
    // dafür baut man eine Szene «wir sind da».
    if (!kann('set_privacy')) return [];
    return [
      { key: PRIVATSPHAERE_EIN, label: 'Privatsphäre ein' },
      { key: PRIVATSPHAERE_AUS, label: 'Privatsphäre aus' },
    ];
  }
  if (entity.kind === 'media_player') {
    // «An» und «aus» nur, wo es sie gibt: Ein Fernseher lässt sich
    // schalten, eine Cast-Box hat keinen Netzschalter.
    const options = nimm([
      ['turn_on', 'ein'],
      ['turn_off', 'aus'],
      ['play', 'Musik an'],
      ['pause', 'Musik aus'],
      ['set_volume', 'Lautstärke'],
    ]);
    if (kann('mute')) {
      options.push({ key: STUMM_EIN, label: 'stumm' }, { key: STUMM_AUS, label: 'Ton an' });
    }
    // Playlist und App nur, wenn das Gerät welche meldet – eine leere
    // Auswahl anzubieten ist schlimmer als keine.
    if (kann('play_playlist') && playlistsVon(entity).length > 0) {
      options.push({ key: 'play_playlist', label: 'Playlist' });
    }
    if (kann('launch_app') && appsVon(entity).length > 0) {
      options.push({ key: 'launch_app', label: 'App' });
    }
    return options;
  }
  if (entity.kind === 'alarm') {
    // Dieselben Namen wie auf dem Alarm-Bildschirm – «scharf (Nacht)»
    // statt arm_night, damit niemand raten muss, was ein Modus tut.
    return nimm([
      ['arm_night', 'scharf (Nacht)'],
      ['arm_away', 'scharf (Ausser Haus)'],
      ['arm_vacation', 'scharf (Urlaub)'],
      ['disarm', 'unscharf'],
    ]);
  }

  // Alles Übrige nach seinen Befehlen. So kommt auch ein Gerät mit, dessen
  // Art hier nie jemand eingetragen hat – und ein Fühler ohne Befehle
  // bleibt draussen, statt ein wirkungsloses «ein/aus» zu bekommen.
  return nimm([
    ['turn_on', 'ein'],
    // «ein mit Helligkeit» nur, wo das Gerät wirklich dimmen kann – ein
    // Schalter mit Helligkeitsregler wäre ein Knopf, der nichts tut.
    ['set_brightness', 'ein, gedimmt'],
    ['turn_off', 'aus'],
  ]);
}



/** Die Playlists, die dieses Gerät meldet (rein, testbar).
 *
 * Spotify schickt sie als Namen mit; ein Gerät ohne Playlists bekommt
 * keinen Chip dafür. */
export function playlistsVon(entity: Entity): string[] {
  const roh = entity.state?.playlists;
  return Array.isArray(roh) ? roh.map((name) => String(name)).filter(Boolean) : [];
}

/** Die Apps, die dieses Gerät anbietet (rein, testbar).
 *
 * Der Fernseher meldet sie als {name, app} – der Name steht auf dem
 * Knopf, die Paket-ID geht an den Hub. */
export function appsVon(entity: Entity): { name: string; app: string }[] {
  const roh = entity.state?.apps;
  if (!Array.isArray(roh)) return [];
  return roh
    .map((eintrag) => ({
      name: String((eintrag as { name?: unknown })?.name ?? ''),
      app: String((eintrag as { app?: unknown })?.app ?? ''),
    }))
    .filter((eintrag) => eintrag.app);
}


/** Die Boxen, auf denen dieses Gerät spielen kann (rein, testbar).
 *
 * Spotify meldet seine Connect-Geräte samt schlafender Cast-Boxen. Ohne
 * Ziel spielt eine Playlist dort, wo zuletzt Musik lief – in einer Szene
 * «Kino» ist das eine Wette. Google-Home-Boxen tauchen genau hier auf:
 * Sie können selbst keine Playlist starten, wohl aber eine empfangen.
 */
export function boxenVon(entity: Entity): string[] {
  const roh = entity.state?.devices;
  return Array.isArray(roh) ? roh.map((name) => String(name)).filter(Boolean) : [];
}
