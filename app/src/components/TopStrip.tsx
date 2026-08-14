import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { ConnectionStatus } from '../hooks/useHub';
import { Colors, useColors } from '../theme';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'verbunden',
  connecting: 'verbinde …',
  disconnected: 'getrennt',
};

function statusColor(colors: Colors, status: ConnectionStatus): string {
  if (status === 'connected') return colors.on;
  return status === 'connecting' ? colors.warn : colors.danger;
}

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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
          <View style={[styles.dot, { backgroundColor: statusColor(colors, status) }]} />
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
