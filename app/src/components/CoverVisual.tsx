import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Polygon } from 'react-native-svg';

import { radius, useTheme } from '../theme';

/** Wetterlage, wie sie hinter dem Fenster erscheint. */
export type Sky =
  | 'clear'
  | 'partly'
  | 'clouds'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

interface Props {
  /** Offen in Prozent (100 = ganz offen, 0 = ganz zu). */
  open: number;
  /** Lamellenwinkel 0…100, falls es ein Raffstore ist. undefined = Rollladen. */
  tilt?: number;
  /** Aktuelle Wetterlage – bestimmt Himmel und Symbol. */
  sky?: Sky;
  /** Höhe des Fensters in der Kachel. */
  height?: number;
}

/** Ionicons-Symbol des Wetter-Geräts → Himmel-Kategorie. */
export function skyFromIcon(icon?: string, text?: string): Sky {
  const t = (text ?? '').toLowerCase();
  if (t.includes('nebel')) return 'fog';
  switch (icon) {
    case 'sunny-outline':
      return 'clear';
    case 'partly-sunny-outline':
      return 'partly';
    case 'rainy-outline':
      return 'rain';
    case 'snow-outline':
      return 'snow';
    case 'thunderstorm-outline':
      return 'storm';
    default:
      return 'clouds';
  }
}

// Himmelsfarben je Lage – erst hell, dann dunkel.
const SKIES: Record<Sky, { light: [string, string]; dark: [string, string] }> = {
  clear: { light: ['#7FB6F0', '#CFE8FF'], dark: ['#26405F', '#33567C'] },
  partly: { light: ['#8FBBEC', '#D6E9FB'], dark: ['#2A3F58', '#38506E'] },
  clouds: { light: ['#A7B6C6', '#CFD9E4'], dark: ['#2E3844', '#3C4756'] },
  fog: { light: ['#C2C7CD', '#DBDFE4'], dark: ['#333A42', '#454C55'] },
  rain: { light: ['#8492A2', '#B4BFCC'], dark: ['#28313B', '#39434F'] },
  snow: { light: ['#C6D0DB', '#E9EEF4'], dark: ['#333B45', '#48515C'] },
  storm: { light: ['#5F6A78', '#8A94A2'], dark: ['#20272F', '#333B45'] },
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Fenster mit Storen, die sich sichtbar bewegen – und dahinter das aktuelle
 * Wetter (Sonne, Wolken, Regen, Schnee, Nebel).
 *
 * Der Store ist ein voll­hoher Vorhang, der per translateY nach oben aus dem
 * Bild fährt (offen) oder herunterkommt (zu). Bei Raffstoren öffnen sich
 * zusätzlich die Lamellen – Position UND Winkel auf einen Blick.
 */
export function CoverVisual({ open, tilt, sky = 'clear', height = 128 }: Props) {
  const { dark } = useTheme();
  const styles = useMemo(() => makeStyles(), []);

  const closure = Math.max(0, Math.min(1, (100 - clamp(open)) / 100));
  const hasTilt = typeof tilt === 'number';
  const tiltOpen = hasTilt ? Math.max(0, Math.min(1, clamp(tilt as number) / 100)) : 0;

  const slide = useRef(new Animated.Value(closure)).current;
  const slat = useRef(new Animated.Value(tiltOpen)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: closure,
      duration: 850,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [closure, slide]);

  useEffect(() => {
    Animated.timing(slat, {
      toValue: tiltOpen,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [tiltOpen, slat]);

  const colours = (dark ? SKIES[sky].dark : SKIES[sky].light) as [string, string];

  // Store: volle Fensterhöhe hoch, nach oben herausgeschoben.
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] });

  // Lamellen: fixe Zahl Latten, heller Spalt darunter wächst mit dem Winkel.
  const unit = 15;
  const count = Math.ceil(height / unit) + 1;
  const maxGap = hasTilt ? unit * 0.6 : 1.2;
  const gap = slat.interpolate({ inputRange: [0, 1], outputRange: [hasTilt ? 1 : 1.2, maxGap] });

  // Für die Sprachausgabe ist das Bild sonst eine leere Fläche: Wer die
  // App vorlesen lässt, erfährt nirgends, wie weit die Store steht – die
  // Zahl trägt bisher allein das Bild.
  const gesprochen =
    `Store ${clamp(open)} % offen` +
    (hasTilt ? `, Lamellen ${clamp(tilt as number)} %` : '');

  return (
    <View
      style={[styles.frame, { height }]}
      accessibilityRole="image"
      accessibilityLabel={gesprochen}
    >
      <LinearGradient colors={colours} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <Weather sky={sky} height={height} />
      <View style={styles.mullion} />

      <View style={styles.clip}>
        <Animated.View style={[styles.shutter, { height, transform: [{ translateY }] }]}>
          {Array.from({ length: count }).map((_, i) => (
            <View key={i} style={{ height: unit }}>
              <View style={styles.slat} />
              <Animated.View style={[styles.gap, { height: gap }]} />
            </View>
          ))}
          <View style={styles.rail} />
        </Animated.View>
      </View>
      <View pointerEvents="none" style={styles.frameBorder} />
    </View>
  );
}

/** Eine weiche Wolke aus überlappenden Kreisen (SVG). */
function Cloud({ cx, cy, s, fill }: { cx: number; cy: number; s: number; fill: string }) {
  return (
    <G>
      <Ellipse cx={cx} cy={cy + 6 * s} rx={26 * s} ry={11 * s} fill={fill} />
      <Circle cx={cx - 14 * s} cy={cy} r={10 * s} fill={fill} />
      <Circle cx={cx} cy={cy - 6 * s} r={14 * s} fill={fill} />
      <Circle cx={cx + 14 * s} cy={cy + 1 * s} r={11 * s} fill={fill} />
    </G>
  );
}

/** Sonne mit Strahlenkranz (SVG). */
function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i;
    const x = Math.cos(a);
    const y = Math.sin(a);
    return (
      <Line
        key={i}
        x1={cx + x * (r + 4)}
        y1={cy + y * (r + 4)}
        x2={cx + x * (r + 11)}
        y2={cy + y * (r + 11)}
        stroke="#FFCB5E"
        strokeWidth={3}
        strokeLinecap="round"
      />
    );
  });
  return (
    <G>
      {rays}
      <Circle cx={cx} cy={cy} r={r} fill="#FFD36B" />
    </G>
  );
}

