/**
 * Einen Gutschein aus der Bestätigungsmail lesen (alle rein, testbar).
 *
 * Die meisten Gutscheine kommen nicht als Karte, sondern als PDF oder
 * Text per E-Mail - «Ihr Geschenkgutschein über CHF 100.00, Code
 * ABCD-1234-EFGH, gültig bis 31.12.2027». Seit Punkt 266 hängt die
 * Datei am Gutschein; abgetippt hat man Betrag, Nummer und Datum
 * trotzdem von Hand, und genau dort passieren die Zahlendreher, die man
 * erst an der Kasse merkt.
 *
 * Hier steht das Raten. Es ist ausdrücklich ein Vorschlag und keine
 * Übernahme: Das Formular füllt sich, und wer hinsieht, korrigiert. Ein
 * stiller Automatismus wäre bei Geld die falsche Zusage.
 *
 * Woher der Text kommt, ist egal - eingefügt aus der Mail oder vom Hub
 * aus dem angehängten PDF gelesen (`core/beleglesen.py`).
 */
import { Einheit } from './gutscheine';

/** Was aus einem Text herauszulesen war. Alles einzeln, alles optional:
 *  Ein Beleg, aus dem nur der Betrag hervorgeht, ist immer noch besser
 *  als keiner. */
export interface Belegfund {
  total?: number;
  unit?: Einheit;
  number?: string;
  pin?: string;
  /** «YYYY-MM-DD». */
  expires?: string;
  shop?: string;
}

/** Wörter, hinter denen eine PIN steht - und nicht die Gutscheinnummer. */
const PIN_WORT = /\b(pin|sicherheitscode|prüfziffer|pruefziffer|cvc)\b/i;

/** Wörter, hinter denen die Gutscheinnummer steht. */
const NUMMER_WORT =
  /\b(gutschein(?:nummer|code)?|code|karten(?:nummer)?|nummer|voucher|coupon)\b/i;

/** Wörter, hinter denen das Ablaufdatum steht. Ohne sie wäre jedes
 *  Datum im Beleg ein Kandidat - auch das Kaufdatum, und das ist der
 *  falsche Tag. */
const ABLAUF_WORT =
  /\b(gültig bis|gueltig bis|einlösbar bis|einloesbar bis|läuft ab|laeuft ab|ablauf|verfällt|verfaellt|valable jusqu|valid until|expires?)\b/i;

/**
 * Der Betrag im Beleg (rein, testbar).
 *
 * Genommen wird der grösste Frankenbetrag: Eine Bestätigungsmail nennt
 * gern auch Versandkosten, Rabatte und eine Bestellnummer - und der
 * Gutscheinwert ist von allen Zahlen die grösste, die mit einer Währung
 * dasteht. Zahlen ohne Währung bleiben aussen vor, sonst gewänne die
 * Bestellnummer.
 */
/** Aus «1'250,50», «1’250.–», «1 250.50» und «1.250,00» eine Zahl (rein, testbar).
 *
 *  Schweizer Belege trennen Tausender mit Apostroph oder schmalem
 *  Leerzeichen; deutsche Webshops, die in die Schweiz liefern, mit dem
 *  Punkt und dem Komma als Dezimalzeichen. Ein Punkt gefolgt von genau
 *  drei Ziffern und danach nichts oder ein Komma ist deshalb ein
 *  Tausender - «20.50» bleibt zwanzig Franken fünfzig. */
