import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { isWindow, openContacts } from '../lib/offen';
import { OffenListe } from './OffenListe';

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
  const [offen, setOffen] = useState(false);
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
    <>
      {/* Antippen sagt, seit wann. Der Hinweis nennt bisher nur das
          Gerät - «seit zehn Minuten» heisst, jemand ist gerade draussen,
          «seit drei Stunden» heisst, es hat es niemand gemerkt. */}
      <Pressable
        onPress={() => setOffen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${heading}: ${names(open)} – seit wann?`}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="alert-circle" size={22} color={colors.warn} />
        <View style={styles.text}>
          <Text style={styles.heading}>{heading}</Text>
          <Text style={styles.names} numberOfLines={2}>
            {names(open)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
      </Pressable>

      <Modal
        visible={offen}
        transparent
        animationType="fade"
        onRequestClose={() => setOffen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOffen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetHeading}>{heading}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <OffenListe entities={entities} jetzt={Date.now()} />
            </ScrollView>
            <Pressable onPress={() => setOffen(false)} style={styles.close}>
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 24,
    },
    sheet: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.card,
      padding: 18,
      gap: 4,
      maxWidth: 460,
      width: '100%',
      alignSelf: 'center',
    },
    sheetHeading: {
      color: colors.ink,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 4,
    },
    close: {
      marginTop: 12,
      paddingVertical: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    closeText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  });
