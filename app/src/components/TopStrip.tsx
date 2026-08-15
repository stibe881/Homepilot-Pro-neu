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

  // Die Zwei-Sekunden-Übersicht: Was ist an, was läuft, was steht an?
  const lightsOn = entities.filter(
    (entity) =>
      (entity.kind === 'light' || entity.kind === 'switch') &&
      entity.state.state === 'on'
  ).length;
  const vacuum = entities.find(
    (entity) => entity.kind === 'vacuum' && entity.state.state === 'cleaning'
  );
  const calendar = entities.find(
    (entity) => entity.kind === 'calendar' && entity.state.next_start
  );
  const alerts = entities.find(
    (entity) => entity.kind === 'alert' && entity.state.state === 'alert'
  );

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
        {lightsOn > 0 ? (
          <Chip icon="bulb-outline" text={lightsOn === 1 ? '1 an' : `${lightsOn} an`} />
        ) : null}
        {vacuum ? <Chip icon="sparkles-outline" text="saugt" /> : null}
        {calendar ? (
          <Chip
            icon="calendar-outline"
            text={`${clockTime(calendar.state.next_start)} ${calendar.state.state}`}
          />
        ) : null}
        {alerts ? (
          <Chip
            icon="warning-outline"
            text={`${alerts.state.count ?? ''} Warnung${alerts.state.count === 1 ? '' : 'en'}`}
            tone={colors.warn}
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

function Chip({
  icon,
  text,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={15} color={tone ?? colors.onGradientSoft} />
      <Text style={[styles.chipText, tone ? { color: tone } : null]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function round(value: any): string {
  return typeof value === 'number' ? String(Math.round(value * 10) / 10) : String(value ?? '–');
}

/** "16:00" aus einem ISO-Zeitstempel – ganztägige Termine haben keinen. */
function clockTime(iso: any): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
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
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 4,
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
