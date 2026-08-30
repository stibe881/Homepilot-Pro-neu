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
import { stundeVon, tagesverlauf } from './lib/tagesverlauf';

export const lightColors = {
  gradient: ['#8B9AB0', '#6C7C94', '#556579'] as [string, string, ...string[]],

  surface: 'rgba(255, 255, 255, 0.78)',
  surfaceStrong: 'rgba(255, 255, 255, 0.94)',
  surfaceSoft: 'rgba(255, 255, 255, 0.26)',
  surfaceBorder: 'rgba(255, 255, 255, 0.6)',
  // Deckender Grund für Vollbild-Blätter (Editoren): anders als die Glas-
  // Flächen darf hier nichts durchscheinen, sonst kippt der Kontrast.
  panel: '#EDF0F5',

  // Die drei Tinten für Flächen (Karten, Felder, Chips).
  //
  // Gemessen auf einer Karte über dem Verlauf: `inkSoft` kam auf 3.8:1,
  // `inkFaint` auf 2.0:1 - Letzteres reicht für nichts, und in `inkFaint`
  // standen ganze Absätze. Jetzt trägt `inkSoft` 4.5:1 (die Schwelle für
  // Fliesstext) und `inkFaint` 3.6:1: leise, aber lesbar. Wer noch leiser
  // will, nimmt eine kleinere Schrift, keine blassere Farbe.
  ink: '#232833',
  inkSoft: '#5D6572',
  inkFaint: '#6D747F',

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
  inkFaint: '#8D96A3',

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
 * Schwarz und Neonpink.
 *
 * Zweimal hat dieses Erscheinungsbild danebengelegen, und beide Male aus
 * demselben Grund: **Die Fläche entscheidet, nicht der Knopf.** Sie füllt
 * den Bildschirm, er ist ein Punkt darauf.
 *
 * - Zuerst war der Grund Aubergine (Farbton 313–321 Grad). Das ist
 *   Violett, und das Erscheinungsbild las sich violett.
 * - Dann war er ein sattes Weinrot (Farbton 337 Grad, aber dunkel und
 *   bunt). Das ist Kastanie, und das Erscheinungsbild las sich braun.
 *
 * Jetzt ist der Grund schwarz. Nicht «sehr dunkles Rosa», sondern
 * schwarz, mit einem Hauch Pink ganz oben, damit der Verlauf noch eine
 * Richtung hat und die Glaskacheln etwas haben, wovor sie stehen. Das
 * Pink kommt nicht mehr aus der Fläche, sondern aus dem, was darauf
 * liegt: der Akzent leuchtet (Farbton 328 Grad, Sattheit 96 %), und die
 * Kacheln bekommen eine feine pinke Kante. Neon heisst genau das – eine
 * schmale, sehr helle Linie im Dunkeln, nicht eine grosse bunte Fläche.
 *
 * Zwei Farben bleiben bewusst aus der Familie heraus: «an» ist weiter
 * grün und «Gefahr» rot. Ein pinkes «an» neben einem pinken Knopf liesse
 * sich im Vorbeigehen nicht unterscheiden – und beim Warnen darf es keine
 * Verwechslung geben. Auf Schwarz dürfen beide heller sein als sonst.
 *
 * Die Zahlen dahinter hält `lib/kontrast.test.ts` fest: Auf Schwarz ist
 * jeder Wert deutlich besser als in den übrigen Paletten, und das soll so
 * bleiben, wenn hier jemand nachjustiert.
 */
export const pinkColors: Colors = {
  // Schwarz mit einem Hauch Pink im ersten Schritt – bei einer einzigen
  // durchgehend schwarzen Fläche verlöre der Verlauf seine Richtung, und
  // die Kacheln hätten keinen Grund, vor dem sie stehen.
  gradient: ['#1B0410', '#0C0207', '#000000'],

  // Die Glasflächen mit einem Hauch Warm: reines Weiss wirkt neben dem
  // Pink kalt und wie ein Fremdkörper. Etwas kräftiger als im dunklen
  // Erscheinungsbild – auf Schwarz verschwindet eine 10-Prozent-Kachel.
  surface: 'rgba(255, 235, 246, 0.11)',
  surfaceStrong: 'rgba(255, 235, 246, 0.19)',
  surfaceSoft: 'rgba(255, 235, 246, 0.07)',
  // Hier sitzt das Neon: eine schmale pinke Kante um jede Kachel. Sie ist
  // der eigentliche Träger des Erscheinungsbilds, nicht der Grund.
  surfaceBorder: 'rgba(255, 45, 149, 0.32)',
  panel: '#0A0307',

  ink: '#FFF0F7',
  inkSoft: '#C9A6BC',
  inkFaint: '#8E7080',

  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.72)',

  on: '#3BEFA6',
  onSoft: 'rgba(59, 239, 166, 0.18)',
  off: 'rgba(255, 235, 246, 0.16)',
  // Neonpink: Farbton 328 Grad, Sattheit 96 Prozent, volle Helligkeit.
  // Nicht 300 Grad – das wäre Magenta und damit wieder Violett.
  accent: '#FF0A8C',
  warn: '#FFC061',
  danger: '#FF5252',
  dangerSoft: 'rgba(255, 82, 82, 0.18)',

  track: 'rgba(255, 235, 246, 0.14)',
  warmCool: ['#E09A3E', '#F2EDE4', '#7FB2F0'],
};

