/**
 * Das App-Symbol wirklich umschalten – je Plattform anders.
 *
 * iOS und Android können das von sich aus, brauchen dafür aber ein
 * natives Modul und Symbole, die beim Bauen mit ins Paket gehen: Ein
 * Symbol lässt sich nicht nachladen. Der Browser kann es überhaupt
 * nicht von sich aus – dort tauschen wir schlicht den `<link rel=icon>`
 * aus, und der Tab folgt sofort.
 *
 * Alles hier ist unkritisch: Schlägt der Wechsel fehl, bleibt das alte
 * Symbol stehen. Ein Haus, das falsch eingefärbt ist, ist kein Grund,
 * einen Fehler vor jemanden hinzustellen.
 */
import { Platform } from 'react-native';

import { Symbolwahl, faviconPfad, gueltig } from './appsymbol';

/** Im Browser den Favicon austauschen (rein bis auf das DOM). */
function faviconSetzen(wahl: Symbolwahl): void {
  if (typeof document === 'undefined') return;
  const pfad = faviconPfad(wahl);
  // Alle vorhandenen mitnehmen: Expo legt einen `icon` an, manche
  // Browser lesen zusätzlich `shortcut icon` - bliebe einer stehen,
  // zeigte der Tab je nach Browser das alte Haus.
  const vorhandene = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
  );
  if (vorhandene.length === 0) {
    const neu = document.createElement('link');
    neu.rel = 'icon';
    neu.href = pfad;
    document.head.appendChild(neu);
    return;
  }
  for (const link of vorhandene) {
    link.href = pfad;
    // Der Typ passt sonst nicht mehr: Der blaue ist ein .ico, der pinke
    // ein .png. Safari nimmt einen falsch angekündigten Typ krumm.
    link.type = pfad.endsWith('.ico') ? 'image/x-icon' : 'image/png';
  }
}

/**
 * Das Symbol wechseln. Liefert `true`, wenn es geklappt hat.
 *
 * Das native Modul wird erst hier geladen und nicht oben in der Datei:
 * Im Web gibt es es nicht, und ein Import auf oberster Ebene brächte
 * den Bündler dazu, es trotzdem mitzunehmen.
 */
export async function symbolWechseln(wunsch: Symbolwahl): Promise<boolean> {
  const wahl = gueltig(wunsch);
  if (Platform.OS === 'web') {
    faviconSetzen(wahl);
    return true;
  }
  try {
    const modul = await import('expo-alternate-app-icons');
    if (!modul.supportsAlternateIcons) return false;
    await modul.setAlternateAppIcon(wahl);
    return true;
  } catch {
    // Alte Fassung ohne das Modul, oder das Gerät mag nicht.
    return false;
  }
}

/**
 * Kann dieses Gerät das Symbol überhaupt wechseln?
 *
 * Der Browser immer (es ist nur ein Tab-Bild). Auf dem Telefon hängt es
 * am nativen Modul – wer eine ältere Fassung der App hat, soll keinen
 * Schalter sehen, der nichts tut.
 */
export async function kannWechseln(): Promise<boolean> {
  if (Platform.OS === 'web') return typeof document !== 'undefined';
  try {
    const modul = await import('expo-alternate-app-icons');
    return !!modul.supportsAlternateIcons;
  } catch {
    return false;
  }
}
