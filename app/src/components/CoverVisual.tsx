import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

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

  return (
    <View style={[styles.frame, { height }]}>
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

/** Wetter-Symbol hinter dem Fenster – je nach Lage Sonne, Wolke, Tropfen … */
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

  const sun = sky === 'clear' || sky === 'partly';
  const cloud = sky !== 'clear';

  // Zwei gestapelte Reihen Tropfen/Flocken, um eine Fensterhöhe nach unten
  // geschoben – so wirkt der Fall endlos.
  const fallY = drop.interpolate({ inputRange: [0, 1], outputRange: [0, height / 2] });
  const cols = [12, 30, 48, 66, 84]; // Prozent-Spalten über die Breite

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {sun ? (
        <View style={[styles0.sun, sky === 'partly' && { opacity: 0.9 }]} />
      ) : null}
      {cloud ? (
        <>
          <View style={[styles0.cloud, { top: 16, left: '14%' }]} />
          <View style={[styles0.cloudSmall, { top: 30, left: '52%' }]} />
        </>
      ) : null}
      {sky === 'fog' ? (
        <>
          <View style={[styles0.haze, { top: height * 0.45 }]} />
          <View style={[styles0.haze, { top: height * 0.62, opacity: 0.5 }]} />
          <View style={[styles0.haze, { top: height * 0.78, opacity: 0.7 }]} />
        </>
      ) : null}
      {wet
        ? cols.map((leftPct, i) =>
            [0, 1].map((row) => (
              <Animated.View
                key={`${i}-${row}`}
                style={[
                  sky === 'snow' ? styles0.flake : styles0.raindrop,
                  {
                    left: `${leftPct}%`,
                    top: -height / 2 + (row * height) / 2 + i * 9,
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
  sun: {
    position: 'absolute',
    top: 14,
    right: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 214, 120, 0.95)',
    shadowColor: '#FFD678',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  cloud: {
    position: 'absolute',
    width: 60,
    height: 22,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  cloudSmall: {
    position: 'absolute',
    width: 40,
    height: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  haze: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  raindrop: {
    position: 'absolute',
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: 'rgba(210, 228, 245, 0.85)',
  },
  flake: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
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
