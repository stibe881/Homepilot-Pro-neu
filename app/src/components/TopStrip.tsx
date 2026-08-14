import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { ConnectionStatus } from '../hooks/useHub';
import { colors } from '../theme';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'verbunden',
  connecting: 'verbinde …',
  disconnected: 'getrennt',
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: colors.on,
  connecting: colors.warn,
  disconnected: colors.danger,
};

/**
 * Kopfzeile: links Messwerte aus dem Haus, rechts Verbindung und Uhrzeit.
 *
 * Gezeigt werden die ersten Sensoren mit passender Einheit – ohne Sensoren
 * bleibt die Zeile leer statt Platzhalter zu erfinden.
 */
export function TopStrip({
  entities,
  status,
  now,
}: {
  entities: Entity[];
  status: ConnectionStatus;
  now: Date;
}) {
  const temperature = entities.find(
    (entity) => entity.kind === 'sensor' && entity.state.unit === '°C'
  );
  const humidity = entities.find(
    (entity) => entity.kind === 'sensor' && entity.state.unit === '%'
  );
  const people = entities.find((entity) => entity.id.endsWith('anyone_home'));

  return (
    <View style={styles.row}>
      <View style={styles.chips}>
        {temperature ? (
          <Chip icon="thermometer-outline" text={`${round(temperature.state.state)} °C`} />
        ) : null}
        {humidity ? (
          <Chip icon="water-outline" text={`${round(humidity.state.state)} %`} />
        ) : null}
        {people ? (
          <Chip
            icon="people-outline"
            text={people.state.state === 'on' ? 'jemand da' : 'niemand da'}
          />
        ) : null}
      </View>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
          <Text style={styles.chipText}>{STATUS_LABEL[status]}</Text>
        </View>
        <Text style={styles.clock}>
          {now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}

function Chip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={15} color={colors.onGradientSoft} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

function round(value: any): string {
  return typeof value === 'number' ? String(Math.round(value * 10) / 10) : String(value ?? '–');
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexShrink: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    color: colors.onGradientSoft,
    fontSize: 13,
    fontWeight: '500',
  },
  clock: {
    color: colors.onGradient,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
