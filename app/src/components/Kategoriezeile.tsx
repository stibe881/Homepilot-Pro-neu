import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

/**
 * Die zuklappbare Überschrift einer Kategorie – Abläufe, Szenen, Push.
 *
 * Sie war eine nackte Textzeile auf dem Verlauf: Pfeil, Name, und die
 * Zahl mit `flex: 1` dazwischen ans andere Ende geschoben. Auf dem
 * Telefon ging das knapp durch; auf dem iPad und im Browser standen
 * «Wandtaster» und die «11» dazu anderthalb Handbreit auseinander, und
 * zehn solche Zeilen untereinander waren eine graue Wand ohne erkennbare
 * Griffe. Man sah nicht, dass das tippbare Zeilen sind, und man las die
 * Zahl nicht mehr zur Zeile, zu der sie gehört.
 *
 * Deshalb: eine Fläche mit Rand als Griff, und die Zahl direkt hinter
 * dem Namen statt am Bildschirmrand. Der Rest der Zeile bleibt leer und
 * trotzdem tippbar – ein grosses Ziel schadet nie, auf dem Telefon
 * schon gar nicht.
 *
 * Ein Ort für alle drei Listen, weil sie in derselben Liste
 * untereinander stehen: «Push» kommt aus PushRules, die Kategorien
 * darüber aus Groups. Zwei Fassungen derselben Zeile liefen sonst
 * auseinander, und dann sähe eine Überschrift nach einer anderen Ebene
 * aus, obwohl es dieselbe ist.
 */
export function Kategoriezeile({
  titel,
  /** Was rechts vom Namen steht – meist die Anzahl, «7/9», wenn etwas
   *  aus ist. Kein `count: number`, damit die Zeile nicht wissen muss,
   *  was sie zählt. */
  stand,
  offen,
  onToggle,
}: {
  titel: string;
  stand: string;
  offen: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: offen }}
      accessibilityLabel={`${titel}, ${stand}`}
      style={({ pressed }) => [styles.zeile, pressed && { opacity: 0.7 }]}
    >
      <Ionicons
        name={offen ? 'chevron-down' : 'chevron-forward'}
        size={16}
        color={colors.onGradientSoft}
      />
      {/* `flexShrink` statt `flex`: Der Name nimmt sich, was er braucht,
          und die Zahl rückt nach – nicht an den Rand. Nur ein langer
          Name kürzt sich selbst. */}
      <Text style={styles.titel} numberOfLines={1}>
        {titel}
      </Text>
      <Text style={styles.stand}>{stand}</Text>
      <View style={{ flex: 1 }} />
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.surfaceBorder,
    },
    titel: { color: colors.onGradient, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    stand: { color: colors.onGradientSoft, fontSize: 13, fontWeight: '700' },
  });
