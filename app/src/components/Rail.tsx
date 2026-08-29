import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';
import { MAX_SCHRIFT } from '../lib/schrift';

export type Section =
  | 'start'
  | 'home'
  | 'light'
  | 'covers'
  | 'cameras'
  | 'family'
  | 'settings'
  // Über „Einstellungen“ erreichbar, nicht in der Leiste:
  | 'devices'
  | 'automations'
  | 'system'
  | 'energy'
  | 'alarm'
  | 'speakers'
  | 'users'
  | 'personen'
  | 'activity'
  | 'widgets'
  | 'account'
  // «Konto & Verbindung» war beides zugleich: Wer sein Erscheinungsbild
  // ändern wollte, scrollte an Adresse und Token vorbei. Zwei Fragen,
  // zwei Punkte.
  | 'connection';

/**
 * Wie ein Bereich heisst, wenn man ihn benennen muss – in Meldungen und
 * im Auffangnetz («Kameras lässt sich gerade nicht anzeigen»). Die Leiste
 * zeigt nur sieben davon; die übrigen erreicht man über Einstellungen und
 * brauchen trotzdem einen Namen.
 */
export const SECTION_LABEL: Record<Section, string> = {
  start: 'Start',
  home: 'Räume',
  light: 'Licht',
  covers: 'Storen',
  cameras: 'Kameras',
  family: 'Familie',
  settings: 'Einstellungen',
  devices: 'Geräte',
  automations: 'Abläufe',
  system: 'System',
  energy: 'Energie',
  alarm: 'Alarmanlage',
  speakers: 'Boxen',
  users: 'Benutzer',
  personen: 'Familie und Freunde',
  activity: 'Zuletzt passiert',
  widgets: 'Widgets',
  account: 'Konto',
  connection: 'Verbindungen',
};

/** `needs` nennt die Berechtigung, ohne die der Punkt gar nicht erscheint. */
const ITEMS: {
  key: Section;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  needs?: string;
}[] = [
  { key: 'start', icon: 'home-outline', label: 'Start' },
  { key: 'home', icon: 'grid-outline', label: 'Räume' },
  { key: 'light', icon: 'bulb-outline', label: 'Licht' },
  { key: 'covers', icon: 'reorder-four-outline', label: 'Storen' },
  { key: 'cameras', icon: 'videocam-outline', label: 'Kameras' },
  { key: 'family', icon: 'people-outline', label: 'Familie' },
  { key: 'settings', icon: 'settings-outline', label: 'Einstellungen' },
];

interface Props {
  active: Section;
  onSelect: (section: Section) => void;
  /** Senkrecht als Seitenleiste (Tablet) oder waagrecht unten (Telefon). */
  vertical: boolean;
  bottomInset?: number;
  /** Berechtigungen des angemeldeten Benutzers. */
  capabilities?: string[];
  /** Für Gäste ausgeblendete Bereiche (nicht freigegebene Features). */
  hidden?: Section[];
}

export function Rail({
  active,
  onSelect,
  vertical,
  bottomInset = 0,
  capabilities = [],
  hidden = [],
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = ITEMS.filter(
    (item) =>
      (!item.needs || capabilities.includes(item.needs)) && !hidden.includes(item.key)
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
              // Eine Zeile, notfalls abgeschnitten: In der geteilten
              // Ansicht auf dem iPad ist die App 320 Punkte breit, und
              // «Einstellungen» ist dort breiter als sein Feld. Vorher
              // ragte es über den rechten Rand hinaus und schob die ganze
              // Seite drei Punkte nach links.
              <Text
                numberOfLines={1}
                // Bis 160 % mitwachsen, dann halten - sonst schiebt die
                // Leiste den Inhalt weg (Punkt 66, lib/schrift.ts).
                maxFontSizeMultiplier={MAX_SCHRIFT}
                style={[styles.barLabel, selected && { color: colors.ink }]}
              >
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
    // Ohne minWidth: 0 darf ein Flex-Kind breiter werden als sein
    // Anteil, sobald sein Inhalt es verlangt – dann schiebt die längste
    // Beschriftung die Leiste über den Rand.
    minWidth: 0,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    borderRadius: radius.control,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.onGradientSoft,
    maxWidth: '100%',
  },
  selected: {
    backgroundColor: colors.surfaceStrong,
  },
});
