import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { Colors, radius, useColors } from '../theme';
import { tapped } from '../lib/haptics';

/**
 * Lauter, leiser, stumm – auf der Fernsehkachel selbst.
 *
 * Es ist das, was man vom Sofa aus am häufigsten will, und es lag hinter
 * dem Steuerkreuz: Kachel antippen, Fernbedienung öffnen, leiser, wieder
 * schliessen. Vier Griffe für einen zu lauten Werbeblock.
 *
 * Ein Schieber geht hier nicht: Der Fernseher nimmt nur «einen Schritt
 * lauter» entgegen, keinen Zielwert. Dafür meldet er seinen Stand, und
 * der steht in der Mitte – sonst tippt man ins Blaue.
 */
export function TvVolume({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const stumm = Boolean(entity.state.muted);
  const stand =
    typeof entity.state.volume === 'number' ? Math.round(entity.state.volume) : null;
  const kannStumm = entity.commands.includes('mute');

  const taste = (
    icon: keyof typeof Ionicons.glyphMap,
    command: string,
    label: string
  ) => (
    <Pressable
      onPress={() => {
        tapped();
        onCommand(command);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Grosszügig: Man drückt mehrmals hintereinander, oft im Dunkeln.
      hitSlop={6}
      style={({ pressed }) => [styles.taste, pressed && { opacity: 0.65 }]}
    >
      <Ionicons name={icon} size={18} color={colors.ink} />
    </Pressable>
  );

  return (
    <View style={styles.reihe}>
      {taste('remove', 'volume_down', 'Leiser')}
      <Pressable
        onPress={kannStumm ? () => onCommand('mute') : undefined}
        accessibilityRole={kannStumm ? 'button' : undefined}
        accessibilityLabel={kannStumm ? (stumm ? 'Ton wieder an' : 'Stumm') : undefined}
        style={({ pressed }) => [styles.mitte, pressed && { opacity: 0.65 }]}
      >
        <Ionicons
          name={stumm || stand === 0 ? 'volume-mute' : 'volume-medium'}
          size={15}
          color={stumm ? colors.accent : colors.inkSoft}
        />
        <Text
          style={[styles.stand, stumm && { color: colors.accent }]}
          numberOfLines={1}
        >
          {/* Ohne Rückmeldung des Fernsehers lieber nichts behaupten:
              «0 %» wäre eine Zahl, die niemand geprüft hat. */}
          {stumm ? 'Stumm' : stand === null ? 'Ton' : `${stand} %`}
        </Text>
      </Pressable>
      {taste('add', 'volume_up', 'Lauter')}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    reihe: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    taste: {
      width: 40,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    mitte: {
      flex: 1,
      height: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    stand: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  });
