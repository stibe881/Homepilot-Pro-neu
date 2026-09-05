/**
 * Familie und Freunde – was auf der Seite steht.
 *
 * Der Hub liefert je Mensch eine Zeile (siehe hub/core/personen.py); hier
 * wird daraus Text. Bewusst wenig gerechnet: Wo jemand ist, entscheidet
 * der Hub – er kennt die Orte aus Life360, die App nicht.
 */
import { dauerDa } from './ortung';

export interface Person {
  /** Anzeigename. */
  name: string;
  /** Kennung der Ortungszone – fehlt, wer keine Ortung hat. */
  zone?: string | null;
  /** Rolle im Hub, sofern die Person einen Zugang hat. */
  role?: string | null;
  /** Gehört zum Haushalt (hat einen Zugang) oder wird nur geortet. */
  household?: boolean;
  /** Fertiger Satzteil vom Hub: «zuhause», «bei Tanners Home», … */
  where?: string | null;
  /** Seit wann dieser Zustand gilt (Unix-Sekunden). */
  since?: number | null;
  /** Akkustand des Telefons in Prozent. */
  battery?: number | null;
  /** Woher die letzte Meldung kam: «geofence», «life360», «none». */
  source?: string | null;
  /** Die Schalter, vollständig – auch was nie eingestellt wurde. */
  meldungen?: Record<string, boolean>;
  /** Warum die Ortung so aussieht, wie sie aussieht – der lange Satz. */
  hint?: string | null;
}

/**
 * Wo jemand ist, samt «seit wann» (rein, testbar).
 *
 * Ohne die Dauer beantwortet «unterwegs» die halbe Frage: Seit zehn
 * Minuten unterwegs ist etwas anderes als seit vorgestern.
 */
export function ortZeile(person: Person, jetzt: Date): string {
  const wo = String(person.where || 'unbekannt');
  if (wo === 'unbekannt') return 'Aufenthalt unbekannt';
  const seit = dauerDa(person.since, jetzt);
  return seit ? `${grossAmAnfang(wo)} · ${seit}` : grossAmAnfang(wo);
}

function grossAmAnfang(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Was unter dem Ort steht: Herkunft der Meldung und Akku (rein, testbar).
 *
 * Beides in einer Zeile, weil beides dieselbe Frage beantwortet – wie
 * verlässlich ist das, was oben steht. Ein Telefon mit 8 % meldet bald
 * gar nichts mehr.
 */
export function nebenZeile(person: Person): string {
  const teile: string[] = [];
  if (!person.zone) {
    teile.push('Keine Ortung eingerichtet');
  } else if (person.source === 'life360') {
    teile.push('über Life360');
  } else if (person.source === 'none') {
    teile.push('Hat sich noch nie gemeldet');
  } else if (person.source === 'geofence') {
    teile.push('über das Telefon');
  }
  // Ausdrücklich auf «ist es eine Zahl» prüfen, nicht über Number():
  // `Number(null)` ist 0, und aus einem fehlenden Akkustand würde
  // «Telefon 0 %» - eine Falschmeldung in genau die falsche Richtung.
  const akku = person.battery;
  if (typeof akku === 'number' && Number.isFinite(akku) && akku >= 0) {
    teile.push(`Telefon ${Math.round(akku)} %`);
  }
  return teile.join(' · ');
}

/** Haushaltsmitglied oder nur geortet? (rein, testbar)
 *
 *  Die Georteten hiessen auf der Plakette zuerst «Geortet» - technisch
 *  richtig, aber kalt: Maja und Ray sind Familie, kein Messwert. Wer
 *  hier steht, ohne zum Haushalt zu gehören, ist Familie oder Freund -
 *  die Seite heisst genau so. */
export function herkunft(person: Person): string {
  return person.household ? 'Haushalt' : 'Familie';
}

/**
 * Wer zuerst steht (rein, testbar).
 *
 * Der Haushalt vor den bloss Georteten, und darin die Reihenfolge des
 * Hubs – die kommt aus der config.yaml und ist damit selbst gewählt.
 * Alphabetisch zu sortieren würde diese Wahl überschreiben.
 */
export function sortiert(leute: Person[]): Person[] {
  const rang = (p: Person) => (p.household ? 0 : 1);
  return [...leute]
    .map((person, index) => ({ person, index }))
    .sort((a, b) => rang(a.person) - rang(b.person) || a.index - b.index)
    .map((eintrag) => eintrag.person);
}

/**
 * Wie viele Meldungen bei dieser Person anstehen (rein, testbar).
 *
 * Steht zugeklappt neben dem Namen: Ohne diese Zahl müsste man jede
 * Person aufklappen, um zu sehen, ob überhaupt etwas eingestellt ist.
 */
export function anzahlAn(person: Person): number {
  const schalter = person.meldungen ?? {};
  return Object.values(schalter).filter(Boolean).length;
}
