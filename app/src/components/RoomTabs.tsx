import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, radius, type } from '../theme';

interface Props {
  rooms: string[];
  active: string;
  onSelect: (room: string) => void;
}

export function RoomTabs({ rooms, active, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Feste Höhe: ein waagrechter ScrollView in einer senkrechten Liste
      // hat sonst keine eigene Höhe und verschwindet.
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {rooms.map((room) => {
        const selected = room === active;
        return (
          <Pressable
            key={room}
            onPress={() => onSelect(room)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.tab,
              selected && styles.selected,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{room}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 42,
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    gap: 8,
    paddingRight: 20,
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  selected: {
    backgroundColor: colors.surfaceStrong,
  },
  label: {
    color: colors.onGradientSoft,
    fontSize: type.label,
    fontWeight: '600',
  },
  selectedLabel: {
    color: colors.ink,
  },
});
