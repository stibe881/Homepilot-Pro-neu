import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Colors, radius, useColors } from '../theme';
import { Card } from './Card';

/**
 * Raum-Kachel für die Seite «Räume»: der Raumname, darunter kompakt die
 * Geräte des Raums. Lichter und Schalter lassen sich direkt in der Kachel
 * schalten; alles andere zeigt kurz seinen Zustand. Antippen der Kachel
 * öffnet die volle Raumansicht.
 */

const KIND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  light: 'bulb-outline',
  switch: 'power-outline',
  sensor: 'thermometer-outline',
  binary_sensor: 'radio-button-on-outline',
  media_player: 'musical-notes-outline',
  camera: 'videocam-outline',
  vacuum: 'sparkles-outline',
  appliance: 'cube-outline',
  calendar: 'calendar-outline',
  lock: 'key-outline',
  cover: 'reorder-four-outline',
  weather: 'partly-sunny-outline',
  alert: 'warning-outline',
};

/** Kurzer Zustand für die rechte Spalte – nur für nicht schaltbare Geräte. */
function shortState(entity: Entity): string {
  const state = entity.state.state;
  switch (entity.kind) {
    case 'cover': {
      const position = entity.state.position;
      if (typeof position === 'number') return `${position}% offen`;
      return state === 'closed' ? 'Zu' : state === 'open' ? 'Offen' : '–';
    }
    case 'sensor':
      return `${state ?? '–'}${entity.state.unit ?? ''}`;
    case 'binary_sensor':
      return state === 'on' ? 'Aktiv' : 'Ruhig';
    case 'media_player':
      return state === 'playing' ? 'Spielt' : 'Still';
    case 'lock':
      return state === 'locked' ? 'Zu' : 'Offen';
    case 'vacuum':
      return state === 'cleaning' ? 'Reinigt' : state === 'charging' ? 'Lädt' : 'Bereit';
    case 'appliance':
      return state === 'running' ? 'Läuft' : 'Bereit';
    default:
      return String(state ?? '–');
  }
}

const MAX_ROWS = 6;

export function RoomTile({
  name,
  items,
  width,
  onOpen,
  onCommand,
}: {
  name: string;
  items: Entity[];
  width: number;
  onOpen: () => void;
  onCommand: (entityId: string, command: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const shownItems = items.slice(0, MAX_ROWS);
  const moreCount = items.length - shownItems.length;
  const activeCount = items.filter(
    (entity) => entity.state.state === 'on' || entity.state.state === 'playing'
  ).length;

  return (
    <Card style={{ ...styles.tile, width }} onPress={onOpen}>
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.count}>
          {activeCount > 0 ? `${activeCount} an · ` : ''}
          {items.length} Geräte
        </Text>
      </View>

      {shownItems.map((entity) => {
        const togglable = entity.commands.includes('toggle');
        const on = entity.state.state === 'on';
        return (
          <View key={entity.id} style={styles.row}>
            <Ionicons
              name={KIND_ICONS[entity.kind] ?? 'hardware-chip-outline'}
              size={15}
              color={on ? colors.accent : colors.inkSoft}
            />
            <Text
              style={[styles.rowName, !entity.available && { color: colors.inkFaint }]}
              numberOfLines={1}
            >
              {entity.name}
            </Text>
            {togglable ? (
              <Pressable
                onPress={() => onCommand(entity.id, 'toggle')}
                hitSlop={8}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                style={[styles.toggle, on && styles.toggleOn]}
              >
                <Ionicons name="power" size={13} color={on ? '#FFFFFF' : colors.inkSoft} />
              </Pressable>
            ) : (
              <Text style={styles.rowState} numberOfLines={1}>
                {shortState(entity)}
              </Text>
            )}
          </View>
        );
      })}

      {moreCount > 0 ? (
        <Text style={styles.more}>+ {moreCount} weitere …</Text>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    tile: { minHeight: 0, gap: 8 },
    head: { gap: 1 },
    name: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    count: { color: colors.inkFaint, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowName: { color: colors.inkSoft, fontSize: 13, flex: 1 },
    rowState: { color: colors.inkFaint, fontSize: 12 },
    toggle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.off,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleOn: { backgroundColor: colors.accent },
    more: { color: colors.inkFaint, fontSize: 12 },
  });
