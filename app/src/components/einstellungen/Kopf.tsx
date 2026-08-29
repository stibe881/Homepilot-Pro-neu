/**
 * Die Kopfzeile einer Einstellungsseite auf dem Telefon.
 *
 * Vorher stand hier die Begrüssung («Guten Abend, Stefan») und darunter
 * eine schiebbare Zeile mit fünfzehn Pillen. Beides war an dieser Stelle
 * falsch: Die Begrüssung nahm siebzig Punkte Höhe für etwas, das man
 * beim Einrichten nicht braucht, und in der Pillenzeile waren drei
 * Punkte sichtbar und zwölf hinter dem rechten Rand – wer «System»
 * wollte, schob blind.
 *
 * Jetzt: links zurück zur Übersicht, in der Mitte der Name der Seite,
 * und der Name selbst ist der Wechsler. Ein Tipp darauf öffnet das
 * Blatt mit allen Bereichen (Wechselblatt.tsx). Damit ist jedes Ziel
 * zwei Tipps weit weg – immer dieselben zwei, ohne Suchen.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MAX_SCHRIFT } from '../../lib/schrift';
import { Colors, radius, useColors } from '../../theme';

export function EinstellungsKopf({
  titel,
  onZurueck,
  onWechseln,
}: {
  titel: string;
  /** Zurück zur Übersicht. Fehlt er, steht man schon dort. */
  onZurueck?: () => void;
  /** Öffnet das Blatt mit allen Bereichen. Fehlt er, gibt es nichts zu wechseln. */
  onWechseln?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.zeile}>
      {onZurueck ? (
        <Pressable
          onPress={onZurueck}
          accessibilityRole="button"
          accessibilityLabel="Zurück zu den Einstellungen"
          hitSlop={8}
          style={({ pressed }) => [styles.zurueck, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onGradient} />
        </Pressable>
      ) : null}

      <Pressable
        onPress={onWechseln}
        disabled={!onWechseln}
        accessibilityRole={onWechseln ? 'button' : 'header'}
        accessibilityLabel={onWechseln ? `${titel} – Bereich wechseln` : titel}
        style={({ pressed }) => [styles.titelKnopf, pressed && { opacity: 0.75 }]}
      >
        <Text style={styles.titel} numberOfLines={1} maxFontSizeMultiplier={MAX_SCHRIFT}>
          {titel}
        </Text>
        {onWechseln ? (
          <Ionicons name="chevron-down" size={17} color={colors.onGradientSoft} />
        ) : null}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
    zurueck: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -6,
    },
    titelKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      paddingVertical: 4,
    },
    titel: {
      color: colors.onGradient,
      fontSize: 25,
      fontWeight: '700',
      flexShrink: 1,
    },
  });
