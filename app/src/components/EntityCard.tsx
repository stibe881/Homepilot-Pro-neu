import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { colors, gap, radius } from '../theme';

interface Props {
  entity: Entity;
  onCommand: (command: string, data?: Record<string, any>) => void;
}

const BRIGHTNESS_PRESETS = [10, 40, 70, 100];

export function EntityCard({ entity, onCommand }: Props) {
  const isOn = entity.state.state === 'on';
  const toggleable = entity.commands.includes('toggle');

  const body = () => {
    switch (entity.kind) {
      case 'light':
        return (
          <>
            <ValueRow entity={entity} value={isOn ? 'An' : 'Aus'} />
            {isOn && entity.commands.includes('set_brightness') && (
              <View style={styles.presets}>
                {BRIGHTNESS_PRESETS.map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => onCommand('set_brightness', { brightness: value })}
                    style={[
                      styles.preset,
                      Math.abs((entity.state.brightness ?? 100) - value) < 15 &&
                        styles.presetActive,
                    ]}
                  >
                    <Text style={styles.presetText}>{value}%</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        );
      case 'switch':
      case 'binary_sensor':
        return <ValueRow entity={entity} value={isOn ? 'An' : 'Aus'} />;
      case 'sensor':
        return (
          <ValueRow
            entity={entity}
            value={`${entity.state.state ?? '–'} ${entity.state.unit ?? ''}`.trim()}
          />
        );
      case 'alert': {
        const count = entity.state.count ?? 0;
        const alerts: any[] = entity.state.alerts ?? [];
        return (
          <>
            <ValueRow
              entity={entity}
              value={count > 0 ? `${count} Warnungen` : 'Keine Warnungen'}
              valueColor={count > 0 ? colors.yellow : colors.green}
            />
            {alerts.slice(0, 3).map((alert, index) => (
              <Text key={index} style={styles.alertLine} numberOfLines={1}>
                {alert.severity}: {alert.event ?? alert.title} ({alert.area})
              </Text>
            ))}
          </>
        );
      }
      default:
        return (
          <ValueRow entity={entity} value={String(entity.state.state ?? '–')} />
        );
    }
  };

  return (
    <Pressable
      onPress={toggleable ? () => onCommand('toggle') : undefined}
      style={({ pressed }) => [
        styles.card,
        isOn && toggleable && styles.cardOn,
        !entity.available && styles.cardUnavailable,
        pressed && toggleable && styles.cardPressed,
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {entity.name}
        </Text>
        {toggleable && (
          <View style={[styles.dot, { backgroundColor: isOn ? colors.accent : colors.off }]} />
        )}
      </View>
      {body()}
      {!entity.available && <Text style={styles.unavailable}>nicht erreichbar</Text>}
    </Pressable>
  );
}

function ValueRow({
  entity,
  value,
  valueColor,
}: {
  entity: Entity;
  value: string;
  valueColor?: string;
}) {
  const isOn = entity.state.state === 'on';
  return (
    <Text
      style={[
        styles.value,
        { color: valueColor ?? (isOn ? colors.accent : colors.textDim) },
      ]}
    >
      {value}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius,
    padding: 16,
    flexGrow: 1,
    flexBasis: 260,
    gap: 8,
  },
  cardOn: {
    backgroundColor: colors.cardActive,
    borderColor: colors.accent,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardUnavailable: {
    opacity: 0.45,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
  },
  presets: {
    flexDirection: 'row',
    gap: gap / 2,
  },
  preset: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.off,
  },
  presetActive: {
    backgroundColor: colors.accent,
  },
  presetText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 12,
  },
  alertLine: {
    color: colors.textDim,
    fontSize: 12,
  },
  unavailable: {
    color: colors.red,
    fontSize: 12,
  },
});
