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
import { PRIVATSPHAERE_AUS, PRIVATSPHAERE_EIN } from '../../lib/szenen';
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
    return nimm([
      ['play', 'Musik an'],
      ['pause', 'Musik aus'],
    ]);
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

