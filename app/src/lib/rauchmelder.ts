/**
 * Rauchwarnmelder: kein Platz im Zimmer, dafür eine eigene Liste.
 *
 * Im Raum stand je Melder eine Kachel - für die Auskunft «Ruhig».
 * Dieselbe Lehre wie bei den Fenster- und Türkontakten (lib/offen.ts)
 * und den Bewegungsmeldern (lib/bewegung.ts): Was man nicht bedienen
 * kann, ist ein Zeichen wert, keine Kachel. Nur ist ein Rauchmelder
 * kein Fensterkontakt - er hängt an der Decke, man sieht ihn nie an,
 * und genau darum will man einmal im Jahr nachsehen können, ob er noch
 * meldet und wie voll seine Batterie ist. Das steht jetzt unter
 * Einstellungen → System.
 *
 * **Der Alarm bleibt sichtbar.** Wegfallen darf die Kachel nur, solange
 * der Melder ruhig ist. Meldet er Rauch, steht er im Zimmer - eine
 * ausgeblendete Brandmeldung wäre kein aufgeräumter Bildschirm,
 * sondern ein Fehler. Den Weg zur Push-Meldung und zur Alarmanlage
 * (core/watchrules.py) berührt das ohnehin nicht: Der läuft am
 * Bildschirm vorbei.
 *
 * Reines Rechnen: hinein die Geräte, heraus Zeilen.
 */
import { Entity } from '../api/types';

/** Geräteklassen, die Feuer oder Gas melden.
 *
 *  Gas- und CO-Melder stehen bewusst mit in der Liste: Sie hängen
 *  daneben, melden dasselbe Ereignis («raus hier») und würden sonst als
 *  einzige Kachel im Zimmer zurückbleiben. */
const RAUCH_KLASSEN = new Set(['smoke', 'gas', 'co', 'carbon_monoxide']);

/** Ein Melder, der Rauch oder Gas meldet? (rein, testbar)
 *
 *  Ohne Geräteklasse entscheidet der Name - nicht jede Integration
 *  schickt eine, und ein Melder ohne Klasse stünde sonst wieder als
 *  Kachel im Zimmer (dieselbe Regel wie in lib/bewegung.ts). */
export function istRauchmelder(entity: Entity): boolean {
  if (entity.kind !== 'binary_sensor') return false;
  const klasse = String(entity.state?.device_class ?? '');
  if (klasse) return RAUCH_KLASSEN.has(klasse);
  return /rauch|smoke|brandmeld|co-melder|gasmeld/i.test(entity.name);
}

/** Schlägt dieser Melder gerade an? (rein, testbar) */
export function meldetRauch(entity: Entity): boolean {
  if (!istRauchmelder(entity)) return false;
  if (entity.available === false) return false;
  return String(entity.state?.state ?? '') === 'on';
}

/** Darf die Kachel dieses Geräts im Zimmer wegfallen? (rein, testbar)
 *
 *  Genau dann, wenn es ein ruhiger Melder ist. Schlägt er an, gehört er
 *  ins Zimmer - siehe oben. */
export function rauchmelderVerstecken(entity: Entity): boolean {
  return istRauchmelder(entity) && !meldetRauch(entity);
}

/** Ein Wert, wie ihn die Liste unter System zeigt. */
export interface Melderwert {
  /** Der Feldname beim Hub - als Schlüssel für React. */
  feld: string;
  label: string;
  wert: string;
  /** Auffällig darstellen: leere Batterie, Sabotage, Testmodus. */
  warnt?: boolean;
}

/** Eine Zeile der Liste. */
export interface Melderzeile {
  id: string;
  name: string;
  raum: string | null;
  /** Meldet er gerade? */
  alarm: boolean;
  erreichbar: boolean;
  /** Der Zustand als Wort - «Ruhig», «RAUCH», «nicht erreichbar». */
  status: string;
  werte: Melderwert[];
  /** Lässt sich dieser Melder von aussen zum Lärmen bringen?
   *
   *  Hängt am Modell: Die meisten Rauchmelder haben zwar eine Sirene,
   *  aber nur ihre eigene - auslösen kann sie niemand sonst. Wo es
   *  geht, steht der Melder auch im Ablauf-Editor zur Wahl
   *  (Punkt 544); wo nicht, sagt die Karte es, statt die Frage offen
   *  zu lassen, warum er dort fehlt. */
  kannSignal: boolean;
}

/** Die Befehle, mit denen ein Melder Lärm macht - so heissen sie im Hub
 *  (integrations/zigbee2mqtt.py, SIRENE_BEFEHLE). */
export const SIGNAL_AN = 'sound_alarm';
export const SIGNAL_AUS = 'silence_alarm';

/** Was der Hub sonst noch am Zustand führt und was hier nichts zu suchen
 *  hat: der Zustand selbst (steht als `status` da), die Geräteklasse
 *  (steht in der Überschrift) und die Buchhaltung der App. */
const NICHT_ZEIGEN = new Set([
  'state',
  'device_class',
  'unit',
  'off_at',
  'last_source',
  'assumed',
  'problem',
  'friendly_name',
]);

