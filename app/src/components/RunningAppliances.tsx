import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { workingAppliances } from '../lib/haushalt';
import { Colors, useColors } from '../theme';

/**
 * Dezenter Hinweis neben der Begrüssung: Läuft gerade ein Haushaltsgerät?
 *
 * Bewusst zurückhaltender gehalten als der Türhinweis daneben – eine
 * laufende Waschmaschine ist eine Information, kein Alarm. Läuft nichts,
 * verschwindet der Hinweis ganz; nur dann bleibt er beim Hinsehen etwas
 * wert.
 */

/**
 * Passendes Symbol zum Gerät (rein, testbar).
 *
 * Dieselben Symbole wie auf den Haushalt-Kacheln der Startseite. Bewusst
 * kein Kreispfeil: Der steht überall für «neu laden» und lädt zum Tippen
 * ein – hier gibt es aber nichts zu tippen, der Wert aktualisiert sich von
 * selbst, sobald der Hub eine Änderung meldet.
 */
export function applianceIcon(name: string): keyof typeof Ionicons.glyphMap {
  if (/tumbler|trockner/i.test(name)) return 'sunny-outline';
  if (/wasch/i.test(name)) return 'water-outline';
  if (/geschirr|sp(ü|ue)lmaschine/i.test(name)) return 'restaurant-outline';
  return 'ellipse';
}

export function RunningAppliances({ entities }: { entities: Entity[] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const working = workingAppliances(entities);
  if (working.length === 0) return null;

  const heading =
    working.length === 1
      ? `${working[0].entity.name} läuft`
      : `${working.length} Geräte laufen`;
  // Eine leere Zusatzangabe (Tumbler an der Messsteckdose: es gibt keine
  // Restzeit, und die Wattzahl gehört in den Energie-Bereich) lässt die
  // Zeile weg statt ein hängendes «Tumbler · » zu zeichnen.
  const detail = working
    .map((item) =>
      working.length === 1
        ? item.note
        : item.note
          ? `${item.entity.name} · ${item.note}`
          : item.entity.name
    )
    .filter(Boolean)
    .join(', ');

  return (
    <View
      style={styles.card}
      accessibilityLabel={detail ? `${heading}: ${detail}` : heading}
    >
      <Ionicons
        name={working.length === 1 ? applianceIcon(working[0].entity.name) : 'ellipse'}
        size={working.length === 1 ? 16 : 10}
        color={colors.onGradientSoft}
      />
      <View style={styles.text}>
        <Text style={styles.heading} numberOfLines={1}>
          {heading}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      maxWidth: 260,
      flexShrink: 1,
      // Bewusst ohne Fläche und Rahmen: Der Text steht wie die Begrüssung
      // direkt auf dem Verlauf. Eine laufende Waschmaschine ist eine
      // Randnotiz und soll nicht neben dem Türhinweis um Aufmerksamkeit
      // streiten – der darf als einziger eine Karte sein.
    },
    text: { flexShrink: 1 },
    heading: { color: colors.onGradient, fontSize: 13, fontWeight: '700' },
    detail: { color: colors.onGradientSoft, fontSize: 12 },
  });
