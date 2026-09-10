/**
 * Was man mit einem Ablauf tut, ausser ihn zu bauen (alle rein, testbar).
 *
 * Vier Handgriffe, die alle aus derselben Beobachtung stammen: Ein
 * Ablauf entsteht in fünf Minuten und lebt danach jahrelang - und alles,
 * was in diesen Jahren mit ihm passiert, war umständlicher als das
 * Bauen selbst.
 *
 * - **Duplizieren** (Punkt 313): «Wie der für die Küche, aber fürs Bad»
 *   ist der häufigste zweite Ablauf.
 * - **Pausieren bis** (311): In den Ferien löschte man Abläufe - und
 *   baute sie danach neu.
 * - **Einrückung** (316): `if` und `repeat` gibt es; ohne Einrückung
 *   liest man einen Ablauf mit fünf Schritten nicht mehr.
 * - **Warum nicht gelaufen** (309): Der Hub protokolliert den
 *   übersprungenen Lauf samt Grund - gesagt hat es ihm niemand.
 */
import { Automation } from '../screens/automations/entwurf';

/*
 * Konflikte (Punkt 312 der Werkbank) stehen hier bewusst NICHT.
 *
 * Es gab sie schon: `core/automation.py:find_conflicts` rechnet sie im
 * Hub, `/api/automations/conflicts` liefert sie, und der Bildschirm
 * zeigt sie samt Quittieren. Beim Bauen dieser Datei entstand die
 * Prüfung ein zweites Mal, in der App - genau der Fehler, wegen dem es
 * die CLAUDE.md gibt. Sie ist wieder draussen; wer sie hier sucht,
 * findet mit diesem Absatz den richtigen Ort.
 */

// ── Duplizieren ──────────────────────────────────────────────────────────

/**
 * Ein freier Name für die Kopie (rein, testbar).
 *
 * «Flurlicht» wird zu «Flurlicht (Kopie)», und wenn es die schon gibt,
 * zu «Flurlicht (Kopie 2)». Zwei Abläufe mit demselben Namen sind der
 * Anfang einer langen Suche: In der Liste sieht man nicht, welcher von
 * beiden gerade geschaltet hat.
 */
export function kopieName(name: string, vorhandene: string[]): string {
  const kern = String(name ?? '').trim() || 'Ablauf';
  const belegt = new Set(vorhandene.map((eintrag) => String(eintrag).trim()));
  const erster = `${kern} (Kopie)`;
  if (!belegt.has(erster)) return erster;
  for (let n = 2; n < 100; n += 1) {
    const versuch = `${kern} (Kopie ${n})`;
    if (!belegt.has(versuch)) return versuch;
  }
  return `${kern} (Kopie ${Date.now()})`;
}

/**
 * Die Kopie eines Ablaufs (rein, testbar).
 *
 * Ohne Kennung, ohne Verlauf und **ausgeschaltet**: Eine Kopie, die
 * sofort mitläuft, schaltet dasselbe Gerät ein zweites Mal - und zwar
 * bevor jemand sie angepasst hat. Genau dafür kopiert man sie ja nicht.
 */
export function dupliziere(ablauf: Automation, vorhandene: string[]): Automation {
  return {
    ...ablauf,
    id: '',
    alias: kopieName(ablauf.alias, vorhandene),
    enabled: false,
    quiet_until: null,
    next_run: null,
    last_run: null,
    last_fired: null,
    orphaned: false,
  };
}

// ── Pausieren ────────────────────────────────────────────────────────────

/** Die angebotenen Pausen. Bis morgen früh und bis nächste Woche sind
 *  die beiden echten Fälle; «bis ich es wieder einschalte» heisst
 *  `enabled: false` und steht daneben. */
export const PAUSEN: { key: string; label: string; tage: number }[] = [
  { key: 'morgen', label: 'Bis morgen', tage: 1 },
  { key: 'woche', label: 'Eine Woche', tage: 7 },
  { key: 'ferien', label: 'Zwei Wochen', tage: 14 },
];

/**
 * Bis wann eine Pause reicht, in Unix-Sekunden (rein, testbar).
 *
 * Immer bis morgens um sechs des Zieltags und nicht «in 24 Stunden»:
 * Wer abends um elf das Bewegungslicht pausiert, will es am übernächsten
 * Abend wieder haben - nicht um elf Uhr nachts wieder eingeschaltet
 * bekommen, mitten im Ablauf.
 */
export function pauseBis(tage: number, jetzt: Date): number {
  const ziel = new Date(jetzt.getTime());
  ziel.setDate(ziel.getDate() + Math.max(1, Math.round(tage)));
  ziel.setHours(6, 0, 0, 0);
  return Math.round(ziel.getTime() / 1000);
}

/** Ruht dieser Ablauf gerade? (rein, testbar) */
export function ruht(ablauf: Pick<Automation, 'quiet_until'>, jetzt: Date): boolean {
  return !!ablauf.quiet_until && ablauf.quiet_until * 1000 > jetzt.getTime();
}

// ── Einrückung ───────────────────────────────────────────────────────────

/** Bausteine, die andere enthalten - sie rücken ihren Inhalt ein. */
const SCHACHTELT = new Set(['if', 'repeat', 'wait_until']);

/**
 * Wie tief ein Schritt steht (rein, testbar).
 *
 * Zurück kommt je Schritt seine Einrücktiefe. Ohne sie steht ein
 * fünfschrittiger Ablauf als flache Liste da, und man sieht nicht, was
 * zum `if` gehört und was danach kommt.
 */
export function tiefen(schritte: { kind?: string }[]): number[] {
  const ergebnis: number[] = [];
  let tiefe = 0;
  for (const schritt of schritte ?? []) {
    const art = String(schritt?.kind ?? '');
    if (art === 'end') tiefe = Math.max(0, tiefe - 1);
    ergebnis.push(tiefe);
    if (SCHACHTELT.has(art)) tiefe += 1;
  }
  return ergebnis;
}

// ── Warum lief das nicht ─────────────────────────────────────────────────

/**
 * Warum der letzte Lauf nichts tat (rein, testbar) - oder leer.
 *
 * Der Hub protokolliert den übersprungenen Lauf samt Grund
 * (`skipped`); gesagt hat es ihm niemand. Genau danach sucht man, wenn
 * ein Ablauf schweigt - und ohne die Antwort baut man den Ablauf um,
 * obwohl bloss eine Bedingung nicht passte.
 */
export function warumNicht(
  lauf: { executed?: boolean; error?: string | null; skipped?: string[] } | null | undefined
): string {
  if (!lauf) return '';
  if (lauf.error) return `Fehler: ${lauf.error}`;
  if (lauf.executed) return '';
  const gruende = (lauf.skipped ?? []).filter(Boolean);
  if (gruende.length === 0) return 'Ausgelöst, aber nichts getan';
  if (gruende.length === 1) return `Nicht gelaufen: ${gruende[0]} passte nicht`;
  return `Nicht gelaufen: ${gruende.length} Bedingungen passten nicht`;
}
