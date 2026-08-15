import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { radius, useTheme } from '../theme';

interface Props {
  /** Offen in Prozent (100 = ganz offen, 0 = ganz zu). */
  open: number;
  /** Lamellenwinkel 0…100, falls es ein Raffstore ist. undefined = Rollladen. */
  tilt?: number;
  /** Höhe des Fensters in der Kachel. */
  height?: number;
}

const WINDOW = { light: ['#BFE3FF', '#E9F5FF'], dark: ['#2C4064', '#1B2637'] } as const;

/**
 * Fenster mit Storen, die sich sichtbar bewegen.
 *
 * Der Store ist ein voll­hoher Vorhang, der per translateY nach oben aus dem
 * Bild fährt (offen) oder herunterkommt (zu) – das erklärt sich von selbst.
 * Bei Raffstoren öffnen sich zusätzlich die Lamellen (Spalt zwischen den
 * Latten), sodass man Position UND Winkel auf einen Blick sieht.
 */
export function CoverVisual({ open, tilt, height = 128 }: Props) {
  const { colors, dark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Geschlossenheit: 0 = ganz offen, 1 = ganz zu.
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

  const sky = (dark ? WINDOW.dark : WINDOW.light) as unknown as [string, string];

  // Der Store ist volle Fensterhöhe hoch und wird nach oben herausgeschoben.
  // translateY: closure 1 → 0 (deckt alles), closure 0 → -height (weg).
  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-height, 0],
  });

  // Lamellen: eine feste Zahl Latten, der helle Spalt darunter wächst mit dem
  // Winkel. Rollläden (kein tilt) haben nur einen Haardünnen Trennstrich.
  const unit = 15;
  const count = Math.ceil(height / unit) + 1;
  const maxGap = hasTilt ? unit * 0.6 : 1.2;
  const gap = slat.interpolate({ inputRange: [0, 1], outputRange: [hasTilt ? 1 : 1.2, maxGap] });

  return (
    <View style={[styles.frame, { height }]}>
      <LinearGradient colors={sky} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Sonne, damit „offen“ freundlich wirkt. */}
      <View style={styles.sun} />
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

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    frame: {
      width: '100%',
      borderRadius: radius.control,
      overflow: 'hidden',
      backgroundColor: colors.track,
    },
    sun: {
      position: 'absolute',
      top: 14,
      right: 18,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: 'rgba(255, 214, 120, 0.9)',
    },
    mullion: {
      position: 'absolute',
      left: '50%',
      top: 0,
      bottom: 0,
      width: 2,
      marginLeft: -1,
      backgroundColor: 'rgba(255, 255, 255, 0.35)',
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
      // Der helle Spalt = einfallendes Licht zwischen den Lamellen.
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
      borderColor: colors.surfaceStrong,
    },
  });
