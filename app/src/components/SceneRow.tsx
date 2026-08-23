import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Scene } from '../api/types';
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
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