/** Deutsche Beschriftung und Einheit zu den Feldern, die ein
 *  Rauchmelder meldet.
 *
 *  Gefragt war «Status, Batterie, Smoke density, Smoke density dbm
 *  usw.» - das «usw.» ist der Punkt: Welche Werte ein Melder führt,
 *  hängt am Modell. Bekanntes bekommt darum eine Beschriftung, alles
 *  Übrige steht trotzdem da, mit seinem Feldnamen. Eine Liste, die nur
 *  zeigt, was jemand vorher aufgezählt hat, lässt genau das weg, wonach
 *  man sucht. */
const BESCHRIFTUNG: Record<string, { label: string; einheit?: string }> = {
  battery: { label: 'Batterie', einheit: '%' },
  low_battery: { label: 'Batterie schwach' },
  battery_low: { label: 'Batterie schwach' },
  smoke_density: { label: 'Rauchdichte' },
  // Beide Zahlen heissen bei Zigbee2MQTT «smoke density», und beide
  // standen deshalb als «Rauchdichte» nebeneinander - zwei Spalten,
  // gleicher Name, verschiedene Zahl. Die Einheit gehört darum in die
  // Beschriftung und nicht hinter den Wert: Sie ist hier das, was die
  // zwei unterscheidet.
  smoke_density_dbm: { label: 'Rauchdichte (dB/m)' },
  tamper: { label: 'Sabotage' },
  test: { label: 'Testmodus' },
  supervision: { label: 'Selbstprüfung' },
  linkquality: { label: 'Funkgüte', einheit: 'LQI' },
  temperature: { label: 'Temperatur', einheit: '°C' },
  humidity: { label: 'Luftfeuchtigkeit', einheit: '%' },
  voltage: { label: 'Spannung', einheit: 'V' },
  error: { label: 'Störung' },
};

/** Felder, deren «ja» ein Hinweis ist und kein Betriebszustand. */
const WARNT_BEI_JA = new Set([
  'low_battery',
  'battery_low',
  'tamper',
  'test',
  'error',
]);

/** Aus «smoke_density_dbm» eine lesbare Beschriftung (rein, testbar).
 *
 *  Nur für Felder ohne eigenen Eintrag oben: «battery_defect» wird zu
 *  «Battery defect». Das ist nicht schön, aber ehrlich - und es
 *  verschweigt nichts. */
export function feldLabel(feld: string): string {
  const bekannt = BESCHRIFTUNG[feld];
  if (bekannt) return bekannt.label;
  const worte = feld.replace(/[_-]+/g, ' ').trim();
  return worte.charAt(0).toUpperCase() + worte.slice(1);
}

/** Einen rohen Wert als Text (rein, testbar). */
export function wertText(feld: string, wert: unknown): string {
  const einheit = BESCHRIFTUNG[feld]?.einheit;
  if (typeof wert === 'boolean') return wert ? 'ja' : 'nein';
  if (wert === 'on') return 'ja';
  if (wert === 'off') return 'nein';
  if (typeof wert === 'number') {
    // Ganze Zahlen ohne Komma, gebrochene auf ein Zehntel - «23.400001»
    // ist kein Messwert, sondern eine Fliesskommazahl beim Ausatmen.
    const zahl = Number.isInteger(wert) ? String(wert) : String(Math.round(wert * 10) / 10);
    return einheit ? `${zahl} ${einheit}` : zahl;
  }
  const text = String(wert ?? '').trim();
  if (!text) return '–';
  return einheit ? `${text} ${einheit}` : text;
}

/**
 * Die Melder mit allem, was sie melden (rein, testbar).
 *
 * Sortiert nach Dringlichkeit: erst wer meldet, dann wer nicht
 * erreichbar ist, dann der Rest nach Name. Wer die Liste öffnet, will
 * zuerst das Kaputte sehen - alphabetisch stünde ein stummer Melder
 * unter «W» ganz unten.
 */
export function rauchmelderListe(entities: Entity[]): Melderzeile[] {
  const zeilen = entities.filter(istRauchmelder).map((entity) => {
    const zustand = entity.state ?? {};
    const erreichbar = entity.available !== false;
    const alarm = meldetRauch(entity);
    const werte: Melderwert[] = Object.keys(zustand)
      .filter((feld) => !NICHT_ZEIGEN.has(feld) && zustand[feld] !== null && zustand[feld] !== undefined)
      .sort((a, b) => feldLabel(a).localeCompare(feldLabel(b)))
      .map((feld) => {
        const roh = zustand[feld];
        const jaNein = roh === true || roh === 'on';
        return {
          feld,
          label: feldLabel(feld),
          wert: wertText(feld, roh),
          warnt: jaNein && WARNT_BEI_JA.has(feld),
        };
      });
    return {
      id: entity.id,
      name: entity.name,
      raum: entity.room ?? null,
      alarm,
      erreichbar,
      status: !erreichbar ? 'nicht erreichbar' : alarm ? 'RAUCH' : 'Ruhig',
      werte,
      kannSignal: (entity.commands ?? []).includes(SIGNAL_AN),
    };
  });
  const rang = (zeile: Melderzeile) => (zeile.alarm ? 0 : !zeile.erreichbar ? 1 : 2);
  return zeilen.sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name));
}
