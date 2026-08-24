/**
 * Einmal sagen, wo man gerade ist.
 *
 * Die Zonenüberwachung meldet nur *Übertritte*: Das Betriebssystem weckt
 * die App, wenn das Telefon eine Grenze kreuzt. Wer die Ortung
 * einschaltet, während er zuhause auf dem Sofa sitzt, kreuzt aber keine
 * Grenze – und der Hub führt ihn weiter als «unterwegs», bis er einmal
 * weggeht und wiederkommt. Genau dieser Fall stand in der App: «Stefan ·
 * unterwegs · seit 1 h 19 min», während Stefan in der Küche stand.
 *
 * Darum holt die App beim Einschalten (und auf Wunsch per Knopf) einmal
 * die aktuelle Position und meldet für jeden Ort, ob sie darin liegt.
 * Der Hub führt je Zone eine Liste der Orte, in denen sie steckt – also
 * gehört auch das «nicht drin» gemeldet, sonst bliebe ein alter Eintrag
 * ewig stehen.
 *
 * Reines Rechnen, damit sich der Grenzfall prüfen lässt, ohne durchs
 * Quartier zu laufen.
 */

export interface Ort {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

/** Der nächstgelegene Ort samt Abstand (rein, testbar). */
export function naechsterOrt(
  orte: Ort[],
  lat?: number,
  lon?: number
): { ort: Ort; meter: number } | null {
  if (!orte?.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const sortiert = orte
    .map((ort) => ({
      ort,
      meter: abstandMeter(lat as number, lon as number, ort.latitude, ort.longitude),
    }))
    .sort((a, b) => a.meter - b.meter);
  return sortiert[0] ?? null;
}

/** «800 m» oder «11.2 km» (rein, testbar). */
export function entfernung(meter: number): string {
  if (meter < 1000) return `${Math.round(meter / 10) * 10} m`;
  return `${(meter / 1000).toFixed(1)} km`;
}

/** Erdradius in Metern. */
const R = 6_371_000;

/** Abstand zweier Punkte in Metern (rein, testbar).
 *
 * Haversine: Auf den paar Kilometern, um die es hier geht, wäre auch die
 * flache Näherung genau genug - aber sie fällt bei einem Ort jenseits
 * des 180. Längengrads auseinander, und das zu wissen und trotzdem
 * falsch zu rechnen, lohnt die zehn Zeilen nicht. */
export function abstandMeter(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Steckt diese Position in diesem Ort? (rein, testbar) */
export function drinIn(ort: Ort, lat: number, lon: number): boolean {
  return abstandMeter(lat, lon, ort.latitude, ort.longitude) <= ort.radius;
}

// Hier stand `genauGenug`: «Ist die Messung feiner als der halbe Radius
// des engsten Ortes?» Wenn nicht, meldete die App gar nichts.
//
// Die Regel war richtig, solange enter/leave hinausging – ein
// entschiedenes «weg» aus einem groben Fix schaltet die Alarmanlage
// scharf. Seit die Position selbst gemeldet wird, ist sie schädlich, und
// zwar genau dort, wo es weh tut: Drinnen liefert das Telefon gern 60 bis
// 100 Meter Streuung, und ein einziger in der App erfasster Laden mit 50
// Metern Radius zieht die Schranke auf 25 Meter. Dann meldete die App im
// eigenen Wohnzimmer nie – und man stand «unterwegs», während man
// danebensass.
//
// Die Streuung reist stattdessen mit und wird beim Hub je Ort verrechnet
// (`presence.orte_fuer_position`). Dort ist sie richtig aufgehoben: Ein
// knappes «nicht drin» wird zum Nichtwissen und lässt stehen, was schon
// bekannt war; ein «drin» gilt, denn es schaltet nichts scharf. Der
// Unterschied ist «weiss ich für diesen Ort nicht» statt «sage lieber
// gar nichts».

/**
 * Was dem Hub zu melden ist (rein, testbar).
 *
 * Je Ort eine Zeile: «drin» als enter, «nicht drin» als leave. Die
 * Reihenfolge ist die der Orte - der Hub rechnet daraus selbst den
 * engsten aus.
 *
 * **Ein knappes «nicht drin» wird verschwiegen.** Genau daran stand
 * «Stefan · unterwegs», während Stefan zuhause war: Ein Fix, der das
 * Haus um 180 Meter verfehlt, aber selbst 70 Meter Streuung hat, sagt
 * nicht «draussen» – er sagt «weiss nicht». Bisher wurde daraus ein
 * entschiedenes `leave`, und «weg» ist keine harmlose Antwort: Daran
 * hängen Alarmanlage und «alles aus».
 *
 * Beim Ankommen bleibt es beim gemessenen Punkt. Ein «drin» ist die
 * vorsichtigere Richtung – es schaltet nichts scharf –, und wer es
 * strenger fasste, käme nie zuhause an.
 */
export function ortsMeldungen(
  orte: Ort[],
  lat: number,
  lon: number,
  genauigkeit?: number | null
): { place: string; event: 'enter' | 'leave' }[] {
  const streuung = Number(genauigkeit);
  const unsicher = Number.isFinite(streuung) && streuung > 0 ? streuung : 0;
  const meldungen: { place: string; event: 'enter' | 'leave' }[] = [];
  for (const ort of orte ?? []) {
    const meter = abstandMeter(lat, lon, ort.latitude, ort.longitude);
    if (meter <= ort.radius) {
      meldungen.push({ place: ort.id, event: 'enter' });
    } else if (meter > ort.radius + unsicher) {
      meldungen.push({ place: ort.id, event: 'leave' });
    }
    // Dazwischen: nichts melden. Der Hub behält, was er wusste.
  }
  return meldungen;
}

/** Orte, über die die Messung nichts aussagt (rein, testbar).
 *
 * Für den Satz nach dem Melden: Wer «Jetzt melden» drückt und nichts
 * passiert, soll erfahren, warum – und nicht raten, ob der Knopf kaputt
 * ist. */
export function unsichereOrte(
  orte: Ort[],
  lat: number,
  lon: number,
  genauigkeit?: number | null
): Ort[] {
  const streuung = Number(genauigkeit);
  if (!Number.isFinite(streuung) || streuung <= 0) return [];
  return (orte ?? []).filter((ort) => {
    const meter = abstandMeter(lat, lon, ort.latitude, ort.longitude);
    return meter > ort.radius && meter <= ort.radius + streuung;
  });
}

/**
 * Der Satz nach dem Melden (rein, testbar).
 *
 * Steht man in keinem Ort, gehört die Entfernung zum nächsten dazu. Genau
 * daran erkennt man den stillen Einrichtungsfehler: Fehlt `location:` in
 * der config.yaml, liegt der Hauskreis auf der Voreinstellung - wer
 * woanders wohnt, ist dann dauerhaft «unterwegs», ohne dass irgendwo
 * etwas kaputt aussieht. «Der nächste Ort liegt 11.2 km entfernt» sagt
 * es in einem Satz.
 */
export function meldungsText(
  orte: Ort[],
  meldungen: { place: string; event: string }[],
  lat?: number,
  lon?: number,
  unsicher: Ort[] = []
): string {
  const drin = meldungen.filter((eintrag) => eintrag.event === 'enter');
  if (drin.length === 0) {
    const weg = naechsterOrt(orte, lat, lon);
    // Knapp daneben und zu ungenau, um es zu entscheiden: Dann wurde
    // bewusst nichts gemeldet, und genau das gehört dagestanden. Sonst
    // drückt man den Knopf ein zweites Mal und wundert sich.
    if (unsicher.length > 0 && weg) {
      return (
        `Zu ungenau, um «${unsicher[0].name}» zu entscheiden – der Ort liegt ` +
        `${entfernung(weg.meter)} entfernt. Nichts gemeldet; draussen oder ` +
        'am Fenster nochmal.'
      );
    }
    return weg
      ? `Gemeldet: unterwegs. Der nächste Ort (${weg.ort.name}) liegt ${entfernung(
          weg.meter
        )} entfernt.`
      : 'Gemeldet: unterwegs.';
  }
  // Der engste Ort ist der, der etwas aussagt: «Zuhause» schlägt
  // «Quartier», in dem man ebenfalls steht.
  const namen = drin
    .map((eintrag) => orte.find((ort) => ort.id === eintrag.place))
    .filter((ort): ort is Ort => !!ort)
    .sort((a, b) => a.radius - b.radius);
  return `Gemeldet: ${namen[0]?.name ?? 'zuhause'}.`;
}
