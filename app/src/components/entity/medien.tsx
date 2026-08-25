/**
 * Musik auf der Kachel: Spotify-Panel, Playlists, Shuffle/Repeat.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { hubClient } from '../../api/client';
import { CommandData, Entity } from '../../api/types';
import { useSettings } from '../../hooks/HubContext';
import { zielBox } from '../../lib/boxwahl';
import { keineBoxText, senderzeile } from '../../lib/radiobox';
import { useColors } from '../../theme';
import { makeStyles } from './stil';

export { keineBoxText };


export function ShuffleRepeat({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
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
            color={shuffle ? colors.accent : colors.inkSoft}
          />
          <Text style={[styles.modeButtonText, shuffle && { color: colors.accent }]}>
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
            color={repeatOn ? colors.accent : colors.inkSoft}
          />
          <Text style={[styles.modeButtonText, repeatOn && { color: colors.accent }]}>
            {repeatLabel(repeat)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Wie der Wiederholmodus heisst (rein, testbar).
 *
 * Zwei Wortschätze, weil der Hub früher Spotifys eigene Wörter
 * durchreichte («context», «track») und heute überall dieselben drei
 * benutzt. Ein Gerät, das noch die alten meldet, soll nicht plötzlich
 * «Wiederholen» statt «Alles» anzeigen.
 */
