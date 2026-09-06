import { epochTime, localTime } from './zeit';

/**
 * Welche Hülle läuft hier eigentlich? – die Zeile für die Befund-Kästen
 * der Widget-Einstellungen.
 *
 * Entstanden aus einer Schlaufe, die anders nicht zu durchbrechen war:
 * «Die installierte App kennt die Widget-Ablage noch nicht» stand da,
 * der neuste TestFlight-Build war installiert, und jedes Bildschirmfoto
 * der Warnung liess offen, auf *welchem* Build es entstanden war – die
 * Warnung sah auf der alten und der neuen Hülle gleich aus. Steht der
 * Build direkt in der Warnung, beantwortet ein einziges Foto beide
 * Fragen: Was sagt der Befund, und von welcher Hülle stammt er.
 */

/**
 * Der Bau-Zeitpunkt aus der Build-Nummer, als ISO-Text (rein, testbar).
 *
 * Die Nummer sind Minuten seit 1970 (deploy/rebuild-hub.sh setzt sie
 * so). Ältere Zählweisen – Commit-Anzahl, Handvergaben wie «2» – sind
 * um Grössenordnungen kleiner und ergeben kein Datum; sie kommen ohne
 * Zeitangabe zurück, statt als «1. Januar 1970» aufzutreten.
 */
export function bauZeitIso(nummer: string | null | undefined): string | null {
  if (!nummer || !/^\d+$/.test(nummer)) return null;
  const minuten = Number(nummer);
  // 19 Mio. Minuten ≈ 2006 – alles darunter ist keine Minuten-Nummer.
  if (minuten < 19_000_000) return null;
  return new Date(minuten * 60_000).toISOString();
}

/**
 * «Diese Hülle: Build 29811236 (gebaut 06.09.2026, 07:56) · Laufzeit 5»
 * (rein, testbar). Leer, wenn nichts über die Hülle bekannt ist – im
 * Browser etwa gibt es weder Build-Nummer noch Laufzeit.
 */
export function huelleZeile(
  buildNummer: string | null | undefined,
  laufzeit: string | null | undefined
): string {
  const teile: string[] = [];
  if (buildNummer) {
    const iso = bauZeitIso(buildNummer);
    const wann = iso ? localTime(iso) : '';
    teile.push(wann ? `Build ${buildNummer} (gebaut ${wann})` : `Build ${buildNummer}`);
  }
  if (laufzeit) teile.push(`Laufzeit ${laufzeit}`);
  return teile.length > 0 ? `Diese Hülle: ${teile.join(' · ')}` : '';
}

/**
 * Die Innenansicht der Warnung «App kennt die Widget-Ablage noch nicht»
 * (rein, testbar).
 *
 * Sie trennt, was die Warnung allein nicht trennen konnte: Fehlt das
 * Modul wirklich im Build, fehlt gleich das ganze expo-Objekt, oder
 * meldet die Hülle Module unter anderen Namen? Solange «Hülle zu alt»
 * auch auf dem frisch gebauten Build stand, war jede dieser Ursachen
 * gleich unsichtbar - jetzt steht die Antwort im Bildschirmfoto.
 */
export function ablageDiagnose(
  expoDa: boolean,
  moduleNamen: string[],
  gefunden: boolean
): string {
  // Gefunden heisst: nichts zu diagnostizieren - die Warnung, zu der
  // diese Zeile gehört, dürfte dann gar nicht dastehen.
  if (gefunden) return '';
  if (!expoDa) return 'Innenansicht: Das expo-Objekt fehlt im JavaScript ganz.';
  if (moduleNamen.length === 0) {
    // Dann ist nicht dieses eine Modul das Problem, sondern die Liste
    // selbst - etwa, weil sie sich nicht aufzählen lässt.
    return 'Innenansicht: Die Hülle meldet gar keine nativen Module.';
  }
  const verwandt = moduleNamen
    .filter((name) => /storage|extension|widget/i.test(name))
    .slice(0, 4);
  if (verwandt.length > 0) {
    const liste = verwandt.map((name) => `«${name}»`).join(', ');
    return `Innenansicht: ${moduleNamen.length} native Module gemeldet; verwandt klingen ${liste} - «ExtensionStorage» selbst fehlt.`;
  }
  return `Innenansicht: ${moduleNamen.length} native Module gemeldet, keines heisst «ExtensionStorage».`;
}

/**
 * Der Satz zur grünen Erfolgsmeldung: was zurückgelesen wurde und ob
 * das Widget selbst schon eine Lesespur hinterlassen hat (rein,
 * testbar).
 *
 * Die Spur ist der einzige Beweis über die Prozessgrenze: Erfolg beim
 * Zurücklesen kann auch heissen, dass App und Widget je in ihren
 * eigenen Topf schreiben (Signierprofil ohne App-Gruppe) - dann sieht
 * die App «alles gut» und das Widget trotzdem nichts. Fehlt die Spur,
 * sagt der Satz das offen, statt Erfolg zu behaupten.
 */
export function ablageStand(
  knoepfe: number | null,
  spurEpoch: number | null
): string {
  const teile: string[] = [];
  if (knoepfe != null) {
    teile.push(
      knoepfe === 1
        ? '1 Knopf liegt zurückgelesen in der Ablage'
        : `${knoepfe} Knöpfe liegen zurückgelesen in der Ablage`
    );
  }
  teile.push(
    spurEpoch != null
      ? `das Widget hat zuletzt ${epochTime(spurEpoch)} daraus gelesen`
      : 'eine Lesespur des Widgets liegt noch nicht da'
  );
  const satz = teile.join('; ');
  return `${satz.charAt(0).toUpperCase()}${satz.slice(1)}.`;
}
