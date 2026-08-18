import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Entity } from '../api/types';
import { Colors, radius, type, useColors } from '../theme';
import { Bar } from './Bar';
import { Card, CardFooter } from './Card';
import { CoverVisual, Sky } from './CoverVisual';
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
  /** Anpassen-Modus: Gerät sperren – schaltet nur nach Rückfrage. */
  locked?: boolean;
  onToggleLocked?: () => void;
  /** Anpassen-Modus: Raum dieser Kachel setzen. */
  rooms?: string[];
  onSetRoom?: (room: string | null) => void;
  /** Anpassen-Modus: Gerät umbenennen. */
  onRename?: (name: string) => void;
  /** Anpassen-Modus: Gerät einer Gruppe zuordnen (oder lösen). */
  groups?: string[];
  onSetGroup?: (group: string | null) => void;
  /** Sensorkacheln lassen sich antippen und zeigen dann ihren Verlauf. */
  onPress?: () => void;
  chart?: React.ReactNode;
  /** Kamerakacheln: URL des Schnappschuss-Endpunkts (inkl. Token). */
  snapshotUri?: string;
  /** Storen-Kacheln: aktuelle Wetterlage für den Himmel hinter dem Fenster. */
  sky?: Sky;
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
  locked,
  onToggleLocked,
  rooms,
  onSetRoom,
  onRename,
  groups,
  onSetGroup,
  onPress,
  chart,
  snapshotUri,
  sky,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const isOn = entity.state.state === 'on';
  const subtitle = entity.room || integrationLabel(entity.integration);
  // Offline-Geräte: «nicht erreichbar · zuletzt vor …», damit man sieht, ob
  // das Gerät gerade eben oder seit Tagen weg ist.
  const offlineText =
    'nicht erreichbar' + (entity.last_seen ? ` · zuletzt ${sinceLabel(entity.last_seen)}` : '');
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

      case 'binary_sensor': {
        // Tür-/Fensterkontakte sagen offen/geschlossen, Bewegungsmelder
        // aktiv/ruhig – „aktiv" an einer Tür würde niemand verstehen.
        const contact = entity.state.device_class === 'contact';
        const battery = entity.state.battery;
        return (
          <View style={styles.stack}>
            <Pill
              label={contact ? (isOn ? 'Offen' : 'Geschlossen') : isOn ? 'Aktiv' : 'Ruhig'}
              tone={isOn ? (contact ? colors.warn : colors.on) : undefined}
              solid={contact && isOn}
            />
            {typeof battery === 'number' ? (
              <Text style={styles.detail}>
                Batterie {Math.round(battery)} %{battery <= 15 ? ' – schwach!' : ''}
              </Text>
            ) : null}
          </View>
        );
      }

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
            <ShuffleRepeat entity={entity} onCommand={onCommand} />
            {hasRemote ? (
              <TvRemote
                visible={remoteOpen}
                name={entity.name}
                onClose={() => setRemoteOpen(false)}
                onCommand={onCommand}
              />
            ) : null}
            {entity.commands.includes('set_volume') ? (
              <View style={styles.volumeRow}>
                <Pressable
                  onPress={() => onCommand('mute')}
                  hitSlop={8}
                  accessibilityLabel="Stumm schalten">
                  <Ionicons
                    name={
                      entity.state.muted || entity.state.volume === 0
                        ? 'volume-mute'
                        : 'volume-low'
                    }
                    size={20}
                    color={entity.state.muted ? colors.accent : colors.inkSoft}
                  />
                </Pressable>
                <View style={styles.volumeBar}>
                  <Bar
                    height={28}
                    value={typeof entity.state.volume === 'number' ? entity.state.volume : 0}
                    onChange={(value) => onCommand('set_volume', { volume: value })}
                  />
                </View>
                <Ionicons name="volume-high" size={20} color={colors.inkSoft} />
              </View>
            ) : null}
            {entity.commands.includes('play_playlist') ? (
              <SpotifyPanel entity={entity} onCommand={onCommand} />
            ) : null}
            {!entity.commands.includes('play_playlist') &&
            entity.commands.includes('play_on') &&
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
        const privacyOn = entity.state.privacy === 'on';
        return (
          <View style={styles.stack}>
            {snapshotUri && online ? (
              <CameraSnapshot
                uri={snapshotUri}
                // Neue Bewegung oder Klingeln holt sofort ein frisches Bild.
                refreshKey={`${entity.state.last_motion ?? ''}|${entity.state.last_ring ?? ''}`}
                // Kacheln zeigen Standbilder: ein Livestrom je Kamera
                // gleichzeitig wäre für den Hub zu viel. Dafür öfter als
                // sonst – Bewegtbild gibt es beim Antippen.
                refreshMs={15_000}
              />
            ) : null}
            <Pill
              label={online ? 'Online' : 'Offline'}
              tone={online ? colors.on : colors.danger}
            />
            {privacyOn ? (
              <Pill label="Privatsphäre aktiv" tone={colors.accent} solid />
            ) : null}
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
            {entity.state.stream && online ? (
              <Text style={styles.detail}>Tippen für Live-Bild</Text>
            ) : null}
            {entity.commands.includes('set_privacy') ? (
              // Bild schwarz, Mikrofon stumm, Aufnahme aus – und alles
              // zurück, wie es war, beim zweiten Tipp.
              <Pressable
                onPress={(event: any) => {
                  // Nicht die Kachel «Live-Bild öffnen» auslösen.
                  event?.stopPropagation?.();
                  onCommand('set_privacy', { enabled: !privacyOn });
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: privacyOn }}
                accessibilityLabel="Privatsphäre"
                style={({ pressed }) => [
                  styles.privacyButton,
                  privacyOn && styles.privacyButtonActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={privacyOn ? 'eye-off' : 'eye-off-outline'}
                  size={15}
                  color={privacyOn ? '#FFFFFF' : colors.inkSoft}
                />
                <Text
                  style={[styles.privacyText, privacyOn && { color: '#FFFFFF' }]}
                >
                  {privacyOn ? 'Privatsphäre beenden' : 'Privatsphäre'}
                </Text>
              </Pressable>
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

      case 'cover':
        return <CoverBody entity={entity} sky={sky} onCommand={onCommand} />;

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

      case 'button': {
        // Ein Taster hat keinen Zustand zum Ablesen – er meldet einen
        // Druck. Anzuzeigen ist deshalb der letzte.
        const press = entity.state.last_press;
        const pressed = entity.state.state === 'short' || entity.state.state === 'long';
        return (
          <View style={styles.stack}>
            <Pill
              label={
                !pressed
                  ? 'Bereit'
                  : entity.state.state === 'long'
                    ? 'Lang gedrückt'
                    : 'Kurz gedrückt'
              }
            />
            <Text style={styles.detail}>
              {typeof press === 'number' ? sinceLabel(press) : 'Noch kein Druck'}
            </Text>
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
        // Chips und Knöpfe stehen in zwei umbrechenden Zeilen: auf einer
        // halbbreiten Telefonkachel passt sonst nicht alles nebeneinander
        // und die hinteren Symbole ragen aus der Kachel heraus.
        <View style={styles.editBox}>
          {(onSetRoom && rooms) || (onSetGroup && groups) ? (
            <View style={styles.editChips}>
              {onSetRoom && rooms ? (
                <Pressable
                  onPress={() => setRoomPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Raum wählen"
                  style={({ pressed }) => [styles.roomChip, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="home-outline" size={13} color={colors.ink} />
                  <Text style={styles.roomChipText} numberOfLines={1}>
                    {entity.room ?? 'Kein Raum'}
                  </Text>
                </Pressable>
              ) : null}
              {onSetGroup && groups ? (
                <Pressable
                  onPress={() => setGroupPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Gruppe wählen"
                  style={({ pressed }) => [styles.roomChip, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="layers-outline" size={13} color={colors.ink} />
                  <Text style={styles.roomChipText} numberOfLines={1}>
                    {entity.group ?? 'Keine Gruppe'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={styles.editButtons}>
            {onRename ? (
              <EditButton
                icon="pencil"
                active={false}
                label="Umbenennen"
                onPress={() => setRenameOpen(true)}
              />
            ) : null}
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
            {onToggleLocked ? (
              <EditButton
                icon={locked ? 'lock-closed' : 'lock-open-outline'}
                active={!!locked}
                label={
                  locked
                    ? 'Sperre aufheben'
                    : 'Sperren – schaltet nur nach Rückfrage'
                }
                onPress={onToggleLocked}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {onSetRoom && rooms ? (
        <RoomPicker
          visible={roomPickerOpen}
          current={entity.room ?? null}
          rooms={rooms}
          onClose={() => setRoomPickerOpen(false)}
          onSelect={(room) => {
            setRoomPickerOpen(false);
            onSetRoom(room);
          }}
        />
      ) : null}
      {onRename ? (
        <RenameDialog
          visible={renameOpen}
          current={entity.name}
          onClose={() => setRenameOpen(false)}
          onSubmit={(name) => {
            setRenameOpen(false);
            onRename(name);
          }}
        />
      ) : null}
      {onSetGroup && groups ? (
        <GroupPicker
          visible={groupPickerOpen}
          current={entity.group ?? null}
          groups={groups}
          onClose={() => setGroupPickerOpen(false)}
          onSelect={(group) => {
            setGroupPickerOpen(false);
            onSetGroup(group);
          }}
        />
      ) : null}
      <View style={styles.body}>{body()}</View>
      {chart}
      <CardFooter
        title={entity.name}
        subtitle={pending ? 'wird geschaltet …' : entity.available ? subtitle : offlineText}
        on={isOn}
        onToggle={toggle}
        pending={pending}
      />
    </Card>
  );
}

/** Raumauswahl im Anpassen-Modus: „Kein Raum“ plus alle bekannten Räume. */
function RoomPicker({
  visible,
  current,
  rooms,
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string | null;
  rooms: string[];
  onClose: () => void;
  onSelect: (room: string | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const options: { key: string; label: string; value: string | null }[] = [
    { key: '__none', label: 'Kein Raum', value: null },
    ...rooms.map((name) => ({ key: name, label: name, value: name })),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Raum wählen</Text>
          <ScrollView>
            {options.map((option) => {
              const active = option.value === current;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => onSelect(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.roomOption, active && styles.roomOptionActive]}
                >
                  <Text style={styles.roomOptionText}>{option.label}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Umbenennen-Dialog: ein Textfeld mit dem aktuellen Namen vorbelegt. */
function RenameDialog({
  visible,
  current,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(current);
  // Bei jedem Öffnen mit dem aktuellen Namen starten.
  useEffect(() => {
    if (visible) setName(current);
  }, [visible, current]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Gerät umbenennen</Text>
          <TextInput
            style={styles.renameInput}
            value={name}
            onChangeText={setName}
            placeholder="Neuer Name"
            placeholderTextColor={colors.inkFaint}
            autoFocus
          />
          <View style={styles.renameRow}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameGhost, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.renameGhostText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(name.trim())}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.renameSaveText}>Speichern</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Gruppenauswahl im Anpassen-Modus: bestehende Gruppen plus «neue anlegen». */
function GroupPicker({
  visible,
  current,
  groups,
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string | null;
  groups: string[];
  onClose: () => void;
  onSelect: (group: string | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [fresh, setFresh] = useState('');
  useEffect(() => {
    if (visible) setFresh('');
  }, [visible]);
  const options: { key: string; label: string; value: string | null }[] = [
    { key: '__none', label: 'Keine Gruppe', value: null },
    ...groups.map((name) => ({ key: name, label: name, value: name })),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Gruppe wählen</Text>
          <ScrollView>
            {options.map((option) => {
              const active = option.value === current;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => onSelect(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.roomOption, active && styles.roomOptionActive]}
                >
                  <Text style={styles.roomOptionText}>{option.label}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.renameRow}>
            <TextInput
              style={[styles.renameInput, { flex: 1, marginBottom: 0 }]}
              value={fresh}
              onChangeText={setFresh}
              placeholder="Neue Gruppe …"
              placeholderTextColor={colors.inkFaint}
            />
            <Pressable
              onPress={() => fresh.trim() && onSelect(fresh.trim())}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.renameSaveText}>Anlegen</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.ink} />
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
export function ShuffleRepeat({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const canShuffle = entity.commands.includes('shuffle');
  const canRepeat = entity.commands.includes('repeat');
  if (!canShuffle && !canRepeat) return null;

  const shuffle = !!entity.state.shuffle;
  const repeat = String(entity.state.repeat ?? 'off');
  const repeatOn = repeat !== 'off';

  return (
    <View style={styles.modeRow}>
      {canShuffle ? (
        <Pressable
          onPress={() => onCommand('shuffle')}
          accessibilityRole="switch"
          accessibilityState={{ checked: shuffle }}
          accessibilityLabel={shuffle ? 'Zufall aus' : 'Zufall ein'}
          style={({ pressed }) => [
            styles.modeButton,
            shuffle && styles.modeButtonOn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons
            name="shuffle"
            size={17}
            color={shuffle ? '#FFFFFF' : colors.inkSoft}
          />
          <Text style={[styles.modeButtonText, shuffle && { color: '#FFFFFF' }]}>
            Zufall
          </Text>
        </Pressable>
      ) : null}
      {canRepeat ? (
        <Pressable
          onPress={() => onCommand('repeat')}
          accessibilityRole="button"
          accessibilityLabel={`Wiederholen: ${repeatLabel(repeat)}`}
          style={({ pressed }) => [
            styles.modeButton,
            repeatOn && styles.modeButtonOn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons
            name="repeat"
            size={17}
            color={repeatOn ? '#FFFFFF' : colors.inkSoft}
          />
          <Text style={[styles.modeButtonText, repeatOn && { color: '#FFFFFF' }]}>
            {repeatLabel(repeat)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Wie der Wiederholmodus heisst (rein, testbar). */
export function repeatLabel(repeat: string): string {
  if (repeat === 'context') return 'Alles';
  if (repeat === 'track') return 'Ein Titel';
  return 'Wiederholen';
}

/**
 * Playlists in die selbst gewählte Reihenfolge bringen (rein, testbar).
 *
 * Neue Playlists, die es bei der letzten Sortierung noch nicht gab, hängen
 * sich hinten an, statt zu verschwinden – sonst würde eine frisch
 * angelegte Playlist unbemerkt fehlen.
 */
export function sortPlaylists(playlists: string[], order: string[]): string[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return [...playlists].sort((a, b) => {
    const ra = rank.has(a) ? (rank.get(a) as number) : Infinity;
    const rb = rank.has(b) ? (rank.get(b) as number) : Infinity;
    return ra !== rb ? ra - rb : playlists.indexOf(a) - playlists.indexOf(b);
  });
}

export function SpotifyPanel({
  entity,
  onCommand,
  hideDevices = false,
}: {
  entity: Entity;
  onCommand: (command: string, data?: Record<string, any>) => void;
  /** Boxen-Zeile weglassen – auf der Startseite übernimmt sie der
   *  Lautsprecher-Wähler in der Kopfzeile der Musikkarte. */
  hideDevices?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const devices: string[] = Array.isArray(entity.state.devices) ? entity.state.devices : [];
  const playlists: string[] = Array.isArray(entity.state.playlists)
    ? entity.state.playlists
    : [];
  const active: string | null = entity.state.device ?? null;
  const playing = entity.state.state === 'playing';
  const [chosen, setChosen] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Eigene Reihenfolge und ausgeblendete Playlists. Reine Ansichtssache,
  // deshalb auf dem Gerät statt im Hub – jeder darf seine eigene haben.
  const [order, setOrder] = useState<string[]>([]);
  const [hiddenList, setHiddenList] = useState<string[]>([]);
  const prefsKey = `homepilot.playlists.${entity.id}`;

  useEffect(() => {
    AsyncStorage.getItem(prefsKey)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        setOrder(Array.isArray(saved.order) ? saved.order : []);
        setHiddenList(Array.isArray(saved.hidden) ? saved.hidden : []);
      })
      .catch(() => {});
  }, [prefsKey]);

  const savePrefs = (nextOrder: string[], nextHidden: string[]) => {
    setOrder(nextOrder);
    setHiddenList(nextHidden);
    AsyncStorage.setItem(
      prefsKey,
      JSON.stringify({ order: nextOrder, hidden: nextHidden })
    ).catch(() => {});
  };

  // Ziel: zuletzt angetippt → gerade aktiv → erste Box.
  const target = (chosen && devices.includes(chosen) ? chosen : null) ?? active ?? devices[0] ?? null;
  const visible = sortPlaylists(playlists, order).filter(
    (name) => !hiddenList.includes(name)
  );
  // Nur solange wirklich etwas läuft: Nach dem Anhalten wäre der Name eine
  // Behauptung über die Gegenwart, die nicht mehr stimmt.
  const current =
    playing && typeof entity.state.playlist === 'string'
      ? entity.state.playlist
      : null;

  return (
    <View style={styles.stack}>
      {!hideDevices ? <Text style={styles.mediaLabel}>Abspielen auf</Text> : null}
      {hideDevices ? null : devices.length > 0 ? (
        <View style={styles.deviceRow}>
          {devices.map((name) => {
            const selected = name === target;
            return (
              <Pressable
                key={name}
                onPress={() => {
                  setChosen(name);
                  if (name === active) return;
                  // Immer umziehen, nicht nur wenn gerade Musik läuft:
                  // «play» folgt dem bisherigen Zustand, damit Pausiertes
                  // pausiert bleibt und dort weiterläuft, wo man es erwartet.
                  onCommand('play_on', { device: name, play: playing });
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  name === active ? `${name} – spielt hier` : `Musik auf ${name} umziehen`
                }
                style={[styles.deviceChip, selected && styles.deviceChipActive]}>
                <Ionicons
                  name={name === active && playing ? 'volume-high' : 'volume-medium-outline'}
                  size={12}
                  color={selected ? '#FFFFFF' : colors.inkSoft}
                />
                <Text
                  style={[styles.deviceChipText, selected && styles.deviceChipTextActive]}
                  numberOfLines={1}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.hint}>
          Keine Lautsprecher sichtbar – in der Google-Home-App Spotify verknüpfen
          oder die Spotify-App einmal im selben Netz öffnen.
        </Text>
      )}

      {/* Läuft gerade eine Playlist, steht sie auf dem Knopf – das ist die
          Antwort auf «was höre ich hier eigentlich». Sonst führt er schlicht
          zur Auswahl. */}
      <Pressable
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          current ? `Playlists – zurzeit ${current}` : 'Playlists'
        }
        style={({ pressed }) => [styles.playlistButton, pressed && { opacity: 0.85 }]}
      >
        <Ionicons
          name={current ? 'musical-notes' : 'list'}
          size={16}
          color={current ? colors.accent : colors.ink}
        />
        <View style={{ flex: 1 }}>
          {current ? <Text style={styles.playlistNow}>Läuft</Text> : null}
          <Text style={styles.playlistButtonText} numberOfLines={1}>
            {current ?? 'Playlists'}
          </Text>
        </View>
        <Text style={styles.spotifyCount}>{visible.length}</Text>
      </Pressable>

      <PlaylistSheet
        visible={listOpen}
        playlists={playlists}
        order={order}
        hidden={hiddenList}
        onClose={() => setListOpen(false)}
        onPlay={(name) => {
          setListOpen(false);
          onCommand('play_playlist', target ? { name, device: target } : { name });
        }}
        onSave={savePrefs}
      />
    </View>
  );
}

/**
 * Playlists im Popup statt als Wust in der Kachel.
 *
 * Mit «Bearbeiten» lässt sich ausblenden, was man nie hört, und die
 * Reihenfolge festlegen – bei über dreissig Playlists ist die Reihenfolge
 * von Spotify selten die, in der man sie braucht.
 */
function PlaylistSheet({
  visible,
  playlists,
  order,
  hidden,
  onClose,
  onPlay,
  onSave,
}: {
  visible: boolean;
  playlists: string[];
  order: string[];
  hidden: string[];
  onClose: () => void;
  onPlay: (name: string) => void;
  onSave: (order: string[], hidden: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);

  // Beim Öffnen mit leerer Suche starten; der Bearbeiten-Modus bleibt aus.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setEditing(false);
    }
  }, [visible]);

  const sorted = sortPlaylists(playlists, order);
  const needle = query.trim().toLowerCase();
  // Im Bearbeiten-Modus auch die ausgeblendeten zeigen – sonst kommt man
  // nie wieder an sie heran.
  const listed = sorted.filter(
    (name) =>
      (editing || !hidden.includes(name)) &&
      (!needle || name.toLowerCase().includes(needle))
  );

  const move = (name: string, delta: number) => {
    const next = [...sorted];
    const from = next.indexOf(name);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= next.length) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    onSave(next, hidden);
  };

  const toggleHidden = (name: string) =>
    onSave(
      sorted,
      hidden.includes(name)
        ? hidden.filter((entry) => entry !== name)
        : [...hidden, name]
    );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Playlists</Text>
          <Pressable
            onPress={() => setEditing((value) => !value)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={styles.sheetAction}>{editing ? 'Fertig' : 'Bearbeiten'}</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityLabel="Schliessen" hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        {!editing ? (
          <View style={styles.spotifySearch}>
            <Ionicons name="search" size={15} color={colors.inkFaint} />
            <TextInput
              style={styles.spotifySearchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Playlist suchen …"
              placeholderTextColor={colors.inkFaint}
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text style={styles.hint}>
            Auge blendet eine Playlist aus, die Pfeile ändern die Reihenfolge.
            Ausgeblendete bleiben hier sichtbar, damit du sie zurückholen kannst.
          </Text>
        )}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {listed.length === 0 ? (
            <Text style={styles.hint}>
              {playlists.length === 0
                ? 'Keine Playlists gefunden – vermutlich fehlen dem Spotify-Zugang die playlist-read-Scopes.'
                : 'Keine Playlist passt zur Suche.'}
            </Text>
          ) : null}
          {listed.map((name, index) => {
            const off = hidden.includes(name);
            return (
              <View key={name} style={styles.playlistRow}>
                {editing ? (
                  <>
                    <Pressable
                      onPress={() => toggleHidden(name)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !off }}
                      hitSlop={6}
                      style={styles.playlistIcon}
                    >
                      <Ionicons
                        name={off ? 'eye-off' : 'eye'}
                        size={20}
                        color={off ? colors.inkFaint : colors.accent}
                      />
                    </Pressable>
                    <Text
                      style={[styles.playlistName, off && { color: colors.inkFaint }]}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <Pressable
                      onPress={() => move(name, -1)}
                      accessibilityLabel={`${name} nach oben`}
                      hitSlop={6}
                      style={styles.playlistIcon}
                      disabled={index === 0}
                    >
                      <Ionicons
                        name="chevron-up"
                        size={20}
                        color={index === 0 ? colors.inkFaint : colors.ink}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => move(name, 1)}
                      accessibilityLabel={`${name} nach unten`}
                      hitSlop={6}
                      style={styles.playlistIcon}
                      disabled={index === listed.length - 1}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={20}
                        color={index === listed.length - 1 ? colors.inkFaint : colors.ink}
                      />
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={() => onPlay(name)}
                    accessibilityRole="button"
                    style={styles.playlistTap}
                  >
                    <Ionicons name="musical-notes" size={18} color={colors.inkSoft} />
                    <Text style={styles.playlistName} numberOfLines={1}>
                      {name}
                    </Text>
                    <Ionicons name="play" size={18} color={colors.accent} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Standbild (Kamera oder Saugerkarte), das sich von selbst frisch hält:
 *  alle 60 Sekunden und zusätzlich sofort, wenn refreshKey wechselt. */
function CameraSnapshot({
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
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
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
function useGlide(target: number, fullTravelSeconds: number): number {
  const [display, setDisplay] = useState(target);
  const goal = useRef(target);
  goal.current = target;
  useEffect(() => {
    const tick = 150;
    const timer = setInterval(() => {
      setDisplay((current) => {
        const step = (100 / Math.max(3, fullTravelSeconds)) * (tick / 1000);
        const aim = goal.current;
        if (Math.abs(aim - current) <= step) return aim;
        return current + Math.sign(aim - current) * step;
      });
    }, tick);
    return () => clearInterval(timer);
  }, [fullTravelSeconds]);
  return display;
}

/** Storen/Rollläden/Raffstoren: ein Fenster, über das sich die Storen in
 *  Echtzeit bewegen. Darunter hoch/stopp/runter und – wo möglich –
 *  Position und Lamellenwinkel als Schieberegler.
 *
 *  Eigene Komponente statt Inline-Zweig, weil die gleitende Position
 *  eigene Hooks braucht. Ein Knopfdruck setzt das Ziel sofort («weiss ja,
 *  wohin die Fahrt geht»), die nächste Meldung des Hubs übernimmt. */
function CoverBody({
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
        <MediaButton icon="chevron-up" label="Hoch" onPress={() => go('open')} />
        <MediaButton icon="stop" label="Stopp" onPress={() => go('stop')} />
        <MediaButton icon="chevron-down" label="Runter" onPress={() => go('close')} />
      </View>
    </View>
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

const FAN_SPEED_LABELS: Record<string, string> = {
  silent: 'Leise',
  balanced: 'Normal',
  turbo: 'Turbo',
  max: 'Max',
};

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

/** «Zuletzt gesehen»-Abstand in Alltagssprache (rein, testbar). */
function sinceLabel(epochSeconds: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (seconds < 90) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
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
  editBox: { gap: 8 },
  editChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  editButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  roomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    // Kräftige Fläche statt der fast durchsichtigen: auf hellen wie dunklen
    // Kacheln muss der Chip lesbar bleiben.
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    flexShrink: 1,
    maxWidth: '100%',
  },
  roomChipText: { fontSize: 12, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  roomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  roomSheet: {
    width: 320,
    maxWidth: '100%',
    maxHeight: '80%',
    borderRadius: 24,
    padding: 18,
    gap: 6,
    backgroundColor: colors.gradient[1],
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  roomSheetTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  roomOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.control,
  },
  roomOptionActive: { backgroundColor: colors.surfaceSoft },
  roomOptionText: { fontSize: 15, color: colors.ink },
  renameInput: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  renameGhost: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  renameGhostText: { color: colors.inkSoft, fontSize: 15, fontWeight: '600' },
  renameSave: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  renameSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  mediaRow: { flexDirection: 'row', gap: 10 },
  mediaLabel: {
    color: colors.inkFaint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  modeButtonOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeButtonText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
  playlistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  playlistButtonText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  playlistNow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60, gap: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sheetTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', flex: 1 },
  sheetAction: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  playlistTap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingVertical: 10 },
  playlistName: { color: colors.ink, fontSize: 15, flex: 1 },
  playlistIcon: { padding: 8 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volumeBar: { flex: 1 },
  spotifyCount: { color: colors.inkFaint, fontSize: 12, fontWeight: '700' },
  spotifySearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.control,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  spotifySearchInput: { flex: 1, paddingVertical: 8, color: colors.ink, fontSize: 14 },
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
  privacyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  privacyButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  privacyText: { fontSize: 12, fontWeight: '700', color: colors.inkSoft },
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Wie beim Chip: deckende Fläche, sonst verschwindet das Symbol auf
    // hellen Kachelbildern (Kamera, Sauger) fast vollständig.
    backgroundColor: colors.surfaceStrong,
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
