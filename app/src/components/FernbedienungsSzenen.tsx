import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, Scene } from '../api/types';
import { REMOTE_SZENEN_MAX, szenenAuswahlUmschalten } from '../lib/fernbedienungsszenen';
import { Colors, radius, useColors } from '../theme';

/**
 * «Welche Szene unten an der Fernbedienung?» - bis zu zwei (Punkt 646).
 *
 * Steht bei der Kopplung von Fernseher und Spielkonsole
 * (VerbindungenScreen), nicht in der Fernbedienung selbst: Wer sie
 * einrichtet, tut es einmal und in Ruhe - genau wie den Einschlaf-Timer
 * daneben, nicht jeden Abend neu.
 *
 * Ohne Szenen im Haus steht hier nichts - eine leere Liste zum Wählen
 * wäre nur ein Versprechen, das (noch) niemand einlösen kann.
 */
export function FernbedienungsSzenen({
  entity,
  scenes,
  onChange,
}: {
  entity: Entity;
  scenes: Scene[];
  onChange: (entityId: string, remoteScenes: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gewaehlt = entity.remote_scenes ?? [];

  if (scenes.length === 0) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.label}>Szenen an der Fernbedienung</Text>
      <Text style={styles.hinweis}>
        Bis zu {REMOTE_SZENEN_MAX} Szenen oder Abläufe stehen dann als eigener Knopf unten
        an der Fernbedienung.
      </Text>
      <View style={styles.reihe}>
        {scenes.map((szene) => {
          const aktiv = gewaehlt.includes(szene.id);
          return (
            <Pressable
              key={szene.id}
              onPress={() => onChange(entity.id, szenenAuswahlUmschalten(gewaehlt, szene.id))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: aktiv }}
              accessibilityLabel={`Szene ${szene.name} an der Fernbedienung`}
              style={[styles.chip, aktiv && styles.chipAktiv]}
            >
              <Text style={[styles.chipText, aktiv && styles.chipTextAktiv]}>{szene.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: { gap: 6, marginTop: 4 },
    label: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    hinweis: { color: colors.inkFaint, fontSize: 11, lineHeight: 15 },
    reihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.panel,
    },
    chipAktiv: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    chipTextAktiv: { color: colors.onAccent },
  });
