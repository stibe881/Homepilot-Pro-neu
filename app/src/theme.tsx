/**
 * Zwei Paletten, ein Kontext.
 *
 * Tagsüber helle Glaskacheln auf kühlem Verlauf, nachts dieselbe Form in
 * dunkel – eine App, die man morgens und abends im Bett öffnet, darf um
 * 23 Uhr keine Taschenlampe sein.
 *
 * Die Farben kommen über `useColors()` in die Komponenten, damit ein
 * Wechsel sofort greift; feste Werte (Abstände, Rundungen) bleiben
 * ausserhalb, weil sie sich nicht ändern.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useTakt } from './hooks/useTakt';

export const lightColors = {
  gradient: ['#8B9AB0', '#6C7C94', '#556579'] as [string, string, ...string[]],

  surface: 'rgba(255, 255, 255, 0.78)',
  surfaceStrong: 'rgba(255, 255, 255, 0.94)',
  surfaceSoft: 'rgba(255, 255, 255, 0.26)',
  surfaceBorder: 'rgba(255, 255, 255, 0.6)',
  // Deckender Grund für Vollbild-Blätter (Editoren): anders als die Glas-
  // Flächen darf hier nichts durchscheinen, sonst kippt der Kontrast.
  panel: '#EDF0F5',

  ink: '#232833',
  inkSoft: '#69727F',
  inkFaint: '#98A0AC',

  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.78)',

  on: '#34C759',
  onSoft: 'rgba(52, 199, 89, 0.16)',
  off: 'rgba(35, 40, 51, 0.14)',
  accent: '#2F6BF6',
  warn: '#F5A524',
  danger: '#E5484D',
  // Wie onSoft, nur zum Warnen: eine ganze Kachel in kräftigem Rot
  // schreit, ein Hauch davon zeigt hin. Für die aufgeschlossene Türe.
  dangerSoft: 'rgba(229, 72, 77, 0.16)',

  track: 'rgba(35, 40, 51, 0.10)',
  warmCool: ['#F5A524', '#FFFFFF', '#8CC5FF'] as [string, string, ...string[]],
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  // Tiefes Blaugrau statt Schwarz: Der Verlauf bleibt erkennbar, und die
  // Glaskacheln haben etwas, wovor sie stehen können.
  gradient: ['#2B3341', '#212832', '#171C24'],

  surface: 'rgba(255, 255, 255, 0.10)',
  surfaceStrong: 'rgba(255, 255, 255, 0.18)',
  surfaceSoft: 'rgba(255, 255, 255, 0.07)',
  surfaceBorder: 'rgba(255, 255, 255, 0.14)',
  panel: '#20262F',

  ink: '#EDF1F7',
  inkSoft: '#A2ACBB',
  inkFaint: '#727C8B',

  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.68)',

  // Auf dunklem Grund brauchen die Signalfarben mehr Helligkeit, sonst
  // verschwinden sie.
  on: '#3DDC84',
  onSoft: 'rgba(61, 220, 132, 0.18)',
  off: 'rgba(255, 255, 255, 0.16)',
  accent: '#6E9BFF',
  warn: '#FFC061',
  danger: '#FF7B7B',
  dangerSoft: 'rgba(255, 123, 123, 0.18)',

  track: 'rgba(255, 255, 255, 0.13)',
  warmCool: ['#E09A3E', '#F2EDE4', '#7FB2F0'],
};

/**
 * Dunkel in Pink.
 *
 * Dieselben Rollen wie das dunkle Erscheinungsbild, nur in einer anderen
 * Familie: Der Grund geht ins Rosé statt ins Blaugrau, und was
 * hervorsticht, ist pink statt blau.
 *
 * Der Grund war lange Aubergine, und genau daran lag es, dass das
 * Erscheinungsbild violett wirkte statt pink: Der Akzent stand bei einem
 * Farbton von 334 Grad - klares Pink -, der Grund aber bei 313 bis 321,
 * und das ist Violett. Die Fläche entscheidet, nicht der Knopf: Sie
 * füllt den Bildschirm, er ist ein Punkt darauf. Jetzt liegen beide in
 * derselben Familie, und die Sattheit des Grundes ist höher - ein
 * gedämpftes Rosa in dieser Dunkelheit liest sich sonst kastanienbraun.
 *
 * Zwei Farben bleiben bewusst aus der Familie heraus: «an» ist weiter
 * grün und «Gefahr» rot. Ein pinkes «an» neben einem pinken Knopf liesse
 * sich im Vorbeigehen nicht unterscheiden – und beim Warnen darf es keine
 * Verwechslung geben. Deshalb ist das Rot hier ein klares Rot und kein
 * Lachston, der neben dem Pink verschwämme.
 */
export const pinkColors: Colors = {
  gradient: ['#552036', '#3C1626', '#280E19'],

  // Die Glasflächen mit einem Hauch Warm: reines Weiss wirkt auf dem
  // Rosé-Grund kalt und wie ein Fremdkörper.
  surface: 'rgba(255, 240, 248, 0.10)',
  surfaceStrong: 'rgba(255, 240, 248, 0.18)',
  surfaceSoft: 'rgba(255, 240, 248, 0.07)',
  surfaceBorder: 'rgba(255, 240, 248, 0.15)',
  panel: '#311923',

  ink: '#F8EDF1',
  inkSoft: '#C4A6B1',
  inkFaint: '#90757F',

  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.72)',

  on: '#4CD9A4',
  onSoft: 'rgba(76, 217, 164, 0.18)',
  off: 'rgba(255, 240, 248, 0.16)',
  accent: '#FF74B0',
  warn: '#FFC061',
  danger: '#FF5252',
  dangerSoft: 'rgba(255, 82, 82, 0.18)',

  track: 'rgba(255, 240, 248, 0.14)',
  warmCool: ['#E09A3E', '#F2EDE4', '#7FB2F0'],
};

