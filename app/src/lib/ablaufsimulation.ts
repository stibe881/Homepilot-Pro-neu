/**
 * «Hätte gefeuert»: die Zeitraum-Simulation eines Ablaufs, aufbereitet
 * (Punkt 254 der Werkbank).
 *
 * Der Hub rechnet nach, wie oft ein Ablauf in den letzten Tagen gefeuert
 * hätte (GET /api/automations/{id}/simulation) – Zeit, Sonne und
 * Kalender exakt, Gerätewechsel aus dem Ereignisprotokoll. Was sich
 * nicht nachrechnen lässt, meldet er ehrlich als «nicht simulierbar»
 * mit Grund, statt zu schätzen.
 *
 * Hier steht nur das Aufbereiten: aus dem Bericht die Zeilen, die im
 * Blatt stehen. Reines Rechnen – hinein der Bericht, heraus die Sätze.
 */

/** Ein Tag des Berichts: die Zeitpunkte, zu denen es gefeuert hätte. */
export interface SimulationsTag {
  /** ISO-Datum, z.B. «2026-09-01». */
  date: string;
  /** Uhrzeiten «HH:MM», aufsteigend. */
  times: string[];
  count: number;
}

/** Ein Auslöser, den niemand nachrechnen kann – mit Grund. */
export interface NichtSimulierbar {
  type: string;
  entity_id?: string;
  reason: string;
}

/** Eine Bedingung, die für die Vergangenheit nicht prüfbar war. */
export interface UngepruefteBedingung {
  type: string;
  entity_id?: string;
}

/** Die Antwort des Hubs – dieselben Felder wie in
 *  hub/core/ablaufsimulation.py. */
export interface SimulationsBericht {
  from: string;
  to: string;
  days: SimulationsTag[];
  total: number;
  not_simulatable: NichtSimulierbar[];
  unchecked_conditions: UngepruefteBedingung[];
  /** Nur wenn das Protokoll den Zeitraum nicht deckt (Unix-Sekunden). */
  log_start?: number;
  hinweis?: string;
}

// In der Reihenfolge von Date.getDay(): Sonntag zuerst.
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** «Mo 01.09.» aus einem ISO-Datum (rein, testbar).
 *
 *  Von Hand zerlegt statt `new Date(iso)`: Ein nacktes ISO-Datum liest
 *  JavaScript als UTC-Mitternacht, und westlich von Greenwich wäre das
 *  der Vorabend – der Bericht zeigte dann jeden Tag einen daneben. */
export function tagLabel(iso: string): string {
  const [jahr, monat, tag] = String(iso ?? '')
    .split('-')
    .map(Number);
  if (!jahr || !monat || !tag) return String(iso ?? '');
  const datum = new Date(jahr, monat - 1, tag);
  const zwei = (zahl: number) => String(zahl).padStart(2, '0');
  return `${WOCHENTAGE[datum.getDay()]} ${zwei(tag)}.${zwei(monat)}.`;
}

/** Wie viele Uhrzeiten je Tag ausgeschrieben werden.
 *
 *  Ein Bewegungsmelder liefert an einem Samstag gern vierzig Wechsel –
 *  aufgezählt füllte das den Bildschirm und beantwortete die Frage
 *  trotzdem nicht. Ab hier wird gezählt statt aufgezählt. */
export const ZEITEN_KURZ = 6;

/** Die Zeile eines Tags: «Mo 01.09. · 06:30, 18:12» oder «… · –»
 *  (rein, testbar). Der Strich ist Absicht: Ein Tag ohne Lauf ist eine
 *  Auskunft, keine Lücke – ihn wegzulassen, sähe nach fehlendem Datum
 *  aus. */
export function tagZeile(tag: SimulationsTag): string {
  const zeiten =
    tag.times.length > ZEITEN_KURZ
      ? `${tag.times.slice(0, ZEITEN_KURZ).join(', ')} … (${tag.count}×)`
      : tag.times.join(', ');
  return `${tagLabel(tag.date)} · ${zeiten || '–'}`;
}

