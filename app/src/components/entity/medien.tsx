/**
 * Musik auf der Kachel: Spotify-Panel, Playlists, Shuffle/Repeat.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Entity } from '../../api/types';
import { useColors } from '../../theme';
import { makeStyles } from './stil';


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
      // Nicht speicherbar heisst nur: beim nächsten Start wieder die
      // Standard-Reihenfolge.
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
export function PlaylistSheet({
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
  const gefiltert = sorted.filter(
    (name) =>
      (editing || !hidden.includes(name)) &&
      (!needle || name.toLowerCase().includes(needle))
  );
  // Ausgeblendete ans Ende: Oben steht dann, was man wirklich benutzt,
  // und die Ausgeblendeten sammeln sich unten, statt die Liste zu
  // durchsetzen. Ausserhalb des Bearbeitens sind sie ohnehin nicht dabei.
  const listed = editing
    ? [
        ...gefiltert.filter((name) => !hidden.includes(name)),
        ...gefiltert.filter((name) => hidden.includes(name)),
      ]
    : gefiltert;

  const move = (name: string, delta: number) => {
    const next = [...sorted];
    const from = next.indexOf(name);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= next.length) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    onSave(next, hidden);
  };

  const toggleHidden = (name: string) => {
    const wirdAusgeblendet = !hidden.includes(name);
    // Beim Ausblenden auch in der gespeicherten Reihenfolge nach hinten:
    // Sonst bliebe eine unsichtbare Lücke zwischen zwei Playlists stehen,
    // über die die Pfeile daneben hinwegschöben, ohne dass sich sichtbar
    // etwas ändert.
    onSave(
      wirdAusgeblendet
        ? [...sorted.filter((entry) => entry !== name), name]
        : sorted,
      wirdAusgeblendet
        ? [...hidden, name]
        : hidden.filter((entry) => entry !== name)
    );
  };

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
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Suche leeren"
              >
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
                        accessibilityLabel={off ? 'ausgeblendet' : 'sichtbar'}
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
export function MediaButton({
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

