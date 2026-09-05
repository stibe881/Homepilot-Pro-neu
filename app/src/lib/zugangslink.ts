/**
 * Zugang aus einem Einladungslink – für Gäste ohne App.
 *
 * Der Fall: Besuch soll das Licht schalten können, will aber keine App
 * laden. Die Einladungsseite des Hubs bietet dafür «Im Browser öffnen»
 * an: einen Link auf die Web-Fassung mit den Zugangsdaten im
 * **Fragment** (`/#zugang=…`). Das Fragment verlässt den Browser nie –
 * es steht in keiner Server-Anfrage und in keinem Protokoll; nur die
 * Seite selbst kann es lesen.
 *
 * Beim Start liest App.tsx das Fragment, speichert die Daten wie eine
 * gewöhnliche Anmeldung und wischt die Adresszeile sauber – der Link in
 * der Chronik des Browsers soll den Zugang nicht ein zweites Mal
 * hergeben. Der Link selbst ist ohnehin einmalig: Ihn gibt nur die
 * eingelöste Einladung heraus (hub: api/routes/einladungen.py).
 *
 * Hier die entscheidbare Hälfte (rein, testbar): Was ist ein gültiges
 * Fragment, und was steht darin?
 */

/** Das Wort vor dem Gleichheitszeichen im Fragment. Dasselbe steht im
 *  Hub (api/routes/einladungen.py) – wer es ändert, ändert beide. */
export const MARKE = 'zugang';

export interface LinkZugang {
  url: string;
  token: string;
  name?: string;
}

/**
 * Die Zugangsdaten aus dem Fragment (rein, testbar).
 *
 * `null` heisst: kein Zugang in diesem Fragment – ein gewöhnlicher
 * Start. Nachsichtig gegen alles andere: Ein kaputtes Fragment ist ein
 * gewöhnlicher Start, kein Absturz vor dem ersten Bild.
 */
export function zugangAusFragment(fragment: string | null | undefined): LinkZugang | null {
  const roh = String(fragment ?? '');
  const start = roh.indexOf(`${MARKE}=`);
  if (start < 0) return null;
  let geparst: unknown;
  try {
    geparst = JSON.parse(decodeURIComponent(roh.slice(start + MARKE.length + 1)));
  } catch {
    return null;
  }
  if (typeof geparst !== 'object' || geparst === null) return null;
  const eintrag = geparst as Record<string, unknown>;
  const url = String(eintrag.url ?? '').trim().replace(/\/+$/, '');
  const token = String(eintrag.token ?? '').trim();
  // Nur echte Hub-Adressen: Ein Fragment, das «javascript:» oder einen
  // blossen Pfad enthält, ergäbe eine App, die ins Leere ruft.
  if (!/^https?:\/\//.test(url) || !token) return null;
  const name = String(eintrag.name ?? '').trim();
  return name ? { url, token, name } : { url, token };
}
