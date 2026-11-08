/**
 * Konsolenzeit der Kinder: was die Karte, der Plan und die Kindansicht
 * sagen (Punkt 748 der Werkbank).
 *
 * Gerechnet wird im Hub (`core/konsolenzeit.py`) - hier steht nur, was
 * davon wie gelesen wird: Texte, das Bearbeiten eines Plans, der Anteil
 * für den Ring. Alles rein und geprüft, damit eine Zahl auf dem Telefon
 * nicht anders lautet als im Protokoll der Eltern.
 *
 * Zeiten sind Minuten seit Mitternacht (960 = 16:00), Dauern Sekunden -
 * wie beim Hub.
 */

export const TAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const TAGE_LANG = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;

export interface TagRegel {
  an: boolean;
  von: number;
  bis: number;
  minuten: number;
}

export interface KonsolenPlan {
  aktiv: boolean;
  konsolen: string[];
  tage: TagRegel[];
  monat: number | null;
  ferien_wie_wochenende: boolean;
  abschalten: boolean;
  warnungen: number[];
  durchsage: boolean;
  eltern_melden: boolean;
}

export interface Monatstempo {
  strich: number;
  genutzt: number;
  urteil: 'im_plan' | 'schneller' | 'viel_schneller' | 'voll';
}

export interface KonsolenLage {
  kind: string;
  plan: KonsolenPlan;
  heute: {
    gesamt_s: number;
    konsolen: Record<string, number>;
    bonus: number;
    frei: boolean;
    verlauf: { konsole: string; spiel?: string | null; von: number; bis: number; sekunden: number }[];
    regel: TagRegel;
  };
  /** null heisst: unbegrenzt (Plan aus oder Tag frei ohne Monatsgrenze). */
  rest_s: number | null;
  grund: '' | 'tag' | 'fenster' | 'monat' | 'gesperrt' | 'kein_tag';
  monat: { gespielt_s: number; limit_min: number | null; tempo: Monatstempo | null };
  gesperrt: boolean;
  sitzung: { konsole: string; seit: number; spiel?: string | null } | null;
  tage: { tag: string; gesamt_s: number; konsolen: Record<string, number> }[];
  ferien: boolean;
}

export interface KonsoleInfo {
  id: string;
  name: string;
  integration: string;
  an: boolean;
  spiel: string | null;
  erreichbar: boolean;
  raum: string | null;
}

export interface KonsolenUebersicht {
  kinder: KonsolenLage[];
  konsolen: KonsoleInfo[];
  einstellungen?: {
    unbekannt: 'fragen' | 'sperren';
    gesperrt: string[];
    /** Die Switch auch sperren, wenn sich niemand angemeldet hat. */
    nintendo_sperren?: boolean;
  };
  eltern?: { konsole: string; seit: number }[];
}

/** Die Wahl für Minuten pro Tag und pro Monat - wie auf den Bildern. */
export const TAGES_MINUTEN = [30, 45, 60, 90, 120] as const;
export const MONATS_STUNDEN = [10, 15, 20, 30] as const;
export const WARN_WAHL = [1, 2, 3, 5, 10, 15, 20, 30] as const;
const TAG_MAX = 600;
const MONAT_MAX = 6000;
const SCHRITT = 15;

// ── Zeiten und Dauern ──────────────────────────────────────────────────