/**
 * Mitternacht: Dunkel in Indigo.
 *
 * Für alle, denen das Blaugrau zu nüchtern ist und das Pink zu laut. Der
 * Grund liegt tief im Indigo (Farbton um 235 Grad), der Akzent ist ein
 * helles Perlblau aus derselben Familie – die Lehre aus dem
 * Pink-Erscheinungsbild: Die Fläche entscheidet, nicht der Knopf, und
 * Grund und Akzent müssen in dieselbe Familie gehören, sonst kippt der
 * Eindruck ins Unbestimmte.
 *
 * «An» bleibt grün, «Gefahr» bleibt rot – wie überall: Signale tragen
 * keine Mode.
 */
export const mitternachtColors: Colors = {
  gradient: ['#262848', '#1B1D38', '#121327'],

  // Die Glasflächen mit einem Hauch Indigo statt reinem Weiss – so
  // liegen sie im Grund, statt darauf zu schwimmen.
  surface: 'rgba(226, 229, 255, 0.10)',
  surfaceStrong: 'rgba(226, 229, 255, 0.18)',
  surfaceSoft: 'rgba(226, 229, 255, 0.07)',
  surfaceBorder: 'rgba(226, 229, 255, 0.15)',
  panel: '#1F2138',

  ink: '#EDEFFC',
  inkSoft: '#A8ACD2',
  inkFaint: '#8387AC',

  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.70)',

  on: '#3DDC84',
  onSoft: 'rgba(61, 220, 132, 0.18)',
  off: 'rgba(226, 229, 255, 0.16)',
  accent: '#8F92FF',
  warn: '#FFC061',
  danger: '#FF7B7B',
  dangerSoft: 'rgba(255, 123, 123, 0.18)',

  track: 'rgba(226, 229, 255, 0.13)',
  warmCool: ['#E09A3E', '#F2EDE4', '#7FB2F0'],
};

/**
 * Sand: Hell in Warm.
 *
 * Das helle Erscheinungsbild ist kühl – Blaugrau, Glas, Morgenlicht.
 * Sand ist dieselbe Form in warm: ein Grund wie Packpapier, Tinte statt
 * Anthrazit, und als Akzent Terracotta statt Blau. Gedacht für Räume
 * mit Holz und warmem Licht, wo das kühle Blau wie ein Fremdkörper
 * wirkt.
 *
 * Die Signale bleiben auch hier bei Grün und Rot; nur das Warn-Orange
 * ist eine Spur tiefer, damit es sich vom Terracotta des Akzents
 * unterscheidet und nicht im warmen Grund verschwimmt.
 */
