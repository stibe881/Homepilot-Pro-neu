import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity, Scene } from '../api/types';
import { Colors, radius, useColors } from '../theme';

/**
 * Kinder-Ansicht: nur die eigenen Räume, als grosse Knöpfe.
 *
 * Für Levin und Lina: Licht und Storen im eigenen Zimmer ja - die
 * Alarmanlage, fremde Räume, Einstellungen und der ganze Rest nicht.
 * Aktiviert wird sie am Benutzer (simple_rooms in der config.yaml oder
 * beim Anlegen in der App); die Rechte prüft weiterhin der Hub - diese
 * Ansicht ist die Vereinfachung, nicht die Absicherung.
 */

/** Was in dieser Ansicht bedienbar ist (rein, testbar). */
export function kidControls(
  entities: Entity[],
  rooms: string[]
): { room: string; lights: Entity[]; covers: Entity[] }[] {
  return rooms.map((room) => {
    const here = entities.filter(
      (entity) => entity.room === room && !entity.combined_into
    );
    return {
      room,
      lights: here.filter((entity) => entity.kind === 'light'),
      covers: here.filter((entity) => entity.kind === 'cover'),
    };
  });
}

export function KidsView({
  name,
  rooms,
  entities,
  scenes,
  onCommand,
  onActivateScene,
}: {
  name: string;
  rooms: string[];
  entities: Entity[];
  scenes: Scene[];
  onCommand: (entityId: string, command: string) => void;
  onActivateScene: (sceneId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sections = kidControls(entities, rooms);

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.hello}>Hallo {name}!</Text>
      {sections.map((section) => (
        <View key={section.room} style={{ gap: 12 }}>
          {sections.length > 1 ? (
            <Text style={styles.room}>{section.room}</Text>
          ) : null}

          {section.lights.map((light) => {
            const on = light.state.state === 'on';
            return (
              <Pressable
                key={light.id}
                onPress={() => onCommand(light.id, on ? 'turn_off' : 'turn_on')}
                disabled={!light.available}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [
                  styles.big,
                  on && styles.bigOn,
                  (pressed || !light.available) && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={on ? 'bulb' : 'bulb-outline'}
                  size={34}
                  color={on ? '#FFFFFF' : colors.ink}
                />
                <Text style={[styles.bigText, on && { color: '#FFFFFF' }]}>
                  {light.name}
                </Text>
                <Text style={[styles.bigState, on && { color: '#FFFFFF' }]}>
                  {on ? 'An' : 'Aus'}
                </Text>
              </Pressable>
            );
          })}

          {section.covers.map((cover) => (
            <View key={cover.id} style={styles.coverRow}>
              <Text style={styles.coverName}>{cover.name}</Text>
              <View style={styles.coverButtons}>
                <Pressable
                  onPress={() => onCommand(cover.id, 'open')}
                  accessibilityLabel={`${cover.name} öffnen`}
                  style={({ pressed }) => [styles.coverButton, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="arrow-up" size={30} color={colors.ink} />
                </Pressable>
                <Pressable
                  onPress={() => onCommand(cover.id, 'close')}
                  accessibilityLabel={`${cover.name} schliessen`}
                  style={({ pressed }) => [styles.coverButton, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="arrow-down" size={30} color={colors.ink} />
                </Pressable>
              </View>
            </View>
          ))}

          {scenes
            .filter((scene) => scene.room === section.room)
            .map((scene) => (
              <Pressable
                key={scene.id}
                onPress={() => onActivateScene(scene.id)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.big, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={(scene.icon as keyof typeof Ionicons.glyphMap) || 'sparkles'} size={30} color={colors.ink} />
                <Text style={styles.bigText}>{scene.name}</Text>
              </Pressable>
            ))}

          {section.lights.length === 0 && section.covers.length === 0 ? (
            <Text style={styles.empty}>
              Im Raum «{section.room}» gibt es nichts zu schalten.
            </Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { padding: 18, gap: 16, paddingBottom: 40 },
    hello: { color: colors.onGradient, fontSize: 26, fontWeight: '800' },
    room: {
      color: colors.onGradientSoft,
      fontSize: 14,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    big: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      padding: 22,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      minHeight: 84,
    },
    bigOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    bigText: { color: colors.ink, fontSize: 20, fontWeight: '700', flex: 1 },
    bigState: { color: colors.inkSoft, fontSize: 16, fontWeight: '600' },
    coverRow: {
      padding: 18,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 12,
    },
    coverName: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    coverButtons: { flexDirection: 'row', gap: 12 },
    coverButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 18,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    empty: { color: colors.onGradientSoft, fontSize: 14 },
  });
