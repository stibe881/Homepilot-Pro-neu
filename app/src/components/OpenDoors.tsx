import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
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

const OPENING_NAME = /t(ü|ue)r|door|fenster|window|balkon|terrasse|garage|tor\b/i;

/** Fenster oder Tür? Entscheidet allein der Gerätename. */
export function isWindow(name: string): boolean {
  return /fenster|window/i.test(name);
}

/** Alle offenen Türen und Fenster – Kontaktsensoren plus Türsensor im Schloss. */
export function openContacts(entities: Entity[]): Entity[] {
  return entities.filter((entity) => {
    if (!entity.available) return false;
    if (entity.kind === 'lock') return entity.state.door === 'open';
    if (entity.kind !== 'binary_sensor') return false;
    // Bewegungsmelder sind auch binary_sensor – nur Kontakte zählen. Wo die
    // Integration keine Geräteklasse liefert, entscheidet der Name.
    const isContact =
      entity.state.device_class === 'contact' ||
      (!entity.state.device_class && OPENING_NAME.test(entity.name));
    return isContact && entity.state.state === 'on';
  });
}

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
