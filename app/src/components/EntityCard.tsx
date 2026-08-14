import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { colors, radius, type } from '../theme';
import { Bar } from './Bar';
import { Card, CardFooter } from './Card';

interface Props {
  entity: Entity;
  width: number;
  onCommand: (command: string, data?: Record<string, any>) => void;
  /** Kommando unterwegs – die Kachel zeigt das, statt still zu wirken. */
  pending?: boolean;
  /** Strompreis für die Kostenanzeige, z.B. 0.32 */
  pricePerKwh?: number;
  currency?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  Extreme: colors.danger,
  Severe: colors.danger,
  Moderate: colors.warn,
  Minor: colors.warn,
};

export function EntityCard({
  entity,
  width,
  onCommand,
  pending,
  pricePerKwh,
  currency = 'CHF',
}: Props) {
  const isOn = entity.state.state === 'on';
  const subtitle = entity.room || integrationLabel(entity.integration);
  const toggle = entity.commands.includes('toggle')
    ? () => onCommand('toggle')
    : undefined;

  /** Leistung und, wenn ein Preis hinterlegt ist, die Tageskosten. */
  const powerNote = (): string | undefined => {
    const parts: string[] = [];
    if (entity.state.power != null) {
      parts.push(`${entity.state.power} W`);
    }
    if (entity.state.energy_today != null && pricePerKwh) {
      const cost = Number(entity.state.energy_today) * pricePerKwh;
      parts.push(`heute ${cost.toFixed(2)} ${currency}`);
    }
    return parts.length ? parts.join(' · ') : undefined;
  };

  const body = () => {
    switch (entity.kind) {
      case 'light':
        return entity.commands.includes('set_brightness') ? (
          <View style={styles.stack}>
            <Bar
              value={isOn ? entity.state.brightness ?? 100 : 0}
              onChange={(value) => onCommand('set_brightness', { brightness: value })}
            />
            <Text style={styles.hint}>
              {isOn ? `${Math.round(entity.state.brightness ?? 100)} % Helligkeit` : 'Aus'}
            </Text>
          </View>
        ) : (
          <BigValue value={isOn ? 'An' : 'Aus'} on={isOn} />
        );

      case 'switch':
        return <BigValue value={isOn ? 'An' : 'Aus'} on={isOn} note={powerNote()} />;

      case 'binary_sensor':
        return <Pill label={isOn ? 'Aktiv' : 'Ruhig'} tone={isOn ? colors.on : undefined} />;

      case 'sensor':
        return (
          <BigValue
            value={`${format(entity.state.state)}${
              entity.state.unit ? ' ' + entity.state.unit : ''
            }`}
          />
        );

      case 'appliance':
        return (
          <View style={styles.stack}>
            <Pill
              label={entity.state.state === 'running' ? 'Läuft' : 'Bereit'}
              tone={entity.state.state === 'running' ? colors.accent : undefined}
            />
            {entity.state.program ? (
              <Text style={styles.detail}>
                {entity.state.program}
                {entity.state.program_end ? ` · noch ${entity.state.program_end}` : ''}
              </Text>
            ) : null}
          </View>
        );

      case 'alert': {
        const count = entity.state.count ?? 0;
        const severity = entity.state.max_severity;
        const alerts: any[] = entity.state.alerts ?? [];
        return (
          <View style={styles.stack}>
            <Pill
              label={count > 0 ? `${count} Warnungen` : 'Keine Warnungen'}
              tone={count > 0 ? SEVERITY_COLOR[severity] ?? colors.warn : colors.on}
              solid
            />
            {alerts.slice(0, 2).map((alert, index) => (
              <Text key={index} numberOfLines={1} style={styles.detail}>
                {alert.event ?? alert.title} · {alert.area}
              </Text>
            ))}
          </View>
        );
      }

      default:
        return <BigValue value={String(entity.state.state ?? '–')} />;
    }
  };

  return (
    <Card style={{ width }} dimmed={!entity.available}>
      <View style={styles.body}>{body()}</View>
      <CardFooter
        title={entity.name}
        subtitle={pending ? 'wird geschaltet …' : entity.available ? subtitle : 'nicht erreichbar'}
        on={isOn}
        onToggle={toggle}
        pending={pending}
      />
    </Card>
  );
}

function BigValue({ value, on, note }: { value: string; on?: boolean; note?: string }) {
  return (
    <View>
      <Text style={[styles.value, on && { color: colors.on }]}>{value}</Text>
      {note ? <Text style={styles.hint}>{note}</Text> : null}
    </View>
  );
}

function Pill({ label, tone, solid }: { label: string; tone?: string; solid?: boolean }) {
  const color = tone ?? colors.inkSoft;
  return (
    <View
      style={[
        styles.pill,
        solid
          ? { backgroundColor: color }
          : { backgroundColor: colors.surfaceSoft, borderColor: color, borderWidth: 1 },
      ]}
    >
      <Text style={[styles.pillText, solid ? { color: '#fff' } : { color }]}>{label}</Text>
    </View>
  );
}

function format(value: any): string {
  if (typeof value === 'number') {
    return String(Math.round(value * 10) / 10);
  }
  return String(value ?? '–');
}

function integrationLabel(integration: string): string {
  const names: Record<string, string> = {
    hue: 'Philips Hue',
    mqtt: 'Tasmota',
    homematic: 'Homematic',
    unifi: 'UniFi',
    twinkly: 'Twinkly',
    vzug: 'V-ZUG',
    meteoalarm: 'MeteoAlarm',
    demo: 'Demo',
  };
  return names[integration] ?? integration;
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  stack: { gap: 8 },
  value: {
    color: colors.ink,
    fontSize: type.value,
    fontWeight: '600',
  },
  hint: {
    color: colors.inkSoft,
    fontSize: type.cardSub,
  },
  detail: {
    color: colors.inkSoft,
    fontSize: 12,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