/** Die Summe als Satz (rein, testbar). «Kein einziges Mal» ist die
 *  häufigste und wertvollste Antwort – genau dafür baut man die
 *  Simulation auf. */
export function summenSatz(bericht: SimulationsBericht): string {
  const tage = bericht.days.length;
  // Ein Tag heisst «heute»: Der Bericht beginnt dann um Mitternacht,
  // und «in den letzten 1 Tagen» liest niemand als Deutsch.
  const zeitraum = tage === 1 ? 'heute' : `in den letzten ${tage} Tagen`;
  if (bericht.total === 0) {
    return `Der Ablauf hätte ${zeitraum} kein einziges Mal gefeuert.`;
  }
  if (bericht.total === 1) {
    return `Der Ablauf hätte ${zeitraum} einmal gefeuert.`;
  }
  return `Der Ablauf hätte ${zeitraum} ${bericht.total}-mal gefeuert.`;
}

/** Das deutsche Wort zur Auslöser-Art – dieselben Namen wie die Chips im
 *  Editor, damit man den gemeinten Auslöser wiederfindet. */
export function ausloeserWort(type: string): string {
  switch (type) {
    case 'time':
      return 'Uhrzeit';
    case 'sun':
      return 'Sonnenstand';
    case 'calendar':
      return 'Termin';
    case 'interval':
      return 'Regelmässig';
    case 'availability':
      return 'Meldet sich nicht';
    case 'presence':
      return 'Person kommt/geht';
    case 'weather_warning':
      return 'Wetterwarnung';
    case 'state':
      return 'Gerät';
    default:
      return type;
  }
}

/** Eine Zeile «nicht simulierbar» (rein, testbar).
 *
 *  `nameOf` macht aus der Kennung den Gerätenamen – die Liste kommt vom
 *  Bildschirm, nicht hierher. Ohne Namen bleibt die Kennung stehen:
 *  falsch benannt ist besser als verschwiegen. */
export function nichtSimulierbarZeile(
  eintrag: NichtSimulierbar,
  nameOf: (id: string) => string = (id) => id
): string {
  const wer = eintrag.entity_id ? ` «${nameOf(eintrag.entity_id)}»` : '';
  return `${ausloeserWort(eintrag.type)}${wer}: ${eintrag.reason}`;
}

/** Eine Zeile «ungeprüfte Bedingung» (rein, testbar). */
export function ungeprueftZeile(
  eintrag: UngepruefteBedingung,
  nameOf: (id: string) => string = (id) => id
): string {
  if (eintrag.entity_id) {
    return `Gerätebedingung «${nameOf(eintrag.entity_id)}»`;
  }
  switch (eintrag.type) {
    case 'group':
      return 'eine Bedingungsgruppe';
    case 'time':
      return 'ein Zeitfenster';
    case 'sun':
      return 'der Sonnenstand';
    default:
      return `eine Bedingung («${eintrag.type}»)`;
  }
}

/** Der Satz zur oberen Schranke – oder null, wenn alles prüfbar war
 *  (rein, testbar).
 *
 *  Ungeprüfte Bedingungen gelten in der Rechnung als erfüllt; die Zahl
 *  ist damit eine Obergrenze. Das gehört zur Zahl dazu, sonst richtet
 *  jemand seine Nachtruhe nach einer Auskunft, die keine ist. */
export function obergrenzeSatz(bericht: SimulationsBericht): string | null {
  const anzahl = bericht.unchecked_conditions.length;
  if (anzahl === 0) return null;
  const was =
    anzahl === 1 ? 'Eine Bedingung liess' : `${anzahl} Bedingungen liessen`;
  return `${was} sich für die Vergangenheit nicht nachprüfen – die Zahl ist eine Obergrenze.`;
}
