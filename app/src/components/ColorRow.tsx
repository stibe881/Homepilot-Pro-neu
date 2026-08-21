import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Colors, useColors } from '../theme';

/**
 * Farbwahl auf der Kachel – eine Reihe Punkte, kein Farbkreis.
 *
 * Ein Farbkreis sieht mächtiger aus und ist im Alltag unbrauchbar: Man
 * trifft mit dem Daumen nie zweimal dasselbe Orange, und «gestern war es
 * schöner» lässt sich nicht wiederherstellen. Eine feste Reihe ist
 * dagegen wiederholbar – und beim Sternenprojektor im Kinderzimmer ist
 * genau das die Frage: dasselbe Blau wie gestern.
 */

export interface Farbe {
  name: string;
  hex: string;
}

export const PALETTE: Farbe[] = [
  { name: 'Warmweiss', hex: '#FFD9A0' },
  { name: 'Rot', hex: '#FF2D2D' },
  { name: 'Orange', hex: '#FF8A00' },
  { name: 'Gelb', hex: '#FFE100' },
  { name: 'Grün', hex: '#2ED573' },
  { name: 'Türkis', hex: '#00D2D3' },
  { name: 'Blau', hex: '#2E7CFF' },
  { name: 'Violett', hex: '#8E44FF' },
  { name: 'Pink', hex: '#FF3FA4' },
];

/** Welcher Punkt gilt als gewählt? (rein, testbar)
 *
 * Verglichen wird nachsichtig: Das Gerät rechnet die Farbe über HSV und
 * gibt sie um ein, zwei Stufen verschoben zurück. Auf genaue Gleichheit
 * zu prüfen hiesse, dass nie ein Punkt markiert wäre.
 */
export function gewaehlteFarbe(aktuell: unknown, palette: Farbe[] = PALETTE): string | null {
  const rgb = zuRgb(aktuell);
  if (!rgb) return null;
  let beste: string | null = null;
  let kleinster = Infinity;
  for (const farbe of palette) {
    const kandidat = zuRgb(farbe.hex);
    if (!kandidat) continue;
    const abstand =
      (rgb[0] - kandidat[0]) ** 2 +
      (rgb[1] - kandidat[1]) ** 2 +
      (rgb[2] - kandidat[2]) ** 2;
    if (abstand < kleinster) {
      kleinster = abstand;
      beste = farbe.hex;
    }
  }
  // Zu weit weg heisst: Das Gerät leuchtet in etwas, das hier nicht
  // steht. Die Schwelle ist so gewählt, dass reines Rot noch als «Rot»
  // gilt (die Palette ist etwas entschärft), Blau gegen Türkis aber
  // getrennt bleibt.
  return kleinster <= 5000 ? beste : null;
}

function zuRgb(wert: unknown): [number, number, number] | null {
  if (typeof wert !== 'string') return null;
  let text = wert.trim().replace(/^#/, '');
  if (text.length === 3) text = text.split('').map((z) => z + z).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
  ];
}

export function ColorRow({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const aktiv = gewaehlteFarbe(entity.state.color);

  return (
    <View style={styles.box}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.reihe}
      >
        {PALETTE.map((farbe) => (
          <Pressable
            key={farbe.hex}
            onPress={() => onCommand('set_color', { color: farbe.hex })}
            accessibilityRole="button"
            accessibilityLabel={farbe.name}
            accessibilityState={{ selected: aktiv === farbe.hex }}
            hitSlop={4}
            style={({ pressed }) => [
              styles.punkt,
              { backgroundColor: farbe.hex },
              aktiv === farbe.hex && { borderColor: colors.ink, borderWidth: 2 },
              pressed && { opacity: 0.7 },
            ]}
          />
        ))}
      </ScrollView>
      {aktiv ? (
        <Text style={styles.hint}>
          {PALETTE.find((farbe) => farbe.hex === aktiv)?.name}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: { gap: 6 },
    reihe: { flexDirection: 'row', gap: 10, paddingVertical: 2 },
    punkt: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    hint: { color: colors.inkFaint, fontSize: 12 },
  });
