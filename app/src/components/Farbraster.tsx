import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WEISSKNOEPFE } from '../lib/lichtwahl';
import { Colors, radius, useColors } from '../theme';
import { PALETTE } from './ColorRow';

/**
 * Farben und Weisstöne als Punkteraster (Punkt 649 der Werkbank).
 *
 * Aus dem Haus, mit Bild der Lichtseite einer fremden App: «Es soll es
 * in dieser Art anzeigen. Ausserdem soll es bei Abläufen und Szenarien
 * auch in dieser Art anzeigen und nicht als Text.»
 *
 * Im Ablauf und in der Szene stand der Weisston bis hierher als Liste
 * von Wörtern - «warmweiss», «neutralweiss», «tageslichtweiss» - und
 * die Farbe daneben als Reihe von Punkten. Zwei Darstellungen für
 * dieselbe Frage, und die mit den Wörtern ist die schlechtere: Man
 * wählt ein Licht nicht nach seinem Namen, sondern danach, wie es
 * aussieht. Ein Wort muss man lesen und übersetzen, einen Punkt sieht
 * man.
 *
 * Deshalb ein Raster für beides - Weiss zuerst, dann bunt -, überall
 * dasselbe: auf der Kachel, im Ablauf, in der Szene. Was die Lampe
 * nicht kann, steht nicht da.
 */

/** Was ein Tipp im Raster bedeutet. */
export interface Rasterwahl {
  /** Hex-Farbe, wenn ein bunter Punkt getroffen wurde. */
  color?: string;
  /** Mirek, wenn es ein Weisston war. */
  colorTemp?: number;
}

export function Farbraster({
  farben = true,
  weiss = true,
  wert,
  mitUnveraendert = false,
  onWahl,
  gross = false,
}: {
  /** Kann die Lampe Farben? Sonst fehlen die bunten Punkte. */
  farben?: boolean;
  /** Kann sie Weisstöne? */
  weiss?: boolean;
  /** Was gerade gilt - leer heisst «unverändert» bzw. «nichts gewählt». */
  wert: Rasterwahl;
  /** Einen Punkt «unverändert lassen» voranstellen - im Ablauf und in
   *  der Szene die Vorgabe, auf der Kachel sinnlos: Dort leuchtet die
   *  Lampe ja schon in etwas. */
  mitUnveraendert?: boolean;
  onWahl: (wahl: Rasterwahl) => void;
  /** Grössere Punkte fürs Blatt, kleinere für die Zeile im Editor. */
  gross?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!farben && !weiss) return null;

  const groesse = gross ? 44 : 32;
  const punkt = (
    key: string,
    hex: string,
    label: string,
    gewaehlt: boolean,
    beiTipp: () => void,
    inhalt?: React.ReactNode
  ) => (
    <Pressable
      key={key}
      onPress={beiTipp}
      accessibilityRole="radio"
      accessibilityState={{ selected: gewaehlt }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.punkt,
        { width: groesse, height: groesse, borderRadius: groesse / 2 },
        { backgroundColor: hex },
        // Der Ring aussen statt eines dickeren Randes: Ein Rand frisst
        // von der Farbe, und bei den drei Weisstönen ist genau sie der
        // Unterschied.
        gewaehlt && { borderColor: colors.ink, borderWidth: 3 },
        pressed && { opacity: 0.7 },
      ]}
    >
      {inhalt}
    </Pressable>
  );

  const nichts = !wert.color && wert.colorTemp == null;
  const name = wert.colorTemp
    ? (WEISSKNOEPFE.find((ton) => ton.mirek === wert.colorTemp)?.label ?? null)
    : wert.color
      ? (PALETTE.find((farbe) => farbe.hex === wert.color)?.name ?? null)
      : null;

  return (
    <View style={styles.box}>
      <View style={styles.raster}>
        {mitUnveraendert
          ? punkt(
              'leer',
              'transparent',
              'Unverändert lassen',
              nichts,
              () => onWahl({}),
              <Ionicons name="close" size={16} color={colors.inkFaint} />
            )
          : null}
        {weiss
          ? WEISSKNOEPFE.map((ton) =>
              punkt(
                `w${ton.mirek}`,
                ton.hex,
                ton.label,
                wert.colorTemp === ton.mirek,
                () => onWahl({ colorTemp: ton.mirek })
              )
            )
          : null}
        {farben
          ? PALETTE.map((farbe) =>
              punkt(
                farbe.hex,
                farbe.hex,
                farbe.name,
                wert.color === farbe.hex,
                () => onWahl({ color: farbe.hex })
              )
            )
          : null}
      </View>
      {name ? <Text style={styles.wort}>{name}</Text> : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: { gap: 8 },
    // Umbrechend statt scrollend: Im Ablauf steht das Raster in einer
    // Liste, die selbst scrollt - eine waagrechte Rolle darin findet
    // niemand, und die Punkte rechts blieben für immer unentdeckt.
    raster: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    punkt: {
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
      // Damit der «unverändert»-Punkt nicht als Loch dasteht.
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
    },
    wort: { color: colors.inkFaint, fontSize: 12 },
  });
