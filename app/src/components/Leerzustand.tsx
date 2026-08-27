import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Leerbild } from '../lib/leerzustand';
import { Colors, radius, useColors } from '../theme';

/**
 * Eine leere Ansicht, die sagt, wie es weitergeht.
 *
 * Symbol, ein Titel, ein Satz – und wo es einen ersten Schritt gibt,
 * der Knopf dazu. Was hier steht, entscheidet lib/leerzustand.ts;
 * diese Komponente zeichnet nur.
 */
export function Leerzustand({
  bild,
  onAktion,
}: {
  bild: Leerbild;
  onAktion?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      <View style={styles.kreis}>
        <Ionicons
          name={bild.icon as keyof typeof Ionicons.glyphMap}
          size={30}
          color={colors.inkSoft}
        />
      </View>
      <Text style={styles.titel}>{bild.titel}</Text>
      <Text style={styles.satz}>{bild.satz}</Text>
      {bild.aktion && onAktion ? (
        <Pressable
          onPress={onAktion}
          accessibilityRole="button"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.knopfText}>{bild.aktion}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', gap: 8, paddingVertical: 36, paddingHorizontal: 24 },
    kreis: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 4,
    },
    titel: { color: colors.ink, fontSize: 16, fontWeight: '700' },
    satz: {
      color: colors.inkSoft,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      maxWidth: 340,
    },
    knopf: {
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 18,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    knopfText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  });
