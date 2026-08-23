/**
 * Skalierte Zutatenmengen so schreiben, wie man in einer Küche spricht
 * (Punkt 147 der Werkbank).
 *
 * Wer von 4 auf 3 Portionen stellt, soll «¾ TL» und «190 g» lesen, nicht
 * «0,75 TL» und «187,5 g». Niemand wiegt 187,5 Gramm ab – die Anzeige
 * täte nur so, als ginge das.
 *
 * Gerundet wird nur beim Skalieren: Was jemand selbst erfasst hat, wird
 * unverändert angezeigt (und beim Bearbeiten unverändert zurückgegeben).
 */

// Die Brüche, die auf Messlöffeln und in Rezepten wirklich vorkommen.
// Achtel bewusst nicht: «⅜ TL» liest niemand flüssig.
const BRUECHE: [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

/** Eine skalierte Menge küchentauglich schreiben (rein, testbar). */
export function kuechenMenge(wert: number): string {
  if (!Number.isFinite(wert) || wert < 0) return String(wert);
  // Grosse Mengen: auf Waagen-Schritte runden. Ab 100 auf 5er (187,5 g
  // → 190 g), ab 20 auf ganze - feiner misst in einer Küche niemand.
  if (wert >= 100) return String(Math.round(wert / 5) * 5);
  if (wert >= 20) return String(Math.round(wert));

  // Kleine Mengen: ganzer Anteil plus nächstliegender Bruch, wenn einer
  // nahe genug liegt («nahe genug» = 0,05 - mehr wäre gelogen).
  const ganz = Math.floor(wert);
  const rest = wert - ganz;
  if (rest < 0.05) return ganz === 0 && wert > 0 ? naturbelassen(wert) : String(ganz);
  if (rest > 0.95) return String(ganz + 1);
  for (const [bruch, zeichen] of BRUECHE) {
    if (Math.abs(rest - bruch) <= 0.05) {
      return ganz > 0 ? `${ganz}${zeichen}` : zeichen;
    }
  }
  return naturbelassen(wert);
}

/** Ohne passenden Bruch: zwei Stellen, Komma statt Punkt. */
function naturbelassen(wert: number): string {
  const gerundet = Math.round(wert * 100) / 100;
  return String(gerundet).replace('.', ',');
}

/** Menge skaliert auf die gewählten Portionen, hübsch formatiert (rein).
 *
 *  Küchenrundung nur beim wirklichen Skalieren: Bei Faktor 1 bleibt
 *  stehen, was jemand erfasst hat – sonst veränderte schon das
 *  Bearbeiten-Formular die Mengen. */
export function scaledAmount(amount: unknown, factor: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount ?? '');
  const scaled = value * factor;
  if (factor !== 1) return kuechenMenge(scaled);
  const rounded = Math.round(scaled * 100) / 100;
  return String(Number.isInteger(rounded) ? rounded : rounded).replace('.', ',');
}


// ── Mengen zusammenzählen ────────────────────────────────────────────────
//
// Der Fall: Im Wocheneinkauf brauchen zwei Rezepte Milch. Bisher kam nur
// die erste auf die Liste, die zweite fiel als «steht schon drauf» weg –
// und im Laden stand man mit 400 ml da, wo 600 gebraucht wurden. Das
// merkte niemand, weil nichts fehlte, was man sehen konnte.
//
// Zusammengezählt wird nur innerhalb einer Familie: Milliliter und Gramm
// lassen sich nicht verrechnen, «2 EL» und «1 Prise» auch nicht. Was
// nicht zusammenpasst, bleibt nebeneinander stehen («400 ml + 2 Stück»)
// statt zu einer erfundenen Zahl zu verschmelzen.

/** Eine Menge. `wert === null` heisst: keine Zahl, nur Text («etwas»). */
export interface Menge {
  wert: number | null;
  einheit: string;
  /** Wie es dastand – für alles, was sich nicht rechnen lässt. */
  roh: string;
}

/**
 * Einheiten, die sich ineinander umrechnen lassen.
 *
 * `basis` ist die kleinste; `gross` die, in der ab 1000 Basiseinheiten
 * geschrieben wird. Deziliter stehen mit drin, weil Schweizer Rezepte sie
 * benutzen – 5 dl sollen 5 dl bleiben und nicht zu 500 ml werden.
 */
