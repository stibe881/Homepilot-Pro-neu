import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Colors, useColors } from '../theme';

/**
 * Dezenter Hinweis neben der Begrüssung: Läuft gerade ein Haushaltsgerät?
 *
 * Bewusst zurückhaltender gehalten als der Türhinweis daneben – eine
 * laufende Waschmaschine ist eine Information, kein Alarm. Läuft nichts,
 * verschwindet der Hinweis ganz; nur dann bleibt er beim Hinsehen etwas
 * wert.
 */

/** Geräte an einer Messsteckdose, die zum Haushalt zählen. */
const APPLIANCE_NAME = /tumbler|trockner|wasch|geschirr|sp(ü|ue)lmaschine/i;

/** Ab dieser Leistung gilt ein Gerät an der Steckdose als «arbeitet». */
const WORKING_WATTS = 5;

export interface Working {
  entity: Entity;
  /** Kurze Zusatzangabe: Restzeit, Programm oder Leistung. */
  note: string;
}

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

/**
 * Welche Haushaltsgeräte arbeiten gerade? (rein, testbar)
 *
 * Zwei Quellen, weil die Geräte unterschiedlich angebunden sind: echte
 * Haushaltsgeräte (V-ZUG & Co.) melden ihren Zustand selbst, ein Tumbler an
 * der Schalt-Messsteckdose verrät es nur über die Leistung – eingeschaltet
 * ist die Steckdose auch dann noch, wenn er längst fertig ist.
 */
export function workingAppliances(entities: Entity[]): Working[] {
  const working: Working[] = [];
  for (const entity of entities) {
    if (!entity.available) continue;

    if (entity.kind === 'appliance') {
      const state = String(entity.state.state ?? '');
      if (state !== 'running' && state !== 'on') continue;
      const minutes = entity.state.minutes_left;
      working.push({
        entity,
        note:
          minutes != null
            ? `noch ${minutes} min`
            : String(entity.state.program ?? 'läuft'),
      });
      continue;
    }

    const watts = Number(entity.state.power);
    if (!Number.isFinite(watts)) continue;
    if (!APPLIANCE_NAME.test(entity.name)) continue;
    if (String(entity.state.state) === 'off' || watts <= WORKING_WATTS) continue;
    working.push({ entity, note: `${Math.round(watts)} W` });
  }
  return working;
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
  const detail = working
    .map((item) =>
      working.length === 1 ? item.note : `${item.entity.name} · ${item.note}`
    )
    .join(', ');

  return (
    <View style={styles.card} accessibilityLabel={`${heading}: ${detail}`}>
      <Ionicons
        name={working.length === 1 ? applianceIcon(working[0].entity.name) : 'ellipse'}
        size={working.length === 1 ? 16 : 10}
        color={colors.onGradientSoft}
      />
      <View style={styles.text}>
        <Text style={styles.heading} numberOfLines={1}>
          {heading}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
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
