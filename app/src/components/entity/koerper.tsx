/**
 * Die Gerätekörper: Schloss, Kamera, Grill, Storen, Staubsauger.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { Entity } from '../../api/types';
import { useTakt } from '../../hooks/useTakt';
import { radius, useColors } from '../../theme';
import { Bar } from '../Bar';
import { CoverVisual, Sky } from '../CoverVisual';
import { MediaButton } from './medien';
import { makeStyles } from './stil';
import { Pill, clock } from './teile';


export function LockBody({
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

  // Nuki-Schloss: auf-/abschliessen plus «Auf + öffnen» (Falle ziehen).
  if (entity.commands.includes('unlock')) {
    const value = String(entity.state.state ?? '');
    const locked = value === 'locked';
    const moving = ['locking', 'unlocking', 'unlatching'].includes(value);
    const label =
      value === 'locked' ? 'Abgeschlossen'
      : value === 'unlocked' ? 'Aufgeschlossen'
      : value === 'unlatched' ? 'Offen'
      : value === 'locking' ? 'Schliesst ab …'
      : value === 'unlocking' ? 'Schliesst auf …'
      : value === 'unlatching' ? 'Öffnet …'
      : value === 'motor_blocked' ? 'Motor blockiert'
      : '–';
    return (
      <View style={styles.stack}>
        <Pill
          label={label}
          tone={
            value === 'motor_blocked' ? colors.danger : locked ? undefined : colors.on
          }
        />
        {entity.state.battery != null ? (
          <Text style={styles.hint}>
            {entity.state.battery} % Akku
            {entity.state.battery_critical ? ' · schwach!' : ''}
            {entity.state.door === 'open' ? ' · Tür offen' : ''}
          </Text>
        ) : null}
        <View style={styles.mediaRow}>
          <MediaButton
            icon={locked ? 'lock-open-outline' : 'lock-closed-outline'}
            label={locked ? 'Aufschliessen' : 'Abschliessen'}
            onPress={() => onCommand(locked ? 'unlock' : 'lock')}
          />
        </View>
        {/* Nur, wo das Schloss die Falle wirklich ziehen kann. Der Knopf
            stand vorher immer da - bei einem Schloss ohne diese Fähigkeit
            führte er zu «Kommando wird nicht unterstützt», und die Türe
            blieb zu. Ein Knopf, der nichts tun kann, ist schlimmer als
            keiner: Man drückt ihn im Hausflur und wartet. */}
        {entity.commands.includes('unlatch') ? (
          <Pressable
            disabled={pending || moving}
            onPress={() => {
              if (armed) {
                setArmed(false);
                onCommand('unlatch');
              } else {
                setArmed(true);
              }
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.lockButton,
              armed && styles.lockButtonArmed,
              (pressed || pending || moving) && { opacity: 0.7 },
            ]}>
            <Ionicons name={armed ? 'lock-open' : 'key-outline'} size={16} color="#FFFFFF" />
            <Text style={styles.lockButtonText}>
              {armed ? 'Wirklich öffnen?' : 'Auf + öffnen'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

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

/** Spotify: Box wählen, Playlist antippen – auch aus völliger Stille.
 *
 *  Die gewählte Box gilt für den nächsten Playlist-Start; läuft schon
 *  Musik, zieht der Tipp auf eine andere Box die Wiedergabe sofort um
 *  (Spotify Connect). Google-Lautsprecher erscheinen in der Liste, wenn
 *  Spotify in der Google-Home-App verknüpft ist. */
/**
 * Zufallswiedergabe und Wiederholung.
 *
 * Beides sind Zustände, keine Aktionen – deshalb bleiben sie sichtbar an
 * oder aus, statt beim Tippen nur kurz aufzuleuchten. Wiederholen hat drei
 * Stufen und wird durchgetippt: aus → alles → ein Titel.
 */
export function CameraSnapshot({
  uri,
  refreshKey,
  contain,
  refreshMs = 60_000,
}: {
  uri: string;
  refreshKey: string;
  /** Karten ganz zeigen statt formatfüllend zuschneiden. */
  contain?: boolean;
  /** Abstand zwischen zwei Bildern. */
  refreshMs?: number;
}) {
  const colors = useColors();
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useTakt(() => setTick((value) => value + 1), refreshMs);
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

/** Sanft nachgeführte Anzeige-Position.
 *
 * Somfy meldet die Position nur grob (oft erst am Ende der Fahrt). Statt zu
 * springen, gleitet die Anzeige mit der Geschwindigkeit der echten Store
 * zum Ziel – die volle Laufzeit lernt der Hub aus beobachteten Fahrten
 * (state.travel_seconds) und liefert sie mit; ohne Messung gelten 25 s. */
export function useGlide(target: number, fullTravelSeconds: number): number {
  const [display, setDisplay] = useState(target);
  const goal = useRef(target);
  goal.current = target;
  const tick = 150;
  useTakt(
    () =>
      setDisplay((current) => {
        const step = (100 / Math.max(3, fullTravelSeconds)) * (tick / 1000);
        const aim = goal.current;
        if (Math.abs(aim - current) <= step) return aim;
        return current + Math.sign(aim - current) * step;
      }),
    tick
  );
  return display;
}

/** Storen/Rollläden/Raffstoren: ein Fenster, über das sich die Storen in
 *  Echtzeit bewegen. Darunter hoch/stopp/runter und – wo möglich –
 *  Position und Lamellenwinkel als Schieberegler.
 *
 *  Eigene Komponente statt Inline-Zweig, weil die gleitende Position
 *  eigene Hooks braucht. Ein Knopfdruck setzt das Ziel sofort («weiss ja,
 *  wohin die Fahrt geht»), die nächste Meldung des Hubs übernimmt. */
/**
 * Pelletgrill.
 *
 * Was beim Grillen wirklich zählt, steht oben: die Temperatur im Garraum
 * und die der Fleischfühler. Alles andere ist Beiwerk – ausser einer
 * Störung, die gehört nach vorne, weil ein leerer Pelletbehälter das
 * Fleisch kalt werden lässt, während man drinnen sitzt.
 *
 * Anzünden ist zweistufig und erscheint nur, wenn es in der config.yaml
 * freigegeben ist. Es entfacht ein Feuer in einem Gerät, neben dem gerade
 * niemand stehen muss – ein einzelner Fehlgriff soll das nicht auslösen.
 */
export function GrillBody({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: Record<string, unknown>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [askStart, setAskStart] = useState(false);

  const unit = entity.state.unit ?? '°C';
  const temperature = entity.state.temperature;
  const target = entity.state.target;
  const running = entity.state.state === 'running';
  const probes: Record<string, number> = entity.state.probes ?? {};
  const problem = entity.state.problem;

  // Der Grill nimmt nur bestimmte Sollwerte an und rundet selbst auf den
  // nächsten – deshalb genügen hier grobe Schritte.
  const step = (delta: number) =>
    onCommand('set_temperature', { temperature: Math.round((target ?? 100) + delta) });

  return (
    <View style={styles.stack}>
      <Pill
        label={
          running
            ? typeof temperature === 'number'
              ? `${temperature} ${unit}`
              : 'Läuft'
            : 'Aus'
        }
        tone={running ? colors.accent : undefined}
      />

      {problem ? <Text style={styles.grillProblem}>{problem}</Text> : null}

      {running && typeof target === 'number' ? (
        <View style={styles.grillRow}>
          <Pressable
            onPress={() => step(-5)}
            hitSlop={6}
            accessibilityLabel="Temperatur senken"
            style={({ pressed }) => [styles.grillStep, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="remove" size={16} color={colors.ink} />
          </Pressable>
          <Text style={styles.hint}>
            Ziel {target} {unit}
          </Text>
          <Pressable
            onPress={() => step(5)}
            hitSlop={6}
            accessibilityLabel="Temperatur erhöhen"
            style={({ pressed }) => [styles.grillStep, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="add" size={16} color={colors.ink} />
          </Pressable>
        </View>
      ) : null}

      {Object.entries(probes).map(([number, value]) => (
        <Text key={number} style={styles.detail}>
          Fühler {number}: {value} {unit}
        </Text>
      ))}

      <View style={styles.mediaRow}>
        {entity.commands.includes('turn_on') ? (
          <MediaButton
            icon={askStart ? 'flame' : 'flame-outline'}
            label={askStart ? 'Wirklich?' : 'Anzünden'}
            onPress={() => {
              if (askStart) {
                setAskStart(false);
                onCommand('turn_on');
              } else {
                setAskStart(true);
              }
            }}
          />
        ) : null}
        {entity.commands.includes('light_on') ? (
          <MediaButton
            icon="bulb-outline"
            label="Licht"
            onPress={() => onCommand(entity.state.light ? 'light_off' : 'light_on')}
          />
        ) : null}
        <MediaButton icon="power" label="Aus" onPress={() => onCommand('turn_off')} />
      </View>
    </View>
  );
}

export function CoverBody({
  entity,
  sky,
  onCommand,
}: {
  entity: Entity;
  sky?: Sky;
  onCommand: (command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pos = entity.state.position;
  const tilt = entity.state.tilt;
  // Fällt die Position, leiten wir sie aus dem Zustand ab, damit sich die
  // Grafik trotzdem bewegt (zu = 0, offen = 100).
  const reported =
    typeof pos === 'number'
      ? pos
      : entity.state.state === 'closed'
        ? 0
        : entity.state.state === 'partial'
          ? 50
          : 100;
  const travel =
    typeof entity.state.travel_seconds === 'number' ? entity.state.travel_seconds : 25;

  // Zwischen Knopfdruck und erster Hub-Meldung fährt die Anzeige schon aufs
  // Ziel zu; sobald der Hub etwas Neues meldet, gilt wieder er.
  const [anticipated, setAnticipated] = useState<number | null>(null);
  const lastReported = useRef(reported);
  useEffect(() => {
    if (reported !== lastReported.current) {
      lastReported.current = reported;
      setAnticipated(null);
    }
  }, [reported]);

  const target = anticipated ?? reported;
  const display = useGlide(target, travel);
  const shown = Math.round(display);
  const moving = Math.abs(display - target) > 1;

  const go = (command: 'open' | 'stop' | 'close') => {
    if (command === 'open') setAnticipated(100);
    else if (command === 'close') setAnticipated(0);
    // Halt: an Ort stehen bleiben, bis der Hub die echte Position meldet.
    else setAnticipated(display);
    onCommand(command);
  };

  return (
    <View style={styles.stack}>
      <CoverVisual open={display} tilt={typeof tilt === 'number' ? tilt : undefined} sky={sky} />
      <Pill
        label={
          moving
            ? `${shown}% · fährt`
            : shown <= 1
              ? 'Geschlossen'
              : shown >= 99
                ? 'Offen'
                : `${shown}% offen`
        }
        tone={moving ? colors.accent : undefined}
      />
      {entity.commands.includes('set_position') && typeof pos === 'number' ? (
        <View style={styles.stack}>
          <Text style={styles.hint}>Position: {shown} % offen</Text>
          <Bar
            value={shown}
            onChange={(value) => {
              setAnticipated(value);
              onCommand('set_position', { position: value });
            }}
          />
        </View>
      ) : null}
      {entity.commands.includes('set_tilt') && typeof tilt === 'number' ? (
        <View style={styles.stack}>
          <Text style={styles.hint}>Lamellen: {tilt} % offen</Text>
          <Bar value={tilt} onChange={(value) => onCommand('set_tilt', { tilt: value })} />
        </View>
      ) : null}
      <View style={styles.mediaRow}>
        <MediaButton icon="arrow-up" label="Hoch" onPress={() => go('open')} />
        <MediaButton icon="stop" label="Stopp" onPress={() => go('stop')} />
        <MediaButton icon="arrow-down" label="Runter" onPress={() => go('close')} />
      </View>
    </View>
  );
}

export interface Room {
  id: number;
  name: string;
  /** [x0, y0, x1, y1] als Anteile (0..1) des Kartenbilds, falls vorhanden. */
  box?: number[];
}

/** Kompletter Sauger-Inhalt: Karte (antippbar, wenn Raumkoordinaten da sind)
 *  oder Bild plus Raum-Chips, Zustand, Knöpfe und der Saugen-Auslöser. Die
 *  Raumauswahl lebt hier, damit Karte und Chips denselben Zustand teilen. */
export function VacuumBody({
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
        {entity.commands.includes('locate') ? (
          <MediaButton icon="search" label="Sauger finden" onPress={() => onCommand('locate')} />
        ) : null}
      </View>

      {/* Saugstärke wählen. */}
      {entity.commands.includes('set_fan_speed') &&
      Array.isArray(entity.state.fan_speeds) ? (
        <View style={styles.deviceRow}>
          {(entity.state.fan_speeds as string[]).map((level) => {
            const active = entity.state.fan_speed === level;
            return (
              <Pressable
                key={level}
                onPress={() => onCommand('set_fan_speed', { level })}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.deviceChip, active && styles.deviceChipActive]}>
                <Text
                  style={[styles.deviceChipText, active && styles.deviceChipTextActive]}
                  numberOfLines={1}>
                  {FAN_SPEED_LABELS[level] ?? level}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

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
export function VacuumMap({
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
  useTakt(() => setTick((value) => value + 1), 60_000);
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

export const FAN_SPEED_LABELS: Record<string, string> = {
  silent: 'Leise',
  balanced: 'Normal',
  turbo: 'Turbo',
  max: 'Max',
};

export function vacuumLabel(state: string | undefined): string {
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
