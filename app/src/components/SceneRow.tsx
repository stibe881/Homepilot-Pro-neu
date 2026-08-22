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
      {scenes.map((scene) => (
        <Pressable
          key={scene.id}
          onPress={() => onActivate(scene.id)}
          accessibilityRole="button"
          accessibilityLabel={`Szene ${scene.name}`}
          style={({ pressed }) => [styles.scene, pressed && { opacity: 0.65 }]}
        >
          <Ionicons
            name={(scene.icon as keyof typeof Ionicons.glyphMap) || 'sparkles-outline'}
            size={17}
            color={colors.ink}
          />
          <Text style={styles.label}>{scene.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  strip: { height: 46, flexGrow: 0, flexShrink: 0 },
  row: { gap: 10, alignItems: 'center', paddingRight: 20 },
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
