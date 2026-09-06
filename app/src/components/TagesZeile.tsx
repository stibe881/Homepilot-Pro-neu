import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { tagesGriffe } from '../lib/tageszeile';
import { Colors, radius, useColors } from '../theme';

/**
 * Die tageszeitliche Schnellzeile der Startseite (Punkt 257 der
 * Werkbank): morgens «Storen auf», abends «Licht aus» und «Storen zu».
 *
 * Welche Griffe wann erscheinen, entscheidet lib/tageszeile.ts - hier
 * steht nur die Zeile. Sie verschwindet von selbst, sobald nichts mehr
 * zu tun ist: Die Griffe hängen am gemeldeten Zustand, und der ändert
 * sich mit dem Ausführen.
 */
export function TagesZeile({
  entities,
  now,
  onCommand,
}: {
  entities: Entity[];
  now: Date;
  onCommand: (entityId: string, command: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Was schon angetippt wurde, bleibt bis zur Zustandsmeldung gedämpft -
  // sonst lädt derselbe Griff für die Sekunden der Funkfahrt zum
  // Doppeltippen ein, und jede Store bekäme den Befehl zweimal.
  const [unterwegs, setUnterwegs] = useState<string[]>([]);
  const griffe = tagesGriffe(entities, now);
  if (griffe.length === 0) return null;

  return (
    <View style={styles.zeile}>
      {griffe.map((griff) => {
        const laeuft = unterwegs.includes(griff.key);
        return (
          <Pressable
            key={griff.key}
            disabled={laeuft}
            onPress={() => {
              setUnterwegs((bisher) => [...bisher, griff.key]);
              for (const befehl of griff.befehle) {
                onCommand(befehl.entityId, befehl.command);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ disabled: laeuft }}
            accessibilityLabel={griff.label}
            style={({ pressed }) => [
              styles.griff,
              (pressed || laeuft) && { opacity: 0.5 },
            ]}
          >
            <Ionicons name={griff.icon} size={15} color={colors.accent} />
            <Text style={styles.text}>{griff.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    griff: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    text: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  });
