/**
 * Der Monats- und Jahresrückblick: aus den Zahlen des Hubs lesbare Sätze.
 *
 * Punkt 253 der Werkbank, App-Seite. Der Hub (core/langzeit.py) liefert
 * rohe Werte – Kilowattstunden, Prozentzahlen, Zählstände. Hier wird
 * daraus, was jemand am Frühstückstisch verstehen soll: «12 % mehr als
 * im Vormonat bis zum selben Tag». Der Zusatz «bis zum selben Tag» ist
 * kein Schmuck: Ohne ihn sähe am 6. des Monats jeder Vergleich mit dem
 * vollen Vormonat nach einer Ersparnis aus, die es nicht gibt.
 *
 * Alles hier ist reines Rechnen und Formulieren – die Ansicht steht in
 * screens/HausRueckblick.tsx.
 */

/** Der Stromteil bei zeitraum=monat, wie der Hub ihn schickt. */
export interface StromMonat {
  monat: string;
  aktuell_kwh: number;
  vormonat_kwh: number;
  vormonat_gesamt_kwh: number;
  vorjahresmonat_kwh?: number | null;
  trend_vormonat_prozent?: number | null;
  trend_vorjahr_prozent?: number | null;
}

/** Der Stromteil bei zeitraum=jahr. */
export interface StromJahr {
  jahr: string;
  aktuell_kwh: number;
  aktuell_tage: number;
  vorjahr_kwh?: number | null;
  vorjahr_tage: number;
  trend_vorjahr_prozent?: number | null;
}

export interface LichtEintrag {
  entity_id: string;
  count: number;
  name: string;
  room?: string | null;
}

export interface RaumTemperatur {
  raum: string;
  mittel_c: number;
  messwerte: number;
}

export interface TemperaturTeil {
  waermster: RaumTemperatur;
  kaeltester: RaumTemperatur;
  raeume: RaumTemperatur[];
}

export interface LangzeitAntwort {
  zeitraum: 'monat' | 'jahr';
  von: string;
  bis: string;
  strom: StromMonat | StromJahr | null;
  licht: LichtEintrag[];
  /** Reicht das Geräteprotokoll bis zum Zeitraumbeginn zurück? */
  licht_vollstaendig: boolean;
  temperatur: TemperaturTeil | null;
  /** Was fehlt und warum – Sätze des Hubs, hier gekürzt als Fussnote. */
  fehlt: string[];
}

/** Ob der Stromteil zum Jahr gehört (rein, testbar). */
export function istJahr(strom: StromMonat | StromJahr): strom is StromJahr {
  return 'jahr' in strom;
}

/**
 * Kilowattstunden als Text (rein, testbar).
 *
 * Unter 100 kWh eine Nachkommastelle, darüber keine: Bei 1'240 kWh
 * interessiert kein Zehntel, bei 8.5 kWh schon. Tausender mit dem
 * Schweizer Apostroph, von Hand statt über toLocaleString – dessen
 * Trennzeichen wechselt je nach Gerät, und die Sätze hier sollen auf
 * jedem Telefon gleich aussehen.
 */