export const sandColors: Colors = {
  gradient: ['#A98F6D', '#897254', '#69583F'],

  // Warmweiss statt Reinweiss: Auf Packpapier wirkt ein kaltes Weiss
  // wie aufgeklebt.
  surface: 'rgba(255, 251, 242, 0.80)',
  surfaceStrong: 'rgba(255, 252, 246, 0.95)',
  surfaceSoft: 'rgba(255, 251, 242, 0.28)',
  surfaceBorder: 'rgba(255, 255, 255, 0.6)',
  panel: '#F3ECDF',

  ink: '#33291C',
  inkSoft: '#6F6153',
  inkFaint: '#7D715F',

  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.80)',

  on: '#34C759',
  onSoft: 'rgba(52, 199, 89, 0.16)',
  off: 'rgba(51, 41, 28, 0.14)',
  accent: '#A94E26',
  warn: '#DF8A00',
  // Eine Stufe tiefer als im kühlen Hell: Das Warmweiss der Flächen ist
  // etwas heller, und das Standard-Rot fiel dort unter die Lesbarkeit.
  danger: '#D63438',
  dangerSoft: 'rgba(214, 52, 56, 0.16)',

  track: 'rgba(51, 41, 28, 0.10)',
  warmCool: ['#F5A524', '#FFFFFF', '#8CC5FF'],
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

export type ThemeMode =
  | 'system'
  | 'auto'
  | 'light'
  | 'dark'
  | 'pink'
  | 'mitternacht'
  | 'sand';

// Standardstandort (Zell LU) – wie beim Hub. Nur für die Sonnenstand-Automatik.
const DEFAULT_LAT = 47.13844;
const DEFAULT_LON = 7.92059;

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

  // Zwei Gründe, die Uhr zu beobachten - mit verschiedenen Takten.
  //
  // Im Zeitmodus entscheidet sie über hell und dunkel; das muss auf die
  // Minute stimmen, sonst steht die App nach dem Entsperren im falschen
  // Bild. Sonst wandert nur der Verlauf mit dem Tag (lib/tagesverlauf),
  // und der bewegt sich über Stunden - alle zehn Minuten genügt dafür
  // reichlich. Der Unterschied ist nicht kosmetisch: Jeder Tick erneuert
  // die Farben und damit den ganzen Baum.
  //
  // Der Takt schweigt im Hintergrund und holt beim Aufwachen sofort
  // nach.
  const wandernderVerlauf = mode === 'system' || mode === 'auto' || mode === 'light' || mode === 'dark';
  useTakt(
    () => setNow(new Date()),
    mode === 'auto' ? 60000 : wandernderVerlauf ? 600000 : null
  );

  const value = useMemo<ThemeValue>(() => {
    // Pink und Mitternacht sind dunkle Erscheinungsbilder, Sand ein
    // helles – alles, was sich nach `dark` richtet (Statusleiste,
    // Bilder, Kontraste), soll das auch wissen.
    const dark =
      mode === 'dark' || mode === 'pink' || mode === 'mitternacht'
        ? true
        : mode === 'light' || mode === 'sand'
          ? false
          : mode === 'auto'
            ? darkBySun(now)
            : scheme === 'dark';
    const colors =
      mode === 'pink'
        ? pinkColors
        : mode === 'mitternacht'
          ? mitternachtColors
          : mode === 'sand'
            ? sandColors
            : dark
              ? darkColors
              : lightColors;
    // Der Verlauf folgt dem Tag: warm um Sonnenauf- und -untergang,
    // kühler tief in der Nacht. Nur für die beiden Grundpaletten - Pink,
    // Mitternacht und Sand sind bewusst gewählte Bilder, an denen die
    // Uhrzeit nichts zu suchen hat.
    const getoent = wandernderVerlauf
      ? { ...colors, gradient: tagesverlauf(colors.gradient, stundeVon(now), sunHours(now)) }
      : colors;
    return { colors: getoent, dark, mode };
  }, [mode, scheme, now, wandernderVerlauf]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
