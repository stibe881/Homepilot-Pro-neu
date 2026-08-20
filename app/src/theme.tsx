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

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

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

  track: 'rgba(255, 255, 255, 0.13)',
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

/** Ab dieser Breite ist Platz für Seitenleiste und rechte Spalte. */
// sidePanel bei 1000: Ein iPad im Querformat misst je nach Modell 1024
// bis 1180 Punkte. Bei 1100 fielen die kleineren durch das Raster und
// zeigten Wetter und Player untereinander statt rechts - obwohl der Platz
// dafür da ist. Im Hochformat (768-834) bleibt es bewusst einspaltig.
export const breakpoints = { rail: 760, sidePanel: 1000 };

export type ThemeMode = 'system' | 'auto' | 'light' | 'dark';

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

  // Nur im Zeitmodus muss die Uhr überhaupt beobachtet werden.
  useEffect(() => {
    if (mode !== 'auto') return;
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, [mode]);

  const value = useMemo<ThemeValue>(() => {
    const dark =
      mode === 'dark'
        ? true
        : mode === 'light'
          ? false
          : mode === 'auto'
            ? darkBySun(now)
            : scheme === 'dark';
    return { colors: dark ? darkColors : lightColors, dark, mode };
  }, [mode, scheme, now]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
