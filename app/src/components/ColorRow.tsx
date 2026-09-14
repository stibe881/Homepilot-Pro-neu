import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import {
  WEISSKNOEPFE,
  aktiverWeisston,
  kannFarbe,
  kannWeiss,
  zeigtFarbe,
} from '../lib/lichtwahl';
import { Colors, useColors } from '../theme';

/**
 * Farb- und Weisswahl auf der Kachel – eine Reihe Punkte, kein Farbkreis.
 *
 * Ein Farbkreis sieht mächtiger aus und ist im Alltag unbrauchbar: Man
 * trifft mit dem Daumen nie zweimal dasselbe Orange, und «gestern war es
 * schöner» lässt sich nicht wiederherstellen. Eine feste Reihe ist
 * dagegen wiederholbar – und beim Sternenprojektor im Kinderzimmer ist
 * genau das die Frage: dasselbe Blau wie gestern.
 *
 * In derselben Reihe stehen die Weisstöne, und zwar zuerst (Punkt 648):
 * Es ist dieselbe Frage - in welchem Licht soll es leuchten -, und die
 * häufigste Antwort ist warmweiss. Was die Lampe nicht kann, steht auch
 * nicht da; kann sie beides nicht, fehlt die Reihe ganz. Welche der
 * beiden Hälften gerade leuchtet, entscheidet lib/lichtwahl.ts.
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
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const aktiv = zeigtFarbe(entity) ? gewaehlteFarbe(entity.state.color) : null;
  const weiss = aktiverWeisston(entity);
  const mitFarbe = kannFarbe(entity);
  const mitWeiss = kannWeiss(entity);
  const wortDarunter = weiss
    ? (WEISSKNOEPFE.find((ton) => ton.mirek === weiss)?.label ?? null)
    : aktiv
      ? (PALETTE.find((farbe) => farbe.hex === aktiv)?.name ?? null)
      : null;

  if (!mitFarbe && !mitWeiss) return null;

  return (
    <View style={styles.box}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.reihe}
      >
        {mitWeiss
          ? WEISSKNOEPFE.map((ton) => (
              <Pressable
                key={ton.mirek}
                onPress={() => onCommand('set_color_temp', { color_temp: ton.mirek })}
                accessibilityRole="button"
                accessibilityLabel={ton.label}
                accessibilityState={{ selected: weiss === ton.mirek }}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.punkt,
                  { backgroundColor: ton.hex },
                  weiss === ton.mirek && { borderColor: colors.ink, borderWidth: 2 },
                  pressed && { opacity: 0.7 },
                ]}
              />
            ))
          : null}
        {/* Ein Strich zwischen Weiss und Bunt: Die drei Weisstöne
            unterscheiden sich von Auge kaum, und ohne Trenner sähen sie
            aus wie drei blasse Farben. */}
        {mitWeiss && mitFarbe ? <View style={styles.trenner} /> : null}
        {(mitFarbe ? PALETTE : []).map((farbe) => (
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
      {wortDarunter ? <Text style={styles.hint}>{wortDarunter}</Text> : null}
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
    trenner: {
      width: 1,
      alignSelf: 'stretch',
      marginHorizontal: 2,
      backgroundColor: colors.surfaceBorder,
    },
  });
