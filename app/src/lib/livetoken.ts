/**
 * Welche Token-Meldung wohin gehört - und was davon nachzuholen ist.
 *
 * Die Karten auf dem Sperrbildschirm startet der Hub per Push; beenden
 * kann er sie nur mit dem Aktivitäts-Token, das allein die App kennt
 * (hooks/useLiveAktivitaet.ts). Kommt dieses Token nie an, bleibt die
 * Karte liegen - der gemeldete Fall: «Der Fernseher ist aus, die
 * Meldung ist immer noch da.»
 *
 * Deshalb hebt das native Modul jedes Token auf, das kommt, bevor JS
 * zuhört (LiveAktivitaetModule, `offeneTokens`). Hier wird daraus, was
 * gemeldet werden muss.
 *
 * Reines Rechnen, damit die Zuordnung prüfbar bleibt: Ein Token an der
 * falschen Adresse ist genau so wirkungslos wie gar keines, sieht aber
 * nach Arbeit aus.
 */

/** Ein aufgehobenes Token, wie das native Modul es zurückgibt. */
export interface OffenesToken {
  /** «onStartToken» oder «onActivityToken». */
  ereignis?: string;
  token?: string;
  /** «tuer» oder «haus» - Apple stellt Start-Tokens je Strukturtyp aus. */
  typ?: string;
  /** Nur bei den generischen Karten: zu welcher Karte das Token gehört. */
  art?: string;
}

export interface Tokenmeldung {
  pfad: string;
  daten: Record<string, string>;
}

/**
 * Aus den aufgehobenen Tokens die Meldungen an den Hub (rein, testbar).
 *
 * Dieselben zwei Adressen wie im laufenden Betrieb: Start-Tokens
 * melden das Telefon an, Aktivitäts-Tokens gehören zu einer laufenden
 * Karte. Ohne `token` ist nichts zu melden - eine leere Meldung träte
 * beim Hub an die Stelle einer richtigen.
 */
export function tokenmeldungen(offen: OffenesToken[]): Tokenmeldung[] {
  const meldungen: Tokenmeldung[] = [];
  for (const eintrag of offen ?? []) {
    const token = String(eintrag?.token ?? '').trim();
    if (!token) continue;
    if (eintrag.ereignis === 'onStartToken') {
      meldungen.push({
        pfad: '/api/liveactivity/register',
        daten: { token, typ: eintrag.typ ?? 'tuer' },
      });
    } else if (eintrag.ereignis === 'onActivityToken') {
      meldungen.push({
        pfad: '/api/liveactivity/activity',
        daten: { token, art: eintrag.art ?? '' },
      });
    }
  }
  return meldungen;
}

/**
 * Die Wartezeiten zwischen zwei Versuchen, in Millisekunden.
 *
 * Drei Versuche und dann Schluss: Weckt iOS die App nur kurz auf, weil
 * gerade eine Karte gestartet wurde, ist das Telefon vielleicht noch
 * gar nicht im WLAN daheim - der erste Versuch geht dann ins Leere,
 * und ohne Wiederholung wäre das Token für immer verloren. Länger als
 * eine halbe Minute zu warten lohnt nicht: So lange gibt iOS der App
 * ohnehin nicht.
 */
export const VERSUCHE_MS = [0, 3000, 9000];
