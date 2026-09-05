import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { tvLogo } from '../lib/tvlogo';
import { Colors, radius, useColors } from '../theme';
import { TvAppLogo } from './TvAppLogo';

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
          {/* Nicht noch einmal der Name der laufenden App: Der steht schon
              gross oben auf der Kachel, und zweimal «Plex» untereinander
              beantwortet keine Frage. Hier steht, was der Griff bewirkt. */}
          {laufend ? 'App wechseln' : 'App starten'}
        </Text>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.inkFaint}
        />
      </Pressable>

      {offen ? (
        <View style={styles.list}>
          {/* Logos statt Wörter, dieselben wie auf der Fernbedienung
              (lib/tvlogo.ts): Man erkennt Netflix am roten N schneller,
              als man es liest. Die laufende App trägt einen Ring; nur
              Apps ohne bekanntes Logo bleiben ein Wort-Chip. */}
          {apps.map((app) => {
            const aktiv = laufend === app.name;
            const logo = tvLogo(app.name);
            return (
              <Pressable
                key={app.app}
                onPress={() => {
                  onCommand('launch_app', { app: app.app });
                  setOffen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${app.name} starten`}
                accessibilityState={{ selected: aktiv }}
                style={({ pressed }) => [
                  !logo && styles.chip,
                  !logo && aktiv && styles.chipActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                {logo ? (
                  <TvAppLogo logo={logo} size={40} aktiv={aktiv} />
                ) : (
                  <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>
                    {app.name}
                  </Text>
                )}
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
    // alignItems: Logos (Kreise) und Wort-Chips (Pillen) sind
    // verschieden hoch - ohne Zentrierung streckte der Stretch die
    // Chips auf Kreis-Höhe.
    list: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
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