export function repeatLabel(repeat: string): string {
  if (repeat === 'all' || repeat === 'context') return 'Alles';
  if (repeat === 'one' || repeat === 'track') return 'Ein Titel';
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
  wunschBox = null,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
  /** Boxen-Zeile weglassen – auf der Startseite übernimmt sie der
   *  Lautsprecher-Wähler in der Kopfzeile der Musikkarte. */
  hideDevices?: boolean;
  /** Die dort gewählte Box. Ohne sie startete eine Playlist auf der
   *  zuletzt aktiven Box statt auf der gewählten (siehe lib/boxwahl). */
  wunschBox?: string | null;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const devices: string[] = Array.isArray(entity.state.devices) ? entity.state.devices : [];
  // Welche davon echte Google-Lautsprechergruppen sind. Ohne diese Marke
  // sieht eine Gruppe aus wie eine Box, und wer sich wundert, warum nur
  // eine spielt, hat keinen Anhaltspunkt.
  const gruppen: string[] = Array.isArray(entity.state.device_groups)
    ? entity.state.device_groups
    : [];
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
  const target = zielBox(chosen, wunschBox, active, devices);
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
                  {gruppen.includes(name) ? `${name} · Gruppe` : name}
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
        onPress={() => {
          setListOpen(true);
          // Beim Aufklappen einmal frisch nachfragen. Der Hub holt die
          // Liste sonst nur halbstündlich - eine gerade angelegte
          // Playlist fehlte bis dahin, und niemand wusste, warum.
          if (entity.commands.includes('refresh_playlists')) {
            onCommand('refresh_playlists');
          }
        }}
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
  icon: keyof typeof Ionicons.glyphMap;
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



/**
 * Radio auf der Musikkarte – dieselbe Stelle, an der Spotify sitzt.
 *
 * Der Hub führt das Radio als Player (`play_radio`), gespielt wird aber
 * auf einer Box. Deshalb sieht diese Karte aus wie die von Spotify: oben
 * die Boxen, darunter der Knopf zur Senderliste.
 *
 * Warum die Suche im Popup und nicht in der Einstellungsseite: Man sucht
 * einen Sender in dem Moment, in dem man ihn hören will – abends, im
 * Wohnzimmer, mit dem Telefon in der Hand. Ein Umweg über eine
 * Konfigurationsdatei auf dem Hub wäre genau dann der falsche Weg.
 */
export function RadioPanel({
  entity,
  onCommand,
  hideDevices = false,
  wunschBox = null,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
  /** Boxen-Zeile weglassen – auf der Startseite übernimmt sie der
   *  Lautsprecher-Wähler in der Kopfzeile der Musikkarte. */
  hideDevices?: boolean;
  /** Die dort gewählte Box - siehe SpotifyPanel und lib/boxwahl. */
  wunschBox?: string | null;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useSettings();
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);

  const devices: string[] = Array.isArray(entity.state.devices) ? entity.state.devices : [];
  // Welche davon echte Google-Lautsprechergruppen sind. Ohne diese Marke
  // sieht eine Gruppe aus wie eine Box, und wer sich wundert, warum nur
  // eine spielt, hat keinen Anhaltspunkt.
  const gruppen: string[] = Array.isArray(entity.state.device_groups)
    ? entity.state.device_groups
    : [];
  // Wie viele Medien-Geräte der Hub überhaupt kennt. «Gar keins gefunden»
  // und «keins, das eine Tonadresse abspielen kann» sind zwei
  // verschiedene Antworten.
  const mediaPlayers =
    typeof entity.state.media_players === 'number' ? entity.state.media_players : 0;
  const stations: string[] = Array.isArray(entity.state.stations)
    ? entity.state.stations.map((name) => String(name))
    : [];
  const active: string | null = entity.state.device ?? null;
  const playing = entity.state.state === 'playing';
  const [chosen, setChosen] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const target = zielBox(chosen, wunschBox, active, devices);
  // Nur solange wirklich etwas läuft: Nach dem Anhalten wäre der Name eine
  // Behauptung über die Gegenwart, die nicht mehr stimmt.
  // Nur solange wirklich etwas läuft, und mit «lädt» für die Sekunden
  // davor – siehe lib/radiobox.ts.
  const { sender: current, laedt } = senderzeile(entity.state);

  const spielen = (station: string) => {
    setListOpen(false);
    onCommand('play_radio', target ? { station, device: target } : { station });
  };

  return (
    <View style={styles.stack}>
      {/* Die Fehlanzeige steht immer da, auch auf der Startseite: Sie ist
          keine Auswahl, sondern eine Antwort. Ohne sie sah die Karte
          normal aus, der Sender liess sich antippen – und es passierte
          nichts, weil der Ton nirgends hin konnte. */}
      {devices.length === 0 ? (
        <Text style={styles.hint}>
          {keineBoxText(mediaPlayers)}
        </Text>
      ) : null}
      {!hideDevices && devices.length > 0 ? (
        <Text style={styles.mediaLabel}>Abspielen auf</Text>
      ) : null}
      {hideDevices || devices.length === 0 ? null : (
        <View style={styles.deviceRow}>
          {devices.map((name) => {
            const selected = name === target;
            return (
              <Pressable
                key={name}
                onPress={() => {
                  setChosen(name);
                  // Läuft schon etwas, zieht es mit um; sonst merkt sich
                  // die Karte nur das Ziel für den nächsten Sender.
                  if (name !== active && playing) onCommand('play_on', { device: name });
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  name === active ? `${name} – spielt hier` : `Radio auf ${name}`
                }
                style={[styles.deviceChip, selected && styles.deviceChipActive]}
              >
                <Ionicons
                  name={name === active && playing ? 'volume-high' : 'volume-medium-outline'}
                  size={12}
                  color={selected ? '#FFFFFF' : colors.inkSoft}
                />
                <Text
                  style={[styles.deviceChipText, selected && styles.deviceChipTextActive]}
                  numberOfLines={1}
                >
                  {gruppen.includes(name) ? `${name} · Gruppe` : name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Pressable
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          current
            ? `Sender – ${laedt ? 'lädt' : 'zurzeit'} ${current}`
            : 'Sender'
        }
        style={({ pressed }) => [styles.playlistButton, pressed && { opacity: 0.85 }]}
      >
        <Ionicons
          name={current ? 'radio' : 'radio-outline'}
          size={16}
          color={current ? colors.accent : colors.ink}
        />
        <View style={{ flex: 1 }}>
          {current ? (
            <Text style={styles.playlistNow}>{laedt ? 'Lädt …' : 'Läuft'}</Text>
          ) : null}
          <Text style={styles.playlistButtonText} numberOfLines={1}>
            {current ?? 'Sender'}
          </Text>
        </View>
        <Text style={styles.spotifyCount}>{stations.length}</Text>
      </Pressable>

      <RadioSheet
        visible={listOpen}
        hub={hub}
        stations={stations}
        current={current}
        hinweis={devices.length === 0 ? keineBoxText(mediaPlayers) : null}
        onClose={() => setListOpen(false)}
        onPlay={spielen}
      />
    </View>
  );
}

/** Ein Sender, wie ihn TuneIn beschreibt. */
export interface RadioStation {
  name: string;
  id?: string;
  url?: string;
  subtext?: string;
  image?: string;
}

/**
 * Die Senderliste im Popup – mit Suche bei TuneIn.
 *
 * Zwei Abschnitte, weil es zwei verschiedene Dinge sind: die Sender des
 * Hauses und was TuneIn gerade zur Sucheingabe liefert. Ein Treffer aus
 * der Suche wird beim Antippen gemerkt *und* gespielt: Wer einen Sender
 * sucht, will ihn hören – und beim nächsten Mal wiederfinden. Ein
 * getrennter «Merken»-Knopf wäre ein zweiter Schritt für denselben Wunsch.
 */
export function RadioSheet({
  visible,
  hub,
  stations,
  current,
  hinweis,
  onClose,
  onPlay,
}: {
  visible: boolean;
  hub: ReturnType<typeof hubClient>;
  stations: string[];
  current: string | null;
  /** Warum ein Tipp hier gerade nichts bewirkt – oder null. */
  hinweis?: string | null;
  onClose: () => void;
  onPlay: (station: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [treffer, setTreffer] = useState<RadioStation[]>([]);
  const [sucht, setSucht] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setTreffer([]);
      setNote(null);
    }
  }, [visible]);

  // Erst tippen, dann suchen: Ein Aufruf je Tastendruck wäre eine
  // Anfrage zu viel an einen fremden Dienst – und die halbfertige
  // Eingabe findet ohnehin nichts.
  useEffect(() => {
    const begriff = query.trim();
    if (begriff.length < 2) {
      setTreffer([]);
      return;
    }
    let abgebrochen = false;
    setSucht(true);
    const zeit = setTimeout(() => {
      hub
        .get<{ stations?: RadioStation[] } | null>(
          `/api/radio/search?q=${encodeURIComponent(begriff)}`,
          { fallback: null, still: true }
        )
        .then((data) => {
          if (abgebrochen) return;
          setTreffer(data?.stations ?? []);
          setNote(data === null ? 'TuneIn antwortet gerade nicht.' : null);
        })
        .finally(() => {
          if (!abgebrochen) setSucht(false);
        });
    }, 450);
    return () => {
      abgebrochen = true;
      clearTimeout(zeit);
    };
  }, [query, hub]);

  const merkenUndSpielen = async (station: RadioStation) => {
    try {
      await hub.post('/api/radio/stations', station, { still: true });
    } catch (err) {
      // Gemerkt hat es nicht geklappt – abspielen lässt sich der Sender
      // dann auch nicht, denn der Hub kennt ihn nur über seine Liste.
      setNote(String(err instanceof Error ? err.message : err));
      return;
    }
    onPlay(station.name);
  };

  const vergessen = async (name: string) => {
    try {
      await hub.del(`/api/radio/stations/${encodeURIComponent(name)}`, { still: true });
      setNote(`«${name}» entfernt`);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  const eigene = stations.filter(
    (name) => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase())
  );
  // Was schon in der Liste steht, muss die Suche nicht noch einmal anbieten.
  const neue = treffer.filter(
    (station) => !stations.some((name) => name.toLowerCase() === station.name.toLowerCase())
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Radio</Text>
          <Pressable onPress={onClose} accessibilityLabel="Schliessen" hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.spotifySearch}>
          <Ionicons name="search" size={15} color={colors.inkFaint} />
          <TextInput
            style={styles.spotifySearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Sender suchen – auch bei TuneIn …"
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

        {/* Ganz oben, nicht unten: Wer hier einen Sender antippt und
            nichts hört, soll den Grund gelesen haben, bevor er tippt. */}
        {hinweis ? <Text style={styles.warnHint}>{hinweis}</Text> : null}
        {note ? <Text style={styles.hint}>{note}</Text> : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {eigene.length === 0 && stations.length === 0 ? (
            <Text style={styles.hint}>
              Noch kein Sender eingerichtet. Tippe oben einen Namen ein – was
              TuneIn dazu findet, erscheint darunter und bleibt danach in der
              Liste.
            </Text>
          ) : null}
          {eigene.map((name) => (
            <View key={name} style={styles.playlistRow}>
              <Pressable
                onPress={() => onPlay(name)}
                accessibilityRole="button"
                accessibilityLabel={`${name} abspielen`}
                style={styles.playlistTap}
              >
                <Ionicons
                  name={name === current ? 'radio' : 'radio-outline'}
                  size={18}
                  color={name === current ? colors.accent : colors.inkSoft}
                />
                <Text style={styles.playlistName} numberOfLines={1}>
                  {name}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => vergessen(name)}
                accessibilityRole="button"
                accessibilityLabel={`${name} aus der Liste entfernen`}
                hitSlop={6}
                style={styles.playlistIcon}
              >
                <Ionicons name="close" size={18} color={colors.inkFaint} />
              </Pressable>
            </View>
          ))}

          {sucht ? <Text style={styles.hint}>Suche bei TuneIn …</Text> : null}
          {neue.length > 0 ? (
            <Text style={styles.mediaLabel}>Bei TuneIn gefunden</Text>
          ) : null}
          {neue.map((station) => (
            <Pressable
              key={station.id || station.name}
              onPress={() => merkenUndSpielen(station)}
              accessibilityRole="button"
              accessibilityLabel={`${station.name} merken und abspielen`}
              style={styles.playlistRow}
            >
              <View style={styles.playlistTap}>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.playlistName} numberOfLines={1}>
                    {station.name}
                  </Text>
                  {station.subtext ? (
                    <Text style={styles.hint} numberOfLines={1}>
                      {station.subtext}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
