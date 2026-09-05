/**
 * Logos der Fernseh-Apps: aus «Netflix» wird das rote N, aus «Zattoo»
 * ein Schriftzug auf Markenfarbe.
 *
 * Auf der Fernbedienung und der Fernsehkachel standen die Dienste
 * bisher ausgeschrieben – sechs Wörter, wo auf jeder echten
 * Fernbedienung sechs Logos sitzen. Ein Logo erkennt man vom Sofa aus,
 * ohne zu lesen.
 *
 * Die Glyphen kommen aus MaterialCommunityIcons (liegt
 * @expo/vector-icons ohnehin bei, kein neues natives Modul). Dienste
 * ohne Glyphe (Zattoo, Disney+, Prime Video) bekommen einen kurzen
 * Schriftzug auf ihrer Markenfarbe. Unbekannte Apps bekommen gar kein
 * Logo – der Knopf zeigt dann wie bisher den Namen, denn ein falsches
 * oder erfundenes Logo wäre schlimmer als ein Wort.
 */

export interface TvLogo {
  /** Markenfarbe als Knopfgrund. */
  farbe: string;
  /** Glyphe aus MaterialCommunityIcons … */
  icon?: string;
  /** … oder ein kurzer Schriftzug, wo es keine Glyphe gibt. */
  schriftzug?: string;
}

// Die Namen, wie androidtv.py sie liefert (APP_NAMES/DEFAULT_APPS) –
// dazu die nackten Kurzformen, die in einer config.yaml stehen können
// («Prime», «Disney»). Schlüssel kleingeschrieben, siehe tvLogo().
const LOGOS: Record<string, TvLogo> = {
  netflix: { icon: 'netflix', farbe: '#E50914' },
  youtube: { icon: 'youtube', farbe: '#FF0000' },
  // YouTube Music hat kein eigenes Zeichen im Satz - das rote Dreieck
  // stimmt als Absender trotzdem.
  'youtube music': { icon: 'youtube', farbe: '#FF0000' },
  spotify: { icon: 'spotify', farbe: '#1DB954' },
  plex: { icon: 'plex', farbe: '#E5A00D' },
  kodi: { icon: 'kodi', farbe: '#17B2E7' },
  hulu: { icon: 'hulu', farbe: '#1CE783' },
  // Der ganze Schriftzug, nicht nur «Z»: Das Zattoo-Logo IST das Wort -
  // ein einzelner Buchstabe auf Schwarz las sich im Wohnzimmer nicht
  // als Logo, sondern als leerer Knopf.
  zattoo: { schriftzug: 'zattoo', farbe: '#000000' },
  'disney+': { schriftzug: 'D+', farbe: '#113CCF' },
  disney: { schriftzug: 'D+', farbe: '#113CCF' },
  'disney plus': { schriftzug: 'D+', farbe: '#113CCF' },
  'prime video': { schriftzug: 'prime', farbe: '#00A8E1' },
  prime: { schriftzug: 'prime', farbe: '#00A8E1' },
  // Wie das App-Symbol: weisses «joyn» auf dunklem Nachtblau.
  joyn: { schriftzug: 'joyn', farbe: '#131A3C' },
};

/** Das Logo zum App-Namen – oder null für Unbekanntes (rein, testbar). */
export function tvLogo(name: string): TvLogo | null {
  return LOGOS[name.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}
