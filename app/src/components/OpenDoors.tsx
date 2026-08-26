import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { isWindow, openContacts } from '../lib/offen';

// Weiterhin von hier importierbar – die halbe App holt sie an dieser
// Adresse. Wohnen tun sie in lib/offen.ts, wo sie ohne React prüfbar sind.
export { hasOpenDoor, isWindow, openContacts, wohnungstuer, wohnungstuerOffen } from '../lib/offen';
import { Colors, radius, useColors } from '../theme';

/**
 * Hinweis neben der Begrüssung: Welche Tür oder welches Fenster steht offen?
 *
 * Gespeist aus zwei Quellen, weil beide dasselbe beantworten: Kontaktsensoren
 * (Matter/Homematic, `device_class: contact`) und Türsensoren in Schlössern
 * (Nuki Pro meldet `door: open`). Ist alles zu, verschwindet der Hinweis
 * vollständig – ein «alles geschlossen»-Schild würde nur Platz kosten und
 * beim Hinsehen nichts verändern.
 */

export function OpenDoors({ entities }: { entities: Entity[] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const open = openContacts(entities);
  if (open.length === 0) return null;

  const windows = open.filter((entity) => isWindow(entity.name)).length;
  const heading =
    open.length === 1
      ? `${isWindow(open[0].name) ? 'Fenster' : 'Tür'} offen`
      : windows === 0
        ? `${open.length} Türen offen`
        : windows === open.length
          ? `${open.length} Fenster offen`
          : `${open.length} offen`;

  return (
    <View style={styles.card} accessibilityLabel={`${heading}: ${names(open)}`}>
      <Ionicons name="alert-circle" size={22} color={colors.warn} />
      <View style={styles.text}>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.names} numberOfLines={2}>
          {names(open)}
        </Text>
      </View>
    </View>
  );
}

function names(entities: Entity[]): string {
  return entities.map((entity) => entity.name).join(', ');
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.warn,
      maxWidth: 320,
      flexShrink: 1,
    },
    text: { flexShrink: 1 },
    heading: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    names: {
      color: colors.inkSoft,
      fontSize: 13,
    },
  });