export function kwhText(wert: number): string {
  const gerundet = wert >= 100 ? Math.round(wert) : Math.round(wert * 10) / 10;
  const [ganz, rest] = String(gerundet).split('.');
  const mitTrenner = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${mitTrenner}${rest ? `.${rest}` : ''} kWh`;
}

/**
 * Ein Trend mit Vorzeichen (rein, testbar).
 *
 * «12 %» allein liest sich als gute Nachricht – erst «+12 %» sagt, dass
 * es mehr wurde. Null Prozent bekommt «±0 %», damit die Zahl nicht wie
 * ein Fehler aussieht.
 */
export function trendText(prozent: number | null | undefined): string | null {
  if (prozent == null) return null;
  if (prozent === 0) return '±0 %';
  return `${prozent > 0 ? '+' : '−'}${Math.abs(prozent)} %`;
}

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/** «2026-09» → «September 2026» (rein, testbar). */
export function monatName(monat: string): string {
  const [jahr, nummer] = monat.split('-');
  const name = MONATE[Number(nummer) - 1];
  return jahr && name ? `${name} ${jahr}` : monat;
}

/** Die Überschrift des Zeitraums – aus dem `von` der Antwort, weil der
 *  Stromteil fehlen kann (rein, testbar). */
export function zeitraumTitel(zeitraum: 'monat' | 'jahr', von: string): string {
  if (zeitraum === 'jahr') return von.slice(0, 4);
  return monatName(von.slice(0, 7));
}

/**
 * Der Monats-Stromtrend als Sätze (rein, testbar).
 *
 * Der erste Satz vergleicht fair – Vormonat nur bis zum selben Tag –,
 * und sagt das auch, denn ohne die Einschränkung wirkt die Zahl falsch:
 * «142 kWh, Vormonat 310 kWh» läse sich wie eine halbierte Rechnung.
 */
export function stromMonatSaetze(strom: StromMonat): string[] {
  const saetze: string[] = [];
  const trend = strom.trend_vormonat_prozent;
  if (trend == null) {
    saetze.push(
      `Bisher ${kwhText(strom.aktuell_kwh)} – vom Vormonat gibt es bis zum ` +
        'selben Tag noch nichts zu vergleichen.'
    );
  } else {
    const richtung =
      trend === 0 ? 'gleich viel wie' : trend > 0 ? `${trend} % mehr als` : `${Math.abs(trend)} % weniger als`;
    saetze.push(
      `Bisher ${kwhText(strom.aktuell_kwh)} – ${richtung} im Vormonat bis zum ` +
        `selben Tag (${kwhText(strom.vormonat_kwh)}).`
    );
  }
  if (strom.vormonat_gesamt_kwh > 0) {
    saetze.push(`Der ganze Vormonat kam auf ${kwhText(strom.vormonat_gesamt_kwh)}.`);
  }
  const vorjahr = strom.vorjahresmonat_kwh;
  if (vorjahr != null && vorjahr > 0) {
    const zeichen = trendText(strom.trend_vorjahr_prozent);
    saetze.push(
      `Derselbe Monat vor einem Jahr: ${kwhText(vorjahr)}${zeichen ? ` (${zeichen})` : ''}.`
    );
  }
  return saetze;
}

/**
 * Der Jahres-Stromtrend als Sätze (rein, testbar).
 *
 * Die Tages-Zahlen reisen mit, weil die Mitschrift nur gut 13 Monate
 * hält: Ein Vorjahr mit 90 aufgezeichneten Tagen ist kein ganzes
 * Vorjahr, und das soll man sehen, statt es zu glauben.
 */
export function stromJahrSaetze(strom: StromJahr): string[] {
  const saetze = [
    `${strom.jahr}: bisher ${kwhText(strom.aktuell_kwh)} an ` +
      `${strom.aktuell_tage} aufgezeichneten Tagen.`,
  ];
  if (strom.vorjahr_kwh != null && strom.vorjahr_kwh > 0) {
    const zeichen = trendText(strom.trend_vorjahr_prozent);
    saetze.push(
      `Vorjahr bis zum selben Tag: ${kwhText(strom.vorjahr_kwh)} an ` +
        `${strom.vorjahr_tage} Tagen${zeichen ? ` (${zeichen})` : ''}.`
    );
  } else {
    saetze.push('Vom Vorjahr gibt es noch keine Vergleichswerte.');
  }
  return saetze;
}

/** «42-mal eingeschaltet · Küche» – die Zeile unter dem Lichtnamen
 *  (rein, testbar). */
export function lichtDetail(eintrag: LichtEintrag): string {
  const mal = eintrag.count === 1 ? 'einmal eingeschaltet' : `${eintrag.count}-mal eingeschaltet`;
  return eintrag.room ? `${mal} · ${eintrag.room}` : mal;
}

/**
 * Wärmster und kältester Raum in einem Satz (rein, testbar).
 *
 * Misst nur ein Raum, gibt es kein «wärmster und kältester» – dann sagt
 * der Satz das, statt denselben Raum zweimal zu krönen.
 */
export function temperaturSatz(teil: TemperaturTeil): string {
  const warm = teil.waermster;
  const kalt = teil.kaeltester;
  if (warm.raum === kalt.raum) {
    return `Nur ${warm.raum} misst – im Mittel ${warm.mittel_c} °C.`;
  }
  return (
    `Am wärmsten ${warm.raum} (im Mittel ${warm.mittel_c} °C), ` +
    `am kältesten ${kalt.raum} (${kalt.mittel_c} °C).`
  );
}

/**
 * Eine `fehlt`-Zeile des Hubs als kurze Fussnote (rein, testbar).
 *
 * Der Hub erklärt ausführlich («temperatur: Supabase nicht konfiguriert -
 * wärmster und kältester Raum brauchen die state_history»); als Fussnote
 * unter einer Karte reicht der Kern. Unbekanntes geht unverändert durch –
 * lieber ein langer Satz als ein verschluckter Grund.
 */
export function fussnote(eintrag: string): string {
  if (eintrag.startsWith('temperatur:')) {
    if (eintrag.includes('Supabase nicht konfiguriert')) {
      return 'Ohne Supabase fehlt die Temperatur.';
    }
    if (eintrag.includes('nicht erreichbar')) {
      return 'Supabase antwortet gerade nicht – die Temperatur fehlt deshalb.';
    }
    if (eintrag.includes('keine Messwerte')) {
      return 'Im Zeitraum gibt es noch keine Temperatur-Messwerte.';
    }
    if (eintrag.includes('kein Temperaturfühler')) {
      return 'Kein Temperaturfühler hat eine Raumzuordnung.';
    }
  }
  if (eintrag.startsWith('strom:')) {
    return 'Noch keine Strom-Mitschrift – es misst keine Steckdose mit Zähler.';
  }
  if (eintrag.startsWith('licht:')) {
    return 'Im Zeitraum ist kein Einschalten protokolliert.';
  }
  return eintrag;
}

/**
 * Alle Fussnoten der Antwort (rein, testbar).
 *
 * Das unvollständige Protokoll steht zuerst: Es betrifft Zahlen, die
 * *dastehen* – wer die Hitparade liest, soll zuerst erfahren, dass sie
 * eine Untergrenze ist.
 */
export function fussnoten(
  antwort: Pick<LangzeitAntwort, 'fehlt' | 'licht' | 'licht_vollstaendig'>
): string[] {
  const noten: string[] = [];
  if (antwort.licht.length > 0 && !antwort.licht_vollstaendig) {
    noten.push('Das Protokoll deckt den Zeitraum nicht ganz ab – die Zählung ist eine Untergrenze.');
  }
  for (const eintrag of antwort.fehlt) noten.push(fussnote(eintrag));
  return noten;
}
