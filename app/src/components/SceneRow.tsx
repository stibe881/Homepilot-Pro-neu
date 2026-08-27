import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Scene } from '../api/types';
import { szenenFarben } from '../lib/szenenfarben';
import { Colors, radius, useColors } from '../theme';

/** Szenen als Reihe von Knöpfen – ein Tippen statt fünf. */
export function SceneRow({
  scenes,
  onActivate,
}: {
  scenes: Scene[];
  onActivate: (sceneId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (scenes.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {scenes.map((scene) => {
        // Gefüllt heisst: Der Raum steht gerade so, wie die Szene ihn
        // hinterlässt. Der Hub misst das am tatsächlichen Zustand - wer
        // danach das Licht von Hand anschaltet, hat die Szene verlassen,
        // und der Knopf geht von selbst wieder aus.
        const aktiv = !!scene.active;
        // Die Stimmung vor dem Drücken: die gewählten Farben der Szene
        // als Punkte (lib/szenenfarben.ts). «Kino» und «Lesen» sahen
        // sonst als Knöpfe gleich aus.
        const farben = szenenFarben(scene.actions);
        return (
          <Pressable
            key={scene.id}
            onPress={() => onActivate(scene.id)}
            accessibilityRole="switch"
            accessibilityState={{ checked: aktiv }}
            accessibilityLabel={
              aktiv ? `Szene ${scene.name} zurücknehmen` : `Szene ${scene.name}`
            }
            style={({ pressed }) => [
              styles.scene,
              aktiv && styles.sceneOn,
              pressed && { opacity: 0.65 },
            ]}
          >
            <Ionicons
              name={(scene.icon as keyof typeof Ionicons.glyphMap) || 'sparkles-outline'}
              size={17}
              color={aktiv ? '#FFFFFF' : colors.ink}
            />
            <Text style={[styles.label, aktiv && styles.labelOn]}>{scene.name}</Text>
            {farben.map((farbe) => (
              <View key={farbe} style={[styles.punkt, { backgroundColor: farbe }]} />
            ))}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Klein und randlos: Die Punkte sind eine Beilage zum Namen, kein
    // zweites Symbol.
    punkt: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginLeft: -2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0,0,0,0.2)',
    },
  strip: { height: 46, flexGrow: 0, flexShrink: 0 },
  row: { gap: 10, alignItems: 'center', paddingRight: 20 },
  sceneOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  labelOn: { color: '#FFFFFF' },
  scene: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
});