/** 45 → «45 min», 90 → «1 h 30 min», 120 → «2 h» (rein, testbar). */
export function minutenText(minuten: number): string {
  const m = Math.max(0, Math.round(minuten));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Sekunden als gespielte Dauer; unter einer Minute ehrlich «unter 1 min». */
export function dauerText(sekunden: number): string {
  const min = Math.floor(Math.max(0, sekunden) / 60);
  return min <= 0 ? 'unter 1 min' : minutenText(min);
}

/** 960 → «16:00» (rein, testbar). */
export function zeitText(minuten: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minuten)));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${String(h).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// ── Den Plan bearbeiten ────────────────────────────────────────────────

export function leereRegel(): TagRegel {
  return { an: false, von: 16 * 60, bis: 19 * 60, minuten: 45 };
}

/** Ein frischer Plan für ein Kind, das noch keinen hat (rein, testbar).
 *
 *  Voreingestellt wie auf dem Bild: Montag bis Freitag nachmittags, am
 *  Wochenende länger - aber **ausgeschaltet**, bis die Eltern speichern.
 *  Wer «Einrichten» tippt und wieder geht, soll kein Kind begrenzt haben.
 */
export function leererPlan(konsolen: string[] = []): KonsolenPlan {
  const werktag: TagRegel = { an: true, von: 16 * 60, bis: 19 * 60, minuten: 45 };
  const wochenende: TagRegel = { an: true, von: 9 * 60, bis: 19 * 60, minuten: 120 };
  return {
    aktiv: false,
    konsolen,
    tage: [werktag, werktag, werktag, werktag, werktag, wochenende, wochenende].map((t) => ({
      ...t,
    })),
    monat: 20 * 60,
    ferien_wie_wochenende: true,
    abschalten: true,
    warnungen: [10, 5, 1],
    durchsage: true,
    eltern_melden: true,
  };
}

const zwischen = (wert: number, tief: number, hoch: number) =>
  Math.max(tief, Math.min(hoch, wert));

/** Einen Wochentag ändern (rein, testbar). Fenster und Minuten bleiben
 *  in Grenzen, und «bis» liegt immer nach «von». */
export function tagAendern(
  plan: KonsolenPlan,
  index: number,
  aenderung: Partial<TagRegel>
): KonsolenPlan {
  const tage = plan.tage.map((tag, i) => {
    if (i !== index) return tag;
    const neu = { ...tag, ...aenderung };
    neu.von = zwischen(Math.round(neu.von), 0, 24 * 60 - SCHRITT);
    neu.bis = zwischen(Math.round(neu.bis), neu.von + SCHRITT, 24 * 60);
    neu.minuten = zwischen(Math.round(neu.minuten), 0, TAG_MAX);
    return neu;
  });
  return { ...plan, tage };
}

/** Den Tag `quelle` auf Montag bis Freitag übernehmen («Für Mo – Fr
 *  übernehmen», rein, testbar). Das Wochenende bleibt, wie es ist. */
export function werktageUebernehmen(plan: KonsolenPlan, quelle: number): KonsolenPlan {
  const vorlage = plan.tage[quelle];
  if (!vorlage) return plan;
  return { ...plan, tage: plan.tage.map((tag, i) => (i < 5 ? { ...vorlage } : tag)) };
}

/** Eine Zahl um Schritte verstellen, in Grenzen (rein, testbar). */
export function verstellen(wert: number, schritte: number, tief: number, hoch: number): number {
  return zwischen(wert + schritte * SCHRITT, tief, hoch);
}

export function monatSetzen(plan: KonsolenPlan, stunden: number | null): KonsolenPlan {
  return {
    ...plan,
    monat: stunden === null || stunden <= 0 ? null : zwischen(Math.round(stunden * 60), 15, MONAT_MAX),
  };
}

export function konsoleUmschalten(plan: KonsolenPlan, id: string): KonsolenPlan {
  const hat = plan.konsolen.includes(id);
  return {
    ...plan,
    konsolen: hat ? plan.konsolen.filter((k) => k !== id) : [...plan.konsolen, id],
  };
}

export function warnungUmschalten(plan: KonsolenPlan, minuten: number): KonsolenPlan {
  const hat = plan.warnungen.includes(minuten);
  const neu = hat ? plan.warnungen.filter((m) => m !== minuten) : [...plan.warnungen, minuten];
  return { ...plan, warnungen: neu.sort((a, b) => b - a) };
}

/** Wie viel ein Kind im Monat bekäme, wenn es jeden Tag die volle Zeit
 *  nutzte - die Zahl hinter «Beides gilt» (rein, testbar).
 *
 *  Ein Durchschnittsmonat mit 30 Tagen: vier Wochen und zwei Tage, die
 *  Reste verteilt auf Mo und Di. Das ist eine Orientierung, kein
 *  Versprechen - die Ferien verschieben es. */
export function monatsMaximum(plan: KonsolenPlan): number {
  const woche = plan.tage.reduce((summe, tag) => summe + (tag.an ? tag.minuten : 0), 0);
  const rest = (plan.tage[0]?.an ? plan.tage[0].minuten : 0) + (plan.tage[1]?.an ? plan.tage[1].minuten : 0);
  return Math.round(((woche * 4 + rest) / 60) * 10) / 10;
}

export function monatsHinweis(plan: KonsolenPlan): string | null {
  if (!plan.monat) return null;
  const moeglich = monatsMaximum(plan);
  const limit = plan.monat / 60;
  if (moeglich <= 0) return null;
  if (moeglich <= limit) return 'Die Monatsgrenze greift nie: Die Tage reichen nicht bis dahin.';
  // Der Tag, an dem das Konto bei voller Nutzung leer ist.
  const tag = Math.min(30, Math.ceil((limit / moeglich) * 30));
  return (
    'Beides gilt, es zählt, was zuerst aufgebraucht ist. Nutzt das Kind jeden Tag die volle ' +
    `Zeit, sind das rund ${Math.round(moeglich)} h im Monat - die Monatsgrenze greift dann ab ` +
    `dem ${tag}. Tag.`
  );
}

// ── Zeilen im Plan ─────────────────────────────────────────────────────

/** «16:00 – 19:00» (rein, testbar). */
export function fensterText(regel: TagRegel): string {
  return `${zeitText(regel.von)} – ${zeitText(regel.bis)}`;
}

/** Die Zeile eines Tages in der Wochenliste (rein, testbar). */
export function tagZeile(regel: TagRegel): { titel: string; unten: string } {
  if (!regel.an) return { titel: 'Kein Zocken', unten: '' };
  return { titel: fensterText(regel), unten: `höchstens ${minutenText(regel.minuten)}` };
}

// ── Die Lage lesen ─────────────────────────────────────────────────────

/** Was auf dem grossen Ring steht (rein, testbar).
 *
 *  Unter fünf Minuten zählt die App in Minuten weiter, unter einer
 *  Minute steht «< 1»: «0 Minuten übrig» wäre falsch, solange die
 *  Konsole noch läuft. */
export function ringZahl(lage: Pick<KonsolenLage, 'rest_s'>): { zahl: string; einheit: string } {
  if (lage.rest_s === null) return { zahl: '∞', einheit: 'keine Grenze' };
  const min = Math.floor(lage.rest_s / 60);
  if (lage.rest_s <= 0) return { zahl: '0', einheit: 'Minuten übrig' };
  if (min < 1) return { zahl: '< 1', einheit: 'Minute übrig' };
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return { zahl: rest === 0 ? `${h} h` : `${h}:${String(rest).padStart(2, '0')}`, einheit: 'Stunden übrig' };
  }
  return { zahl: String(min), einheit: min === 1 ? 'Minute übrig' : 'Minuten übrig' };
}

