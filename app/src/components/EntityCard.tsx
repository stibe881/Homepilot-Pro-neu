import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Colors, radius, type, useColors } from '../theme';
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
  /** Anpassen-Modus: zeigt Knöpfe für Favorit und Ausblenden. */
  editing?: boolean;
  favorite?: boolean;
  hidden?: boolean;
  onToggleFavorite?: () => void;
  onToggleHidden?: () => void;
  /** Sensorkacheln lassen sich antippen und zeigen dann ihren Verlauf. */
  onPress?: () => void;
  chart?: React.ReactNode;
}

/** Warnstufen brauchen je nach Palette andere Farben. */
function severityColor(colors: Colors, severity: string): string {
  return severity === 'Extreme' || severity === 'Severe' ? colors.danger : colors.warn;
}

export function EntityCard({
  entity,
  width,
  onCommand,
  pending,
  pricePerKwh,
  currency = 'CHF',
  editing,
  favorite,
  hidden,
  onToggleFavorite,
  onToggleHidden,
  onPress,
  chart,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

      case 'media_player': {
        const playing = entity.state.state === 'playing';
        return (
          <View style={styles.stack}>
            <Text style={styles.value} numberOfLines={1}>
              {entity.state.track ?? 'Nichts läuft'}
            </Text>
            {entity.state.artist ? (
              <Text style={styles.hint} numberOfLines={1}>
                {entity.state.artist}
                {entity.state.device ? ` · ${entity.state.device}` : ''}
              </Text>
            ) : null}
            {entity.commands.includes('next') ? (
              <View style={styles.mediaRow}>
                <MediaButton icon="play-skip-back" label="Zurück"
                  onPress={() => onCommand('previous')} />
                <MediaButton icon={playing ? 'pause' : 'play'}
                  label={playing ? 'Pause' : 'Abspielen'}
                  onPress={() => onCommand(playing ? 'pause' : 'play')} />
                <MediaButton icon="play-skip-forward" label="Weiter"
                  onPress={() => onCommand('next')} />
              </View>
            ) : null}
          </View>
        );
      }

      case 'camera': {
        const online = entity.state.state === 'online';
        return (
          <View style={styles.stack}>
            <Pill
              label={online ? 'Online' : 'Offline'}
              tone={online ? colors.on : colors.danger}
            />
            {entity.state.motion === 'on' ? (
              <Pill label="Bewegung" tone={colors.warn} solid />
            ) : null}
            {entity.state.last_motion ? (
              <Text style={styles.detail}>
                Letzte Bewegung {clock(entity.state.last_motion)}
              </Text>
            ) : null}
            {entity.state.last_ring ? (
              <Text style={styles.detail}>
                Zuletzt geklingelt {clock(entity.state.last_ring)}
              </Text>
            ) : null}
          </View>
        );
      }

      case 'vacuum': {
        const cleaning = entity.state.state === 'cleaning';
        return (
          <View style={styles.stack}>
            <Pill
              label={vacuumLabel(entity.state.state)}
              tone={cleaning ? colors.accent : entity.state.error ? colors.danger : undefined}
            />
            <Text style={styles.hint}>
              {entity.state.battery != null ? `${entity.state.battery} % Akku` : ''}
              {entity.state.clean_area_m2 != null
                ? ` · ${entity.state.clean_area_m2} m²`
                : ''}
              {entity.state.error ? ` · ${entity.state.error}` : ''}
            </Text>
            <View style={styles.mediaRow}>
              <MediaButton icon="play" label="Reinigung starten"
                onPress={() => onCommand('start')} />
              <MediaButton icon="pause" label="Pausieren"
                onPress={() => onCommand('pause')} />
              <MediaButton icon="home" label="Zur Station"
                onPress={() => onCommand('dock')} />
            </View>
          </View>
        );
      }

      case 'calendar': {
        const events: any[] = entity.state.events ?? [];
        return (
          <View style={styles.stack}>
            <Text style={styles.value} numberOfLines={1}>
              {entity.state.state === 'frei' ? 'Keine Termine' : entity.state.state}
            </Text>
            {entity.state.next_start ? (
              <Text style={styles.hint}>
                {entity.state.next_all_day
                  ? 'ganztägig'
                  : eventTime(entity.state.next_start)}
              </Text>
            ) : null}
            {events.slice(1, 3).map((event, index) => (
              <Text key={index} numberOfLines={1} style={styles.detail}>
                {event.all_day ? '· ' : `${eventTime(event.start)} `}
                {event.summary}
              </Text>
            ))}
          </View>
        );
      }

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
              tone={count > 0 ? severityColor(colors, severity) : colors.on}
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
    <Card
      style={{ width }}
      dimmed={!entity.available || (hidden && !editing)}
      onPress={onPress}
    >
      {editing ? (
        <View style={styles.editRow}>
          <EditButton
            icon={favorite ? 'star' : 'star-outline'}
            active={!!favorite}
            label={favorite ? 'Favorit entfernen' : 'Als Favorit'}
            onPress={onToggleFavorite}
          />
          <EditButton
            icon={hidden ? 'eye-off' : 'eye-outline'}
            active={!!hidden}
            label={hidden ? 'Wieder einblenden' : 'Ausblenden'}
            onPress={onToggleHidden}
          />
        </View>
      ) : null}
      <View style={styles.body}>{body()}</View>
      {chart}
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

function EditButton({
  icon,
  active,
  label,
  onPress,
}: {
  icon: any;
  active: boolean;
  label: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.inkSoft} />
    </Pressable>
  );
}

function MediaButton({
  icon,
  label,
  onPress,
}: {
  icon: any;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.mediaButton, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={colors.ink} />
    </Pressable>
  );
}

function vacuumLabel(state: string | undefined): string {
  const labels: Record<string, string> = {
    cleaning: 'Reinigt',
    returning: 'Fährt zur Station',
    charging: 'Lädt',
    charging_complete: 'Geladen',
    docked: 'An der Station',
    idle: 'Bereit',
    paused: 'Pausiert',
    error: 'Fehler',
  };
  return labels[state ?? ''] ?? state ?? '–';
}

/** Startzeit eines Termins: Uhrzeit heute, sonst mit Datum. */
function eventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  const time = date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString('de-CH', { weekday: 'short' })} ${time}`;
}

/** Uhrzeit heute, sonst Datum – für „letzte Bewegung“. */
function clock(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? `um ${time}`
    : `am ${date.toLocaleDateString('de-CH', { day: 'numeric', month: 'numeric' })} um ${time}`;
}

function BigValue({ value, on, note }: { value: string; on?: boolean; note?: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View>
      <Text style={[styles.value, on && { color: colors.on }]}>{value}</Text>
      {note ? <Text style={styles.hint}>{note}</Text> : null}
    </View>
  );
}

function Pill({ label, tone, solid }: { label: string; tone?: string; solid?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  body: { gap: 8 },
  stack: { gap: 8 },
  editRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  mediaRow: { flexDirection: 'row', gap: 10 },
  mediaButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  editButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
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
