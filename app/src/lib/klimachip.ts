/**
 * Welcher Messwert oben in der Übersichtszeile steht.
 *
 * Bisher war es «der erste Sensor mit der passenden Einheit». Das klingt
 * harmlos und ist es nicht: Homematic legt je Funkschnittstelle einen
 * Sensor «Sendespeicher» an - Einheit Prozent. Stand er in der Liste vor
 * dem Feuchtesensor, zeigte der Tropfen oben die Auslastung des
 * Funkmoduls. Eine Zahl, die niemand deuten kann, ist schlimmer als
 * keine.
 */
import { Entity } from '../api/types';

/** Was ein Messwert bedeutet - unabhängig davon, wer ihn liefert. */
export type Messgroesse = 'temperature' | 'humidity';

const EINHEIT: Record<Messgroesse, string[]> = {
  temperature: ['°C'],
  humidity: ['%'],
};

/** Prozente, die keine Luftfeuchtigkeit sind. Die Einheit allein genügt
 *  nicht: Akkustand, Funkauslastung und Filterlaufzeit zählen alle in
 *  Prozent. */
const KEINE_FEUCHTE = /duty[_ ]?cycle|sendespeicher|batter|akku|filter|signal|wlan|lautst/i;

/** Grad, die nicht das Klima meinen - der Grill misst 180 °C, und das
 *  gehört nicht in die Kopfzeile der Wohnung. */
const KEIN_KLIMA = /grill|sonde|probe|ofen|backofen|kühlschrank|kuehlschrank|gefrier|tiefkühl|tiefkuehl/i;

function passt(entity: Entity, art: Messgroesse): boolean {
  if (entity.kind !== 'sensor') return false;
  const einheit = String(entity.state?.unit ?? '');
  if (!EINHEIT[art].includes(einheit)) return false;
  const kennung = `${entity.id} ${entity.name}`;
  if (art === 'humidity' && KEINE_FEUCHTE.test(kennung)) return false;
  if (art === 'temperature' && KEIN_KLIMA.test(kennung)) return false;
  return typeof entity.state?.state === 'number';
}

/**
 * Der Sensor für die Kopfzeile (rein, testbar).
 *
 * Die Reihenfolge ist Absicht: Wer sich ausdrücklich als Feuchte- oder
 * Temperaturmesser ausweist, hat Vorrang vor dem, der bloss zufällig
 * dieselbe Einheit trägt.
 */
export function klimaSensor(entities: Entity[], art: Messgroesse): Entity | undefined {
  const kandidaten = entities.filter((entity) => passt(entity, art));
  return (
    kandidaten.find((entity) => entity.state?.device_class === art) ??
    kandidaten.find((entity) => !entity.room) ??
    kandidaten[0]
  );
}

/** Was der Tropfen bzw. das Thermometer vorliest - mit Herkunft, damit
 *  die Zahl deutbar bleibt. */
export function klimaLabel(entity: Entity, art: Messgroesse): string {
  const was = art === 'humidity' ? 'Luftfeuchtigkeit' : 'Temperatur';
  const wert = Math.round(Number(entity.state?.state) * 10) / 10;
  const einheit = art === 'humidity' ? 'Prozent' : 'Grad';
  const ort = entity.room ? `${entity.room}, ` : '';
  return `${was} ${ort}${entity.name}: ${wert} ${einheit}`;
}