/** Gezeichnetes Wettermotiv hinter dem Fenster. */
function SkyScene({ sky }: { sky: Sky }) {
  const white = 'rgba(255,255,255,0.92)';
  const grey = 'rgba(214,221,230,0.95)';
  const darkGrey = 'rgba(150,160,175,0.95)';
  switch (sky) {
    case 'clear':
      return <Sun cx={128} cy={30} r={15} />;
    case 'partly':
      return (
        <G>
          <Sun cx={118} cy={24} r={12} />
          <Cloud cx={78} cy={42} s={1} fill={white} />
        </G>
      );
    case 'clouds':
      return (
        <G>
          <Cloud cx={58} cy={30} s={1.15} fill={white} />
          <Cloud cx={110} cy={46} s={0.9} fill={grey} />
        </G>
      );
    case 'fog':
      return (
        <G>
          <Cloud cx={80} cy={24} s={1} fill={grey} />
          {[46, 60, 74].map((y, i) => (
            <Line
              key={y}
              x1={22}
              y1={y}
              x2={138}
              y2={y}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.5 + i * 0.15}
            />
          ))}
        </G>
      );
    case 'rain':
      return <Cloud cx={80} cy={26} s={1.2} fill={grey} />;
    case 'snow':
      return <Cloud cx={80} cy={26} s={1.2} fill={white} />;
    case 'storm':
      return (
        <G>
          <Cloud cx={80} cy={24} s={1.2} fill={darkGrey} />
          <Polygon points="82,40 72,60 80,60 74,78 92,54 83,54 90,40" fill="#FFD23B" />
        </G>
      );
    default:
      return null;
  }
}

/** Wetter hinter dem Fenster: gezeichnetes Motiv plus fallender Regen/Schnee. */
function Weather({ sky, height }: { sky: Sky; height: number }) {
  const drop = useRef(new Animated.Value(0)).current;
  const wet = sky === 'rain' || sky === 'storm' || sky === 'snow';

  useEffect(() => {
    if (!wet) return;
    const loop = Animated.loop(
      Animated.timing(drop, {
        toValue: 1,
        duration: sky === 'snow' ? 2600 : 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [wet, sky, drop]);

  // Zwei gestapelte Reihen Tropfen/Flocken, um eine halbe Fensterhöhe nach
  // unten geschoben – so wirkt der Fall endlos.
  const fallY = drop.interpolate({ inputRange: [0, 1], outputRange: [0, height / 2] });
  const cols = [16, 32, 48, 64, 80]; // Prozent-Spalten über die Breite

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 160 ${Math.max(1, Math.round(height))}`}
        preserveAspectRatio="xMidYMid slice">
        <SkyScene sky={sky} />
      </Svg>
      {wet
        ? cols.map((leftPct, i) =>
            [0, 1].map((row) => (
              <Animated.View
                key={`${i}-${row}`}
                style={[
                  sky === 'snow' ? styles0.flake : styles0.raindrop,
                  {
                    left: `${leftPct}%`,
                    top: height * 0.42 - height / 2 + (row * height) / 2 + i * 8,
                    transform: [{ translateY: fallY }],
                  },
                ]}
              />
            ))
          )
        : null}
    </View>
  );
}

const styles0 = StyleSheet.create({
  raindrop: {
    position: 'absolute',
    width: 2,
    height: 11,
    borderRadius: 1,
    backgroundColor: 'rgba(205, 226, 246, 0.9)',
  },
  flake: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
});

const makeStyles = () =>
  StyleSheet.create({
    frame: {
      width: '100%',
      borderRadius: radius.control,
      overflow: 'hidden',
    },
    mullion: {
      position: 'absolute',
      left: '50%',
      top: 0,
      bottom: 0,
      width: 2,
      marginLeft: -1,
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
    },
    clip: {
      ...StyleSheet.absoluteFillObject,
      overflow: 'hidden',
    },
    shutter: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
    },
    slat: {
      flex: 1,
      backgroundColor: '#C6CCD6',
    },
    gap: {
      backgroundColor: 'rgba(255, 255, 255, 0.55)',
    },
    rail: {
      height: 6,
      backgroundColor: '#9AA1AD',
    },
    frameBorder: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.control,
      borderWidth: 3,
      borderColor: 'rgba(255, 255, 255, 0.85)',
    },
  });