const FAMILIEN: { basis: string; gross: string; faktoren: Record<string, number> }[] = [
  {
    basis: 'ml',
    gross: 'l',
    faktoren: { ml: 1, cl: 10, dl: 100, l: 1000, liter: 1000 },
  },
  {
    basis: 'g',
    gross: 'kg',
    faktoren: { g: 1, gramm: 1, kg: 1000, kilo: 1000 },
  },
];

function familieVon(einheit: string) {
  const klein = einheit.toLowerCase();
  return FAMILIEN.find((familie) => klein in familie.faktoren);
}

/** Eine einzelne Angabe lesen: «400 ml» → {400, ml} (rein, testbar). */
export function mengeLesen(text: string): Menge {
  const roh = String(text ?? '').trim();
  const treffer = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(roh);
  if (!treffer) return { wert: null, einheit: '', roh };
  return {
    wert: Number(treffer[1].replace(',', '.')),
    einheit: treffer[2].trim(),
    roh,
  };
}

/** Eine gespeicherte Angabe lesen – auch eine zusammengesetzte
 *  («400 ml + 2 Stück») (rein, testbar). */
export function mengenLesen(text: string): Menge[] {
  return String(text ?? '')
    .split('+')
    .map((teil) => teil.trim())
    .filter(Boolean)
    .map(mengeLesen);
}

/** Eine Menge schreiben (rein, testbar). */
export function mengeSchreiben(menge: Menge): string {
  if (menge.wert === null) return menge.roh;
  return menge.einheit ? `${kuechenMenge(menge.wert)} ${menge.einheit}` : kuechenMenge(menge.wert);
}

/** Mehrere Mengen schreiben, mit «+» zwischen dem, was nicht zusammenpasst. */
export function mengenSchreiben(mengen: Menge[]): string {
  return mengen.map(mengeSchreiben).filter(Boolean).join(' + ');
}

/**
 * Zwei Mengen zusammenzählen, wenn sie zusammenpassen (rein, testbar).
 *
 * `null` heisst: passt nicht, beide bleiben stehen.
 */
function addiere(a: Menge, b: Menge): Menge | null {
  if (a.wert === null || b.wert === null) {
    // Zwei gleich lautende Textangaben sind immer noch eine – «etwas
    // Salz» und «etwas Salz» wird nicht «2 etwas Salz».
    return a.roh.toLowerCase() === b.roh.toLowerCase() ? a : null;
  }
  const familieA = familieVon(a.einheit);
  const familieB = familieVon(b.einheit);
  if (familieA && familieA === familieB) {
    const summe =
      a.wert * familieA.faktoren[a.einheit.toLowerCase()] +
      b.wert * familieA.faktoren[b.einheit.toLowerCase()];
    // Ab tausend Basiseinheiten die grosse: 500 g + 500 g sind ein Kilo,
    // nicht «1000 g».
    if (summe >= 1000) {
      return { wert: summe / 1000, einheit: familieA.gross, roh: '' };
    }
    // Sonst die gemeinsame Einheit behalten, wo es eine gibt: 2 dl + 3 dl
    // sind 5 dl und nicht 500 ml.
    if (a.einheit.toLowerCase() === b.einheit.toLowerCase()) {
      return { wert: summe / familieA.faktoren[a.einheit.toLowerCase()], einheit: a.einheit, roh: '' };
    }
    return { wert: summe, einheit: familieA.basis, roh: '' };
  }
  // Ausserhalb der Familien nur bei genau derselben Einheit: «2 EL» plus
  // «1 EL» sind drei, «2 EL» plus «1 Prise» sind zweierlei.
  if (a.einheit.toLowerCase() === b.einheit.toLowerCase()) {
    return { wert: a.wert + b.wert, einheit: a.einheit, roh: '' };
  }
  return null;
}

/**
 * Zwei gespeicherte Angaben zusammenzählen (rein, testbar).
 *
 * Leere Angaben fallen weg: Wer «Salz» ohne Menge und «1 Prise Salz»
 * zusammenlegt, bekommt «1 Prise».
 */
export function mengenAddieren(a: string, b: string): string {
  const alle = [...mengenLesen(a), ...mengenLesen(b)];
  const ergebnis: Menge[] = [];
  for (const menge of alle) {
    let gelegt = false;
    for (let i = 0; i < ergebnis.length; i += 1) {
      const summe = addiere(ergebnis[i], menge);
      if (summe) {
        ergebnis[i] = summe;
        gelegt = true;
        break;
      }
    }
    if (!gelegt) ergebnis.push(menge);
  }
  return mengenSchreiben(ergebnis);
}