/** Der Teil des Rings, der noch voll ist: 0 bis 1 (rein, testbar).
 *  Bezogen auf das, was heute überhaupt erlaubt war - Plan plus Geschenk. */
export function ringAnteil(lage: KonsolenLage): number {
  if (lage.rest_s === null) return 1;
  const erlaubt = (lage.heute.regel.an ? lage.heute.regel.minuten : 0) + lage.heute.bonus;
  const rest = Math.max(0, lage.rest_s) / 60;
  if (erlaubt <= 0) return rest > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, rest / erlaubt));
}

/** Warum gerade nichts geht - in einem Satz für das Kind (rein, testbar). */
export function grundSatz(lage: KonsolenLage): string {
  switch (lage.grund) {
    case 'gesperrt':
      return 'Die Konsole ist gerade gesperrt.';
    case 'monat':
      return 'Die Zeit für diesen Monat ist aufgebraucht.';
    case 'kein_tag':
      return 'Heute ist kein Konsolentag.';
    case 'fenster':
      return lage.heute.regel.an
        ? `Erlaubt ist ${fensterText(lage.heute.regel)}.`
        : 'Heute ist kein Konsolentag.';
    case 'tag':
      return 'Die Zeit für heute ist aufgebraucht.';
    default:
      return '';
  }
}

/** «PS5 10 min, Switch 15 min» (rein, testbar). Nur, was mindestens
 *  eine halbe Minute zählt - sonst stünde «Switch unter 1 min» da. */
export function aufteilung(
  konsolen: Record<string, number>,
  namen: Record<string, string>
): string {
  return Object.entries(konsolen)
    .filter(([, sek]) => sek >= 30)
    .map(([id, sek]) => `${namen[id] ?? id} ${dauerText(sek)}`)
    .join(', ');
}

