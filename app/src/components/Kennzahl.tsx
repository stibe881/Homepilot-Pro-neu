import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { angeklebt, zerlege } from '../lib/kennzahl';
import { MAX_SCHRIFT } from '../lib/schrift';
import { Colors, type, useColors } from '../theme';

/**
 * Ein Messwert, bei dem die Zahl führt.
 *
 * Warum überhaupt, steht in lib/kennzahl.ts. Hier stehen die zwei
 * Dinge, die man dem Ergebnis nicht ansieht:
 *
 * **Ziffern mit fester Breite.** Ohne `tabular-nums` ist die «1»
 * schmaler als die «8»; eine Temperatur, die von 19.8 auf 21.1 geht,
 * ruckt beim Wechsel seitwärts, und eine Uhr, die Sekunden zählt, lässt
 * die halbe Kopfzeile wackeln. Fünf Stellen im Haus hatten das von Hand
 * gesetzt, die übrigen nicht - genau die Art Unterschied, die man
 * spürt, ohne sie benennen zu können.
 *
 * **Die Einheit sitzt auf der Grundlinie**, nicht in der Mitte. `°C`
 * neben einer 26-Punkte-Zahl mittig gesetzt schwebt; auf der Grundlinie
 * steht es da, wo man es schreiben würde.
 *
 * Die Vorlesehilfe bekommt weiterhin den ganzen Wert am Stück: «21.5
 * Grad» statt «21.5» und irgendwo daneben «Grad».
 */
export function Kennzahl({
  wert,
  label,
  farbe,
  gross = false,
}: {
  /** Der ganze Messwert, wie er sonst als Text dastünde: «21.5 °C». */
  wert: string;
  /** Was darunter steht. Ohne Angabe steht nichts darunter. */
  label?: string;
  /** Abweichende Farbe für die Zahl – etwa Rot bei einer Warnung. */
  farbe?: string;
  /** Für die eine grosse Zahl auf einer Kachel statt der Reihe kleiner. */
  gross?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { zahl, einheit } = zerlege(wert);

  return (
    <View
      style={styles.block}
      accessibilityRole="text"
      // Am Stück vorgelesen: «21.5 Grad», nicht «21.5» und irgendwo
      // daneben «Grad».
      accessibilityLabel={label ? `${wert}, ${label}` : wert}
    >
      <View style={styles.zeile}>
        <Text
          style={[
            styles.zahl,
            gross && styles.zahlGross,
            farbe ? { color: farbe } : null,
          ]}
          maxFontSizeMultiplier={MAX_SCHRIFT}
          // Die Zahl selbst ist schon im Label der Hülle.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {zahl}
        </Text>
        {einheit ? (
          <Text
            style={[styles.einheit, !angeklebt(einheit) && styles.mitLuft]}
            maxFontSizeMultiplier={MAX_SCHRIFT}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {einheit}
          </Text>
        ) : null}
      </View>
      {label ? (
        <Text
          style={styles.label}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCHRIFT}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    block: { gap: 1 },
    // Auf der Grundlinie und nicht mittig: Sonst schwebt das «°C» neben
    // einer 26-Punkte-Zahl.
    zeile: { flexDirection: 'row', alignItems: 'baseline' },
    zahl: {
      color: colors.ink,
      fontSize: type.value,
      fontWeight: '700',
      // Siehe oben - ohne das ruckt jede Zahl, die sich ändert.
      fontVariant: ['tabular-nums'],
    },
    zahlGross: { fontSize: type.greetingSmall },
    einheit: { color: colors.inkSoft, fontSize: type.cardSub, fontWeight: '600' },
    // Der schmale Zwischenraum des Dudens - «21 °C», aber «63%».
    mitLuft: { marginLeft: 3 },
    label: { color: colors.inkFaint, fontSize: 12 },
  });
