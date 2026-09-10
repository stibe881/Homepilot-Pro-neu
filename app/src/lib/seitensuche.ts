/**
 * Die Einstellungsseiten mitsuchen – «wo stelle ich die Nachtruhe ein?»
 *
 * Das Suchfeld findet Geräte, Szenen, Abläufe und Räume. Was es nicht
 * findet, ist die App selbst: Wer die Ruhezeit sucht, muss wissen, dass
 * sie unter «Konto» in der Karte «Benachrichtigungen» steht. Das weiss,
 * wer sie eingebaut hat, und sonst niemand.
 *
 * Also gehören die Seiten in dieselbe Suche. Mit **Stichwörtern**, denn
 * der Name allein hilft nicht: Niemand tippt «Konto», wenn er die
 * Nachtruhe sucht, und niemand tippt «System», wenn er wissen will, ob
 * ein Update bereitliegt. Die Stichwörter sind die Wörter, die man
 * *stattdessen* tippt.
 *
 * Sie stehen hier und nicht in der Seitenhilfe daneben: Die Hilfe
 * erklärt eine Seite, an der man schon steht; hier geht es um jemanden,
 * der sie noch sucht. Zwei Fragen, zwei Listen - dass beide Wörter über
 * dieselben Seiten enthalten, ist Absicht und kein Grund, sie
 * zusammenzulegen.
 *
 * Reine Daten und reines Rechnen; wer sucht, ist GlobalSearch.
 */
import { SECTION_LABEL, type Section } from './bereiche';

/**
 * Was man tippt, wenn man diese Seite sucht.
 *
 * Jedes Wort hier ist eine Frage, die im Haus wirklich gestellt wurde -
 * oder eine, die man beim Bauen selbst hatte, weil man den Menüpunkt
 * nicht mehr fand.
 */
export const STICHWORTE: Partial<Record<Section, string[]>> = {
  account: [
    'benachrichtigungen',
    'push',
    'ruhezeit',
    'nachtruhe',
    'stumm',
    'abbestellen',
    'erscheinungsbild',
    'darstellung',
    'farben',
    'thema',
    'passwort',
    'abmelden',
  ],
  connection: ['hub', 'adresse', 'token', 'verbindung', 'anmeldung', 'server'],
  devices: [
    'geräte',
    'batterie',
    'batterien',
    'ausgeblendet',
    'favoriten',
    'raum zuordnen',
    'umbenennen',
    'neu gefunden',
    'leuchtengruppe',
  ],
  automations: ['abläufe', 'automation', 'regel', 'auslöser', 'pausieren', 'szene'],
  alarm: [
    'alarm',
    'alarmanlage',
    'scharf',
    'sirene',
    'pin',
    'sensoren',
    'einbruch',
    'panik',
    'sabotage',
  ],
  system: [
    'update',
    'aktualisieren',
    'version',
    'neustart',
    'protokoll',
    'speicherplatz',
    'integrationen',
    'backup',
    'sicherung',
  ],
  users: ['benutzer', 'rollen', 'gast', 'einladung', 'rechte', 'berechtigung'],
  personen: ['familie', 'freunde', 'ortung', 'anwesenheit', 'geofence', 'personen'],
  speakers: ['lautsprecher', 'boxen', 'durchsage', 'musik', 'lautstärke'],
  energy: ['energie', 'strom', 'verbrauch', 'kosten', 'kilowatt'],
  widgets: ['widget', 'sperrbildschirm', 'kurzbefehl', 'auto', 'carplay'],
  activity: ['verlauf', 'protokoll', 'ereignisse', 'was ist passiert'],
  besuch: ['besuch', 'gäste', 'babysitter', 'gäste-wlan', 'wlan'],
  cameras: ['kamera', 'kameras', 'aufnahme', 'clip', 'klingel'],
  covers: ['storen', 'rollladen', 'beschattung', 'jalousie'],
  light: ['licht', 'lampen', 'helligkeit', 'szenen'],
  family: [
    'einkaufsliste',
    'ämtli',
    'aufgaben',
    'kalender',
    'gutscheine',
    'rezepte',
    'medikamente',
  ],
};

export interface Seitentreffer {
  section: Section;
  label: string;
  /** Das Wort, wegen dem die Seite gefunden wurde - oder ihr Name. */
  wegen: string;
}

/**
 * Welche Seiten zu dieser Eingabe passen (rein, testbar).
 *
 * Der Name zählt mehr als ein Stichwort: Wer «Alarm» tippt, meint die
 * Alarmseite und nicht die Geräteliste, in der «Alarm» als Stichwort
 * stünde. Und es kommt zurück, *weswegen* getroffen wurde - «Geräte ·
 * Batterie» sagt einem, dass man richtig ist, «Geräte» allein nicht.
 */
export function seitenSuchen(
  query: string,
  erlaubt: (section: Section) => boolean = () => true
): Seitentreffer[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const treffer: { eintrag: Seitentreffer; rang: number }[] = [];
  for (const [key, worte] of Object.entries(STICHWORTE)) {
    const section = key as Section;
    if (!erlaubt(section)) continue;
    const label = SECTION_LABEL[section] ?? section;

    if (label.toLowerCase().includes(needle)) {
      treffer.push({
        eintrag: { section, label, wegen: label },
        rang: label.toLowerCase().startsWith(needle) ? 0 : 1,
      });
      continue;
    }
    const wort = (worte ?? []).find((eintrag) => eintrag.includes(needle));
    if (wort) {
      treffer.push({
        eintrag: { section, label, wegen: wort },
        rang: wort.startsWith(needle) ? 2 : 3,
      });
    }
  }
  return treffer.sort((a, b) => a.rang - b.rang).map((zeile) => zeile.eintrag);
}