export const radius = { card: 26, control: 18, pill: 999 };
export const space = { gap: 14, page: 22 };
export const type = {
  greeting: 34,
  greetingSmall: 25,
  cardTitle: 16,
  cardSub: 13,
  value: 26,
  label: 14,
};

/**
 * Ab dieser Breite ist Platz für Seitenleiste und rechte Spalte.
 *
 * Die Zahlen stammen aus dieser Wohnung und nicht aus der Browser-Welt.
 * Was hier tatsächlich vorkommt, in Punkten:
 *
 * | Gerät | hoch | quer |
 * | --- | --- | --- |
 * | iPhone | 375–430 | 812–932 |
 * | iPad mini | **744** | 1133 |
 * | iPad 10.9" | 820 | 1180 |
 * | iPad Pro 11" | 834 | 1194 |
 * | iPad Pro 12.9" | 1024 | 1366 |
 * | iPad geteilt (Split View) | 320–507 | – |
 *
 * `rail` bei 700 und nicht bei 760: Dazwischen liegt genau der iPad mini
 * im Hochformat mit 744. Mit 760 sah er aus wie ein sehr grosses Telefon
 * – ohne Seitenleiste, obwohl der Platz dafür längst da ist. Unter 700
 * kommt nur noch die geteilte Ansicht, und dort ist die Telefon-
 * Darstellung richtig.
 *
 * `sidePanel` bleibt bei 1000: Ein iPad im Querformat misst je nach
 * Modell 1024 bis 1180. Bei 1100 fielen die kleineren durch das Raster
 * und zeigten Wetter und Player untereinander statt rechts. Im Hochformat
 * bekommt nur das 12,9-Zoll-iPad (1024) die rechte Spalte – bei ihm
 * bleiben daneben immer noch über 600 Punkte für die Kacheln.
 */
export const breakpoints = { rail: 700, sidePanel: 1000 };

export type ThemeMode = 'system' | 'auto' | 'light' | 'dark' | 'pink';

// Standardstandort (Zell LU) – wie beim Hub. Nur für die Sonnenstand-Automatik.
const DEFAULT_LAT = 47.1445;
const DEFAULT_LON = 8.0675;

/** Sonnenauf-/-untergang als lokale Stunden (Näherung, rein/testbar).
 *  Reicht fürs Umschalten des Erscheinungsbilds – auf die Minute genau
 *  muss es nicht sein. Gibt bei Polartag/-nacht null zurück. */
export function sunHours(
  now: Date,
  lat = DEFAULT_LAT,
  lon = DEFAULT_LON
): { sunrise: number; sunset: number } | null {
  const rad = Math.PI / 180;
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const declination = -23.44 * rad * Math.cos((rad * 360 * (dayOfYear + 10)) / 365);
  const cosH = -Math.tan(lat * rad) * Math.tan(declination);
  if (cosH >= 1 || cosH <= -1) return null; // Polarnacht bzw. -tag
  const halfDay = Math.acos(cosH) / rad / 15; // Stunden zwischen Mittag und Untergang
  const tzOffset = -now.getTimezoneOffset() / 60; // lokale Abweichung zu UTC
  const solarNoon = 12 - lon / 15 + tzOffset;
  return { sunrise: solarNoon - halfDay, sunset: solarNoon + halfDay };
}

/** Ist es gerade dunkel? Nach echtem Sonnenstand, sonst 20–7 Uhr als Notnagel. */
function darkBySun(now: Date): boolean {
  const times = sunHours(now);
  if (!times) {
    const hour = now.getHours();
    return hour >= 20 || hour < 7;
  }
  const hour = now.getHours() + now.getMinutes() / 60;
  return hour < times.sunrise || hour >= times.sunset;
}

interface ThemeValue {
  colors: Colors;
  dark: boolean;
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeValue>({
  colors: lightColors,
  dark: false,
  mode: 'system',
});

export function ThemeProvider({
  mode = 'system',
  children,
}: {
  mode?: ThemeMode;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme();
  const [now, setNow] = useState(() => new Date());

  // Nur im Zeitmodus muss die Uhr überhaupt beobachtet werden - und der
  // Takt schweigt im Hintergrund, holt aber beim Aufwachen sofort nach:
  // So stimmt hell/dunkel gleich nach dem Entsperren.
  useTakt(() => setNow(new Date()), mode === 'auto' ? 60000 : null);

  const value = useMemo<ThemeValue>(() => {
    // Pink ist ein dunkles Erscheinungsbild – alles, was sich nach
    // `dark` richtet (Statusleiste, Bilder, Kontraste), soll es auch hier.
    const dark =
      mode === 'dark' || mode === 'pink'
        ? true
        : mode === 'light'
          ? false
          : mode === 'auto'
            ? darkBySun(now)
            : scheme === 'dark';
    const colors = mode === 'pink' ? pinkColors : dark ? darkColors : lightColors;
    return { colors, dark, mode };
  }, [mode, scheme, now]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