export function zahlAusBeleg(text: string): number {
  const eng = String(text ?? '').replace(/[’'\u00a0\u202f ]/g, '');
  if (/^[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?$/.test(eng)) {
    return parseFloat(eng.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(eng.replace(',', '.'));
}

export function betragAusText(text: string): { total: number; unit: Einheit } | null {
  const roh = String(text ?? '');
  const werte: number[] = [];
  // `[ \t]` und nicht `\s`, und ein Riegel gegen Buchstaben dahinter:
  // Mit `\s*(?:fr\.?)` las das Muster aus «… 2027\n\nFreundliche Grüsse»
  // einen Betrag von 2027 Franken - die Leerzeilen wanderten mit, und
  // «Fr» stand im nächsten Wort.
  const muster =
    /(?:chf|fr\.?|sfr\.?)[ \t]*([0-9]{1,6}(?:[’'\u00a0\u202f .][0-9]{3})*(?:[.,][0-9]{1,2})?)|([0-9]{1,6}(?:[’'\u00a0\u202f .][0-9]{3})*(?:[.,][0-9]{1,2})?)[ \t]*(?:chf|fr\.?|franken)(?![a-zäöüA-ZÄÖÜ])/gi;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(roh)) !== null) {
    const wert = zahlAusBeleg(treffer[1] ?? treffer[2] ?? '');
    if (Number.isFinite(wert) && wert > 0) werte.push(wert);
  }
  if (werte.length > 0) {
    return { total: Math.round(Math.max(...werte) * 100) / 100, unit: 'chf' };
  }
  // Kein Frankenbetrag: Vielleicht ein Stück-Gutschein («5 Eintritte»).
  const stueck = /\b([0-9]{1,3})\s*(eintritte?|stück|stueck|mal|besuche?|tickets?)\b/i.exec(roh);
  if (stueck) return { total: parseInt(stueck[1], 10), unit: 'stk' };
  return null;
}

/** Sieht das nach einer Gutscheinnummer aus? Mindestens acht Zeichen,
 *  Ziffern und Grossbuchstaben, gern mit Trennern - eine vierstellige
 *  Zahl ist eine Hausnummer. */
const NUMMER_MUSTER = /\b([A-Z0-9]{4,}(?:[-\s][A-Z0-9]{2,}){1,5}|[A-Z0-9]{8,24})\b/;

/** Ohne Ziffer ist es kein Code, sondern ein Wort. Sonst las das Muster
 *  «GUTSCHEINCODE» als Gutscheincode - die Überschrift ist lang genug
 *  und steht in Grossbuchstaben, sobald man die Zeile vergleichbar
 *  macht. */
const HAT_ZIFFER = /[0-9]/;

/**
 * Nummer und PIN aus dem Beleg (rein, testbar).
 *
 * Gesucht wird zeilenweise und nur dort, wo ein Wort darauf hindeutet.
 * Ohne diese Fesselung liest das Muster die Bestellnummer, die
 * Sendungsnummer und die IBAN mit - alle drei sehen aus wie eine
 * Gutscheinnummer, und keine davon hilft an der Kasse.
 */
export function nummerAusText(text: string): { number?: string; pin?: string } {
  const fund: { number?: string; pin?: string } = {};
  for (const zeile of String(text ?? '').split(/\r?\n/)) {
    const pin = PIN_WORT.exec(zeile);
    const nummer = NUMMER_WORT.exec(zeile);
    const wort = pin ?? nummer;
    if (!wort) continue;
    // Erst hinter dem Wort suchen: Sonst gewinnt die Überschrift selbst
    // («Gutscheincode» ist in Grossbuchstaben ein gültiger Code).
    const rest = zeile.slice((wort.index ?? 0) + wort[0].length).toUpperCase();
    const treffer = NUMMER_MUSTER.exec(rest);
    if (!treffer || !HAT_ZIFFER.test(treffer[1])) continue;
    if (pin && !fund.pin) {
      fund.pin = treffer[1].trim();
      continue;
    }
    if (nummer && !fund.number) fund.number = treffer[1].trim();
  }
  // Eine PIN steht oft als reine Ziffernfolge («PIN: 4711») - dafür ist
  // das Muster oben zu streng, und strenger darf es nicht sein.
  if (!fund.pin) {
    const kurz = /\b(?:pin|sicherheitscode)\b[^0-9a-z]{0,12}([0-9]{4,8})\b/i.exec(
      String(text ?? '')
    );
    if (kurz) fund.pin = kurz[1];
  }
  return fund;
}

/** Monatsnamen, wie sie in Belegen stehen. */
const MONATE: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mrz: 3, mar: 3,
  april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11,
  dezember: 12, dez: 12,
};

function iso(tag: number, monat: number, jahr: number): string | null {
  if (monat < 1 || monat > 12 || tag < 1 || tag > 31) return null;
  const voll = jahr < 100 ? 2000 + jahr : jahr;
  return `${voll}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/**
 * Das Ablaufdatum im Beleg (rein, testbar).
 *
 * Nur, wo ein Wort es ankündigt («gültig bis»). Ein Beleg trägt immer
 * ein Kaufdatum, und das als Ablauf zu übernehmen hiesse, den Gutschein
 * am Tag des Kaufs für verfallen zu erklären - der Fehler wäre nicht
 * bloss falsch, er wäre teuer.
 */
export function ablaufAusText(text: string): string | null {
  for (const zeile of String(text ?? '').split(/\r?\n/)) {
    if (!ABLAUF_WORT.test(zeile)) continue;
    const punkt = /\b([0-3]?[0-9])[./-]\s?([0-1]?[0-9])[./-]\s?((?:20)?[0-9]{2})\b/.exec(zeile);
    if (punkt) {
      const datum = iso(+punkt[1], +punkt[2], +punkt[3]);
      if (datum) return datum;
    }
    const wort = /\b([0-3]?[0-9])\.?\s+([A-Za-zäöüÄÖÜ]+)\s+((?:20)?[0-9]{2})\b/.exec(zeile);
    if (wort) {
      const monat = MONATE[wort[2].toLowerCase()];
      if (monat) {
        const datum = iso(+wort[1], monat, +wort[3]);
        if (datum) return datum;
      }
    }
    const nurMonat = /\b([A-Za-zäöüÄÖÜ]+)\s+((?:20)?[0-9]{2})\b/.exec(zeile);
    if (nurMonat) {
      const monat = MONATE[nurMonat[1].toLowerCase()];
      // Ohne Tag gilt der Monatsletzte: «gültig bis Dezember 2027»
      // heisst nicht «bis zum 1. Dezember».
      if (monat) {
        const jahr = +nurMonat[2] < 100 ? 2000 + +nurMonat[2] : +nurMonat[2];
        const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
        return iso(letzter, monat, jahr);
      }
    }
  }
  return null;
}

/**
 * Alles, was der Beleg hergibt (rein, testbar).
 *
 * Der Laden bleibt aussen vor, wenn er nicht mitgegeben wird: Aus einer
 * Mail den Absender zu raten, führt zu «noreply» als Ladennamen.
 */
export function belegLesen(text: string, laeden: string[] = []): Belegfund {
  const fund: Belegfund = {};
  const betrag = betragAusText(text);
  if (betrag) {
    fund.total = betrag.total;
    fund.unit = betrag.unit;
  }
  const nummern = nummerAusText(text);
  if (nummern.number) fund.number = nummern.number;
  if (nummern.pin) fund.pin = nummern.pin;
  const ablauf = ablaufAusText(text);
  if (ablauf) fund.expires = ablauf;
  // Der Laden nur, wenn er schon in der Sammlung steht: «Coop» im Text
  // zu finden ist einfach, aber nur dann eine Auskunft, wenn es «Coop»
  // als Laden auch wirklich gibt.
  const gross = String(text ?? '').toLowerCase();
  const treffer = laeden
    .filter((name) => name && gross.includes(name.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (treffer) fund.shop = treffer;
  return fund;
}

/**
 * Was der Vorschlag in einem Satz sagt (rein, testbar).
 *
 * Damit man vor dem Übernehmen sieht, was übernommen würde - und nicht
 * hinterher merkt, dass die Bestellnummer im Nummernfeld steht.
 */
export function belegSatz(fund: Belegfund): string {
  const teile: string[] = [];
  if (fund.shop) teile.push(fund.shop);
  if (fund.total !== undefined) {
    teile.push(fund.unit === 'stk' ? `${fund.total} Stück` : `CHF ${fund.total.toFixed(2)}`);
  }
  if (fund.number) teile.push(`Nr. ${fund.number}`);
  if (fund.pin) teile.push('PIN gefunden');
  if (fund.expires) teile.push(`gültig bis ${fund.expires.split('-').reverse().join('.')}`);
  return teile.length === 0 ? 'Nichts gefunden – bitte von Hand eintragen.' : teile.join(' · ');
}