/** Die Zeile unter dem Monatsbalken (rein, testbar). */
export function monatSatz(lage: KonsolenLage): string | null {
  if (!lage.monat.limit_min) return null;
  const rest = Math.max(0, lage.monat.limit_min * 60 - lage.monat.gespielt_s);
  return `Noch ${dauerText(rest)}`;
}

export function tempoSatz(tempo: Monatstempo | null): string | null {
  switch (tempo?.urteil) {
    case 'schneller':
      return 'Etwas schneller als der Monat';
    case 'viel_schneller':
      return 'Deutlich schneller als der Monat';
    case 'voll':
      return 'Der Monat ist aufgebraucht';
    default:
      return null;
  }
}

/** Anteil des Monatsbalkens: gespielt gegen die Grenze, 0 bis 1. */
export function monatAnteil(lage: KonsolenLage): number {
  if (!lage.monat.limit_min) return 0;
  return Math.max(0, Math.min(1, lage.monat.gespielt_s / (lage.monat.limit_min * 60)));
}

/** «Morgen ist kein Zocken. Am Donnerstag wieder ab 16:00.» (rein, testbar)
 *
 *  Schaut ab morgen bis zu einer Woche voraus. Ferien kennt die App hier
 *  nicht - der Hub rechnet sie mit, und wer sich auf diesen Satz verliesse,
 *  läge in den Ferien eine Stunde daneben. Darum steht dort «gewöhnlich». */
export function morgenSatz(plan: KonsolenPlan, heuteIndex: number): string | null {
  const morgen = (heuteIndex + 1) % 7;
  const regel = plan.tage[morgen];
  if (!regel) return null;
  if (regel.an) return `Morgen ab ${zeitText(regel.von)}, höchstens ${minutenText(regel.minuten)}.`;
  for (let schritt = 2; schritt <= 7; schritt += 1) {
    const index = (heuteIndex + schritt) % 7;
    const spaeter = plan.tage[index];
    if (spaeter?.an) {
      return `Morgen ist kein Zocken. Am ${TAGE_LANG[index]} wieder ab ${zeitText(spaeter.von)}.`;
    }
  }
  return null;
}

/** Wochentag-Index (Mo = 0) aus einem Date (rein, testbar). */
export function wochentagIndex(datum: Date): number {
  return (datum.getDay() + 6) % 7;
}

/** Die sieben Balken der Woche: erlaubte Minuten je Tag gegen gespielte
 *  (rein, testbar). `gespielt` kennt nur die Tage, die der Hub schickt -
 *  der Rest bleibt leer. */
export function wochenBalken(
  plan: KonsolenPlan,
  heuteIndex: number,
  gespieltHeuteS: number,
  vergangene: { tag: string; gesamt_s: number }[],
  heute: Date
): { tag: string; erlaubt: number; gespielt: number; heute: boolean; frei: boolean }[] {
  // Den Montag dieser Woche bestimmen und die Tage daran zuordnen.
  const montag = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - heuteIndex);
  const nachTag = new Map(vergangene.map((t) => [t.tag, t.gesamt_s]));
  return plan.tage.map((regel, i) => {
    const datum = new Date(montag.getFullYear(), montag.getMonth(), montag.getDate() + i);
    const iso = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(
      datum.getDate()
    ).padStart(2, '0')}`;
    const gespielt = i === heuteIndex ? gespieltHeuteS : (nachTag.get(iso) ?? 0);
    return {
      tag: TAGE_KURZ[i],
      erlaubt: regel.an ? regel.minuten : 0,
      gespielt: Math.round(gespielt / 60),
      heute: i === heuteIndex,
      frei: !regel.an,
    };
  });
}

/** Läuft die Zeit gerade? Dann zählt die App zwischen zwei Abrufen selbst
 *  weiter (rein, testbar). */
export function laeuft(lage: KonsolenLage | null): boolean {
  return !!lage?.sitzung && lage.rest_s !== null && lage.rest_s > 0;
}

/** Was nach `vergangen` Sekunden seit dem Abruf übrig ist (rein, testbar). */
export function restNach(lage: KonsolenLage, vergangenS: number): number | null {
  if (lage.rest_s === null) return null;
  if (!laeuft(lage)) return lage.rest_s;
  return Math.max(0, lage.rest_s - Math.max(0, vergangenS));
}
