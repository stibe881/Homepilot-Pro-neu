/**
 * Das Kerntemperatur-Ziel eines Fleischfühlers.
 *
 * Gewünscht im Haus (Punkt 554): «Wenn der Grill die Zieltemperatur
 * erreicht hat, aber auch, wenn ein Kerntemperaturmesser das Ziel
 * erreicht hat.» Die erste Meldung braucht nichts weiter - der Sollwert
 * steht am Grill. Die zweite braucht ein Ziel je Fühler, und das setzt
 * man hier.
 *
 * Feste Stufen statt eines Zahlenfelds, dieselbe Überlegung wie bei der
 * Gartemperatur (screens/automations/szenengeraete.ts,
 * zieltemperaturen): Beim Grillen hat man fettige Finger und sucht
 * keine Tastatur. Die Stufen sind die, nach denen wirklich gefragt
 * wird - und sie tragen den Namen des Garpunkts, nicht bloss die Zahl:
 * «63°» beantwortet die Frage nicht, «Schwein 63°» schon.
 */

/**
 * Ist das ein Grill? (rein, testbar)
 *
 * Am Temperaturziel und nicht am Namen der Integration: Dieselbe Regel
 * wenden der Hub für die Live-Karte (core/livekarten.py, karten_grill)
 * und der Wächter für die Meldung an (core/watchdog.py, _check_grill) -
 * «erkennbar am Temperaturziel, das eine Waschmaschine nicht hat».
 *
 * Vorher stand hier `integration === 'pitboss'`. Das ist dasselbe
 * Gerät, aber die falsche Frage: Ein Grill einer anderen Anbindung bekam
 * die Spülmaschinen-Kachel, und der Prüfstand konnte die Grillkachel
 * überhaupt nie zeigen.
 */
export function istGrill(entity: {
  kind: string;
  state: Record<string, unknown>;
}): boolean {
  return entity.kind === 'appliance' && typeof entity.state?.target === 'number';
}

/** Eine angebotene Stufe. */
export interface Garstufe {
  /** In der Einheit des Grills. */
  wert: number;
  label: string;
}

const CELSIUS: Garstufe[] = [
  { wert: 49, label: 'Rind blutig 49°' },
  { wert: 54, label: 'Rind rosa 54°' },
  { wert: 58, label: 'Rind medium 58°' },
  { wert: 63, label: 'Schwein 63°' },
  { wert: 74, label: 'Poulet 74°' },
  { wert: 88, label: 'Pulled Pork 88°' },
];

//: Nicht umgerechnet, sondern die Zahlen, die in Fahrenheit-Rezepten
//: stehen. 49 °C sind 120,2 °F - und «120,2°» stünde auf keinem Knopf.
const FAHRENHEIT: Garstufe[] = [
  { wert: 120, label: 'Rind blutig 120°' },
  { wert: 130, label: 'Rind rosa 130°' },
  { wert: 137, label: 'Rind medium 137°' },
  { wert: 145, label: 'Schwein 145°' },
  { wert: 165, label: 'Poulet 165°' },
  { wert: 190, label: 'Pulled Pork 190°' },
];

/** Die angebotenen Garstufen zur Einheit des Grills (rein, testbar). */
export function garstufen(einheit: string | undefined): Garstufe[] {
  return String(einheit ?? '').includes('F') ? FAHRENHEIT : CELSIUS;
}

/**
 * Was die Zeile eines Fühlers sagt (rein, testbar).
 *
 * Ohne Ziel bleibt es bei der Temperatur - ein «Ziel –» wäre eine
 * Spalte, die bei jedem Fühler leer steht. Mit Ziel steht daneben, wie
 * weit es noch ist: Das ist beim Grillen die eigentliche Frage.
 */
export function fuehlerZeile(
  nummer: string,
  wert: number,
  ziel: number | null,
  einheit: string
): string {
  const jetzt = `Fühler ${nummer}: ${Math.round(wert)} ${einheit}`;
  if (ziel === null) return jetzt;
  if (wert >= ziel) return `${jetzt} · Ziel ${Math.round(ziel)} erreicht`;
  return `${jetzt} · noch ${Math.round(ziel - wert)} bis ${Math.round(ziel)}`;
}

/** Eine gespeicherte Zeile, wie der Hub sie schickt. */
export interface Zielzeile {
  entity_id: string;
  nummer: number | string;
  ziel: number | string;
}

/** Die gesetzten Ziele eines Grills, nach Fühlernummer (rein, testbar).
 *
 *  Als Zeilen und nicht als verschachteltes Wörterbuch: Der Hub legt
 *  sie so ab, weil sein Datenspeicher Listen führt
 *  (core/grillmeldung.py). Die Nummer bleibt hier Text, weil die
 *  Kachel mit Text-Schlüsseln aus `entity.state.probes` vergleicht. */
export function zieleVon(
  zeilen: Zielzeile[] | undefined,
  entityId: string
): Record<string, number> {
  const raus: Record<string, number> = {};
  for (const zeile of zeilen ?? []) {
    if (!zeile || zeile.entity_id !== entityId) continue;
    const zahl = Number(zeile.ziel);
    if (Number.isFinite(zahl)) raus[String(zeile.nummer)] = zahl;
  }
  return raus;
}


/** Ein Fühlerplatz auf dem Grillblatt - auch ein leerer (rein, testbar).
 *
 * Alle vier, immer: Die Hersteller-App zeigt vier Kreise, und drei
 * davon stehen leer da, solange nur einer steckt. Das ist richtig so -
 * man sieht auf einen Blick, welcher Platz noch frei ist, statt zu
 * zählen. Ein Kreis, der erst erscheint, wenn man den Fühler einsteckt,
 * liesse einen suchen, ob man den richtigen Anschluss erwischt hat.
 */
export interface Fuehlerplatz {
  nummer: string;
  /** Die gemessene Kerntemperatur - null heisst «nicht eingesteckt». */
  wert: number | null;
  ziel: number | null;
  /** Was im Kreis steht: «43°» oder «- - -°» - wie in der Hersteller-App. */
  anzeige: string;
}

export function fuehlerplaetze(
  probes: Record<string, number>,
  ziele: Record<string, number>
): Fuehlerplatz[] {
  return ['1', '2', '3', '4'].map((nummer) => {
    const roh = probes[nummer];
    const wert = typeof roh === 'number' ? roh : null;
    return {
      nummer,
      wert,
      ziel: ziele[nummer] ?? null,
      anzeige: wert === null ? '- - -°' : `${Math.round(wert)}°`,
    };
  });
}

/**
 * Wie weit der Grill ist, als Anteil zwischen 0 und 1 (rein, testbar).
 *
 * `null`, wo sich nichts sagen lässt - ein Balken ohne Grundlage
 * behauptet einen Fortschritt, den niemand gemessen hat.
 */
export function grillFortschritt(
  ist: number | undefined,
  ziel: number | undefined
): number | null {
  if (typeof ist !== 'number' || typeof ziel !== 'number' || ziel <= 0) return null;
  return Math.max(0, Math.min(1, ist / ziel));
}
