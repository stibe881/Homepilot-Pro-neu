import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { Colors, radius, useColors } from '../theme';

/**
 * App-Auswahl auf der Android-TV-Kachel.
 *
 * Zugeklappt steht dort, was gerade läuft – aufgeklappt die Liste. Das
 * ist die Frage, die man einer Fernsehkachel stellt: nicht «welche Taste
 * drücke ich», sondern «Zattoo oder Plex».
 *
 * Welche Apps das sind, sagt der Hub im Zustand des Geräts. Sie kommen
 * nicht vom Fernseher selbst – das Protokoll kann Apps starten, aber
 * nicht aufzählen –, sondern aus der Konfiguration, mit einer kurzen
 * Vorgabe. Steht dort nichts, erscheint die Auswahl gar nicht erst.
 */

export interface TvApp {
  name: string;
  app: string;
}

/** Die Apps aus dem Zustand lesen – Unsinn fällt heraus (rein, testbar). */
export function appsOf(entity: Entity): TvApp[] {
  const roh = entity.state.apps;
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (eintrag): eintrag is TvApp =>
      !!eintrag &&
      typeof eintrag.app === 'string' &&
      eintrag.app.length > 0 &&
      typeof eintrag.name === 'string'
  );
}

export function TvApps({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(false);
  const apps = appsOf(entity);

  if (apps.length === 0) return null;

  // Was der Fernseher meldet, ist der Anzeigename – die Liste kennt
  // denselben, deshalb reicht der Vergleich darüber.
  const laufend = entity.state.app ? String(entity.state.app) : null;

  return (
    <View style={styles.box}>
      <Pressable
        onPress={() => setOffen((war) => !war)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        style={({ pressed }) => [styles.head, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="apps-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.headText} numberOfLines={1}>
          {laufend ?? 'App starten'}
        </Text>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.inkFaint}
        />
      </Pressable>

      {offen ? (
        <View style={styles.list}>
          {apps.map((app) => {
            const aktiv = laufend === app.name;
            return (
              <Pressable
                key={app.app}
                onPress={() => {
                  onCommand('launch_app', { app: app.app });
                  setOffen(false);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.chip,
                  aktiv && styles.chipActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>
                  {app.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: { gap: 6 },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    headText: { color: colors.ink, fontSize: 13, fontWeight: '600', flex: 1 },
    list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.ink, fontSize: 13 },
    chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  });
