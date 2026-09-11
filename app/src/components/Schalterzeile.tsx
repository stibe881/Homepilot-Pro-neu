import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

/**
 * Ein Schalter mit Titel und Erklärung – eine Zeile, überall gleich.
 *
 * Dieselbe Sache sah bisher je nach Ort anders aus: In den
 * Einstellungen ein Schieber mit Knopf, auf der Startseite ein
 * `toggle`-Symbol in Akzentfarbe, in den Widgets wieder etwas
 * Drittes. Wer einmal gelernt hat, wie ein Schalter hier aussieht,
 * soll ihn auf der nächsten Seite wiedererkennen - und nicht überlegen
 * müssen, ob das Symbol den Zustand zeigt oder den Knopf, den man
 * drücken muss.
 *
 * Die ganze Zeile ist der Schalter, nicht nur der Schieber rechts: Ein
 * Ziel von 48 Punkten neben einer dreizeiligen Erklärung trifft man am
 * Wandpanel im Vorbeigehen nicht.
 */
export function Schalterzeile({
  titel,
  hinweis,
  an,
  onChange,
  symbol,
  vorlesen,
}: {
  titel: string;
  /** Was der Schalter bewirkt - gern verschieden je nach Stellung. */
  hinweis?: string;
  an: boolean;
  onChange: (an: boolean) => void;
  /** Ionicon links; ohne bleibt die Zeile schmucklos, was in einer
   *  Liste gleichartiger Schalter das Ruhigere ist. */
  symbol?: keyof typeof Ionicons.glyphMap;
  /** Für die Vorlesefunktion, wenn der Titel allein zu knapp ist. */
  vorlesen?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={() => onChange(!an)}
      accessibilityRole="switch"
      accessibilityState={{ checked: an }}
      accessibilityLabel={vorlesen ?? titel}
      accessibilityHint={hinweis}
      style={({ pressed }) => [styles.zeile, pressed && { opacity: 0.7 }]}
    >
      {symbol ? (
        <Ionicons
          name={symbol}
          size={18}
          color={an ? colors.on : colors.inkFaint}
          style={styles.symbol}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.titel}>{titel}</Text>
        {hinweis ? <Text style={styles.hinweis}>{hinweis}</Text> : null}
      </View>
      {/* Der Schieber mittig zur ganzen Zeile, das Symbol oben beim
          Titel: Ein Symbol auf halber Höhe einer vierzeiligen
          Erklärung sieht aus, als gehörte es zu keinem von beidem. */}
      <View style={[styles.schalter, an && styles.schalterAn]}>
        <View style={[styles.knopf, an && styles.knopfAn]} />
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
    symbol: { marginTop: 1 },
    titel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    hinweis: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 2 },
    schalter: {
      alignSelf: 'center',
      width: 48,
      height: 28,
      borderRadius: radius.pill,
      backgroundColor: colors.off,
      padding: 3,
      justifyContent: 'center',
    },
    schalterAn: { backgroundColor: colors.on },
    knopf: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceStrong },
    knopfAn: { alignSelf: 'flex-end' },
  });
