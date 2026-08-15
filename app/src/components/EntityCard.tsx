import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Colors, radius, type, useColors } from '../theme';
import { Bar } from './Bar';
import { Card, CardFooter } from './Card';
import { TvRemote } from './TvRemote';

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
  /** Kamerakacheln: URL des Schnappschuss-Endpunkts (inkl. Token). */
  snapshotUri?: string;
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
  snapshotUri,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [remoteOpen, setRemoteOpen] = useState(false);
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
        const hasRemote = entity.commands.includes('dpad_up');
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
                {hasRemote ? (
                  <MediaButton icon="game-controller-outline" label="Fernbedienung"
                    onPress={() => setRemoteOpen(true)} />
                ) : null}
              </View>
            ) : null}
            {hasRemote ? (
              <TvRemote
                visible={remoteOpen}
                name={entity.name}
                onClose={() => setRemoteOpen(false)}
                onCommand={onCommand}
              />
            ) : null}
            {entity.commands.includes('play_on') &&
            Array.isArray(entity.state.devices) &&
            entity.state.devices.length > 0 ? (
              <View style={styles.deviceRow}>
                {entity.state.devices.map((name: string) => {
                  const active = name === entity.state.device;
                  return (
                    <Pressable
                      key={name}
                      onPress={() => (active ? undefined : onCommand('play_on', { device: name }))}
                      style={[styles.deviceChip, active && styles.deviceChipActive]}>
                      <Ionicons
                        name={active ? 'volume-high' : 'volume-medium-outline'}
                        size={12}
                        color={active ? '#FFFFFF' : colors.inkSoft}
                      />
                      <Text
                        style={[styles.deviceChipText, active && styles.deviceChipTextActive]}
                        numberOfLines={1}>
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      }

      case 'camera': {
        const online = entity.state.state === 'online';
        return (
          <View style={styles.stack}>
            {snapshotUri && online ? (
              <CameraSnapshot
                uri={snapshotUri}
                // Neue Bewegung oder Klingeln holt sofort ein frisches Bild.
                refreshKey={`${entity.state.last_motion ?? ''}|${entity.state.last_ring ?? ''}`}
              />
            ) : null}
            <Pill
              label={online ? 'Online' : 'Offline'}
              tone={online ? colors.on : colors.danger}
            />
            {entity.state.ring === 'on' ? (
              <Pill label="Klingelt" tone={colors.danger} solid />
            ) : null}
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
        const rooms: any[] = Array.isArray(entity.state.rooms) ? entity.state.rooms : [];
        const canCleanRooms = entity.commands.includes('clean_rooms') && rooms.length > 0;
        // Räume mit Kartenkoordinaten → direkt auf der Karte antippbar.
        const mappable = canCleanRooms && rooms.some((room) => Array.isArray(room.box));
        return (
          <VacuumBody
            entity={entity}
            snapshotUri={snapshotUri}
            rooms={rooms}
            mappable={mappable}
            canCleanRooms={canCleanRooms}
            cleaning={cleaning}
            onCommand={onCommand}
          />
        );
      }

      case 'lock':
        return <LockBody entity={entity} onCommand={onCommand} pending={pending} />;

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

/** Türöffner (z.B. Ring Intercom): Öffnen braucht zwei Tipps – der erste
 *  bewaffnet den Knopf für vier Sekunden, erst der zweite öffnet wirklich.
 *  Eine Haustür soll sich nicht durch Wischen aus Versehen öffnen. */
function LockBody({
  entity,
  onCommand,
  pending,
}: {
  entity: Entity;
  onCommand: (command: string, data?: Record<string, any>) => void;
  pending?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  const opened = entity.state.state === 'opened';

  return (
    <View style={styles.stack}>
      {opened ? (
        <Pill label="Geöffnet" tone={colors.on} solid />
      ) : (
        <Pill
          label={entity.state.state === 'offline' ? 'Offline' : 'Bereit'}
          tone={entity.state.state === 'offline' ? colors.danger : undefined}
        />
      )}
      {entity.state.battery != null ? (
        <Text style={styles.hint}>{entity.state.battery} % Akku</Text>
      ) : null}
      {entity.state.last_ring ? (
        <Text style={styles.detail}>Zuletzt geklingelt {clock(entity.state.last_ring)}</Text>
      ) : null}
      <Pressable
        disabled={pending || opened}
        onPress={() => {
          if (armed) {
            setArmed(false);
            onCommand('open_door');
          } else {
            setArmed(true);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Wirklich öffnen' : 'Tür öffnen'}
        style={({ pressed }) => [
          styles.lockButton,
          armed && styles.lockButtonArmed,
          (pressed || pending || opened) && { opacity: 0.7 },
        ]}>
        <Ionicons name={armed ? 'lock-open' : 'lock-closed-outline'} size={16} color="#FFFFFF" />
        <Text style={styles.lockButtonText}>
          {opened ? 'Geöffnet' : armed ? 'Wirklich öffnen?' : 'Tür öffnen'}
        </Text>
      </Pressable>
    </View>
  );
}

/** Standbild (Kamera oder Saugerkarte), das sich von selbst frisch hält:
 *  alle 60 Sekunden und zusätzlich sofort, wenn refreshKey wechselt. */
function CameraSnapshot({
  uri,
  refreshKey,
  contain,
}: {
  uri: string;
  refreshKey: string;
  /** Karten ganz zeigen statt formatfüllend zuschneiden. */
  contain?: boolean;
}) {
  const colors = useColors();
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (failed) {
    return null; // Gerät ohne Bild: Kachel bleibt wie bisher.
  }
  const separator = uri.includes('?') ? '&' : '?';
  return (
    <Image
      source={{ uri: `${uri}${separator}t=${tick}-${encodeURIComponent(refreshKey)}` }}
      onError={() => setFailed(true)}
      resizeMode={contain ? 'contain' : 'cover'}
      style={{
        width: '100%',
        aspectRatio: contain ? 4 / 3 : 16 / 9,
        borderRadius: radius.control,
        backgroundColor: colors.surfaceSoft,
      }}
    />
  );
}

interface Room {
  id: number;
  name: string;
  /** [x0, y0, x1, y1] als Anteile (0..1) des Kartenbilds, falls vorhanden. */
  box?: number[];
}

/** Kompletter Sauger-Inhalt: Karte (antippbar, wenn Raumkoordinaten da sind)
 *  oder Bild plus Raum-Chips, Zustand, Knöpfe und der Saugen-Auslöser. Die
 *  Raumauswahl lebt hier, damit Karte und Chips denselben Zustand teilen. */
function VacuumBody({
  entity,
  snapshotUri,
  rooms,
  mappable,
  canCleanRooms,
  cleaning,
  onCommand,
}: {
  entity: Entity;
  snapshotUri?: string;
  rooms: Room[];
  mappable: boolean;
  canCleanRooms: boolean;
  cleaning: boolean;
  onCommand: (command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<number[]>([]);
  const toggle = (id: number) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  const clean = () => {
    onCommand('clean_rooms', { rooms: selected });
    setSelected([]);
  };

  return (
    <View style={styles.stack}>
      {snapshotUri && mappable ? (
        <VacuumMap
          uri={snapshotUri}
          refreshKey={String(entity.state.state)}
          rooms={rooms}
          selected={selected}
          onToggle={toggle}
        />
      ) : snapshotUri ? (
        <CameraSnapshot uri={snapshotUri} refreshKey={String(entity.state.state)} contain />
      ) : null}

      <Pill
        label={vacuumLabel(entity.state.state)}
        tone={cleaning ? colors.accent : entity.state.error ? colors.danger : undefined}
      />
      <Text style={styles.hint}>
        {entity.state.battery != null ? `${entity.state.battery} % Akku` : ''}
        {entity.state.clean_area_m2 != null ? ` · ${entity.state.clean_area_m2} m²` : ''}
        {entity.state.error ? ` · ${entity.state.error}` : ''}
      </Text>
      <View style={styles.mediaRow}>
        <MediaButton icon="play" label="Reinigung starten" onPress={() => onCommand('start')} />
        <MediaButton icon="pause" label="Pausieren" onPress={() => onCommand('pause')} />
        <MediaButton icon="home" label="Zur Station" onPress={() => onCommand('dock')} />
      </View>

      {/* Ohne Kartenkoordinaten: Räume als Chips. Mit Karte tippt man direkt
          hinein – dann sind die Chips überflüssig. */}
      {canCleanRooms && !mappable ? (
        <View style={styles.deviceRow}>
          {rooms.map((room) => {
            const active = selected.includes(room.id);
            return (
              <Pressable
                key={room.id}
                onPress={() => toggle(room.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                style={[styles.deviceChip, active && styles.deviceChipActive]}>
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={12}
                  color={active ? '#FFFFFF' : colors.inkSoft}
                />
                <Text
                  style={[styles.deviceChipText, active && styles.deviceChipTextActive]}
                  numberOfLines={1}>
                  {room.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {selected.length > 0 ? (
        <Pressable
          onPress={clean}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cleanRoomsButton, pressed && { opacity: 0.75 }]}>
          <Ionicons name="play" size={14} color="#FFFFFF" />
          <Text style={styles.cleanRoomsText}>
            {selected.length === 1 ? '1 Raum saugen' : `${selected.length} Räume saugen`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Saugerkarte mit antippbaren Räumen: das gerenderte Kartenbild, darüber
 *  je Raum eine transparente Fläche; ausgewählte Räume werden eingefärbt. */
function VacuumMap({
  uri,
  refreshKey,
  rooms,
  selected,
  onToggle,
}: {
  uri: string;
  refreshKey: string;
  rooms: Room[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  const colors = useColors();
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const separator = uri.includes('?') ? '&' : '?';

  if (failed) {
    // Karte nicht ladbar: auf Chips zurückfallen, damit die Auswahl bleibt.
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {rooms.map((room) => {
          const active = selected.includes(room.id);
          return (
            <Pressable
              key={room.id}
              onPress={() => onToggle(room.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: active ? colors.accent : colors.surfaceSoft,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.surfaceBorder,
              }}>
              <Text style={{ fontSize: 12, color: active ? '#FFFFFF' : colors.inkSoft }}>
                {room.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.control, overflow: 'hidden', backgroundColor: colors.surfaceSoft }}>
      <Image
        source={{ uri: `${uri}${separator}t=${tick}-${encodeURIComponent(refreshKey)}` }}
        onError={() => setFailed(true)}
        resizeMode="contain"
        style={{ width: '100%', height: '100%' }}
      />
      {rooms.map((room) => {
        if (!Array.isArray(room.box)) return null;
        const [x0, y0, x1, y1] = room.box;
        const active = selected.includes(room.id);
        return (
          <Pressable
            key={room.id}
            onPress={() => onToggle(room.id)}
            accessibilityRole="checkbox"
            accessibilityLabel={room.name}
            accessibilityState={{ checked: active }}
            style={{
              position: 'absolute',
              left: `${x0 * 100}%`,
              top: `${y0 * 100}%`,
              width: `${(x1 - x0) * 100}%`,
              height: `${(y1 - y0) * 100}%`,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: active ? 2 : 0,
              borderColor: '#FFFFFF',
              borderRadius: 6,
              backgroundColor: active ? 'rgba(47,107,246,0.45)' : 'transparent',
            }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: '#FFFFFF',
                textShadowColor: 'rgba(0,0,0,0.55)',
                textShadowRadius: 3,
              }}>
              {room.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  deviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  deviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    maxWidth: '100%',
  },
  deviceChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  deviceChipText: { fontSize: 12, color: colors.inkSoft, flexShrink: 1 },
  deviceChipTextActive: { color: '#FFFFFF' },
  cleanRoomsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  cleanRoomsText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  lockButtonArmed: { backgroundColor: colors.danger },
  lockButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
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
