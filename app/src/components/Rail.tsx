import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

export type Section = 'start' | 'home' | 'devices' | 'automations' | 'system' | 'settings';

/** `needs` nennt die Berechtigung, ohne die der Punkt gar nicht erscheint. */
const ITEMS: {
  key: Section;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  needs?: string;
}[] = [
  { key: 'start', icon: 'home-outline', label: 'Start' },
  { key: 'home', icon: 'grid-outline', label: 'Räume' },
  { key: 'devices', icon: 'list-outline', label: 'Geräte' },
  {
    key: 'automations',
    icon: 'git-branch-outline',
    label: 'Abläufe',
    needs: 'view_automations',
  },
  { key: 'system', icon: 'pulse-outline', label: 'System', needs: 'view_system' },
  { key: 'settings', icon: 'settings-outline', label: 'Konto' },
];

interface Props {
  active: Section;
  onSelect: (section: Section) => void;
  /** Senkrecht als Seitenleiste (Tablet) oder waagrecht unten (Telefon). */
  vertical: boolean;
  bottomInset?: number;
  /** Berechtigungen des angemeldeten Benutzers. */
  capabilities?: string[];
}

export function Rail({
  active,
  onSelect,
  vertical,
  bottomInset = 0,
  capabilities = [],
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = ITEMS.filter(
    (item) => !item.needs || capabilities.includes(item.needs)
  );
  return (
    <View
      style={[
        vertical ? styles.rail : styles.bar,
        !vertical && { paddingBottom: Math.max(bottomInset, 10) },
      ]}
    >
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            style={({ pressed }) => [
              vertical ? styles.railItem : styles.barItem,
              selected && styles.selected,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={item.icon}
              size={vertical ? 24 : 22}
              color={selected ? colors.ink : colors.onGradientSoft}
            />
            {!vertical && (
              <Text style={[styles.barLabel, selected && { color: colors.ink }]}>
                {item.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  rail: {
    width: 78,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 18,
  },
  railItem: {
    width: 52,
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 8,
    backgroundColor: colors.surfaceSoft,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  barItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    borderRadius: radius.control,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.onGradientSoft,
  },
  selected: {
    backgroundColor: colors.surfaceStrong,
  },
});
