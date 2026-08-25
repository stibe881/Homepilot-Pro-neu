import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { CommandData, Entity, KalenderEintrag } from '../api/types';
import { offlineSatz } from '../lib/funkstille';
import { zustandsText } from '../lib/haushalt';
import { KachelEintrag, kachelAktionen } from '../lib/kachelmenue';
import { hatWarteschlange } from '../lib/musikliste';
import { useColors } from '../theme';
import { Bar } from './Bar';
import { Card, CardFooter } from './Card';
import { Musikliste } from './Musikliste';
import { ColorRow } from './ColorRow';
import { Sky } from './CoverVisual';
import { TvApps } from './TvApps';
import { TvSleep } from './TvSleep';
import { TvRemote } from './TvRemote';
import {
  EditButton,
  GroupPicker,
  KachelMenue,
  RenameDialog,
  RoomPicker,
} from './entity/anpassen';
import {
  CameraSnapshot,
  CoverBody,
  GrillBody,
  LockBody,
  VacuumBody,
} from './entity/koerper';
import { MediaButton, RadioPanel, ShuffleRepeat, SpotifyPanel } from './entity/medien';
import { makeStyles } from './entity/stil';
import {
  BigValue,
  Pill,
  clock,
  eventTime,
  format,
  integrationLabel,
  severityColor,
  sinceLabel,
} from './entity/teile';

interface Props {
  entity: Entity;
  width: number;
  onCommand: (command: string, data?: CommandData) => void;
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
  /** Steht die Kachel schon unter der Überschrift ihres Zimmers, ist der
   *  Raumname auf ihr eine Wiederholung. Dann tritt die Integration an
   *  seine Stelle – die sagt wenigstens etwas Neues. */
  imRaumblock?: boolean;
  /** Anpassen-Modus: Raum dieser Kachel setzen. */
  rooms?: string[];
  onSetRoom?: (room: string | null) => void;
  /** Gerät umbenennen – im Anpassen-Modus über den Stift, sonst über
   *  einen langen Druck auf die Kachel.
   *
   *  Gesetzt nur, wo es auch erlaubt ist: Der Name gilt fürs ganze Haus,
   *  der Hub verlangt dafür `edit_config`. Wer die Fähigkeit nicht hat,
   *  bekommt hier nichts – besser als ein Knopf, der ein «nicht erlaubt»
   *  einträgt. */
  onRename?: (name: string) => void;
  /** Anpassen-Modus: Gerät einer Gruppe zuordnen (oder lösen). */
  groups?: string[];
  onSetGroup?: (group: string | null) => void;
  /** Fragt die Türe vor dem Öffnen nach? Haushaltsweite Einstellung;
   *  fehlt sie, wird gefragt (siehe lib/tuerbestaetigung.ts). */
  doorConfirm?: boolean;
  /** Sensorkacheln lassen sich antippen und zeigen dann ihren Verlauf. */
  onPress?: () => void;
  /** Langes Drücken: Vorschau mit Verlauf – überall, nicht nur unter
   *  Geräte. «Warum ging das um drei Uhr an?» stellt sich dort, wo man
   *  die Kachel sieht. */
  onLongPress?: () => void;
  chart?: React.ReactNode;
  /** Kamerakacheln: URL des Schnappschuss-Endpunkts (inkl. Token). */
  snapshotUri?: string;
  /** Storen-Kacheln: aktuelle Wetterlage für den Himmel hinter dem Fenster. */
  sky?: Sky;
  /** Name der zusammengefassten Leuchte, in der dieses Licht aufgeht.
   *
   *  Unter Geräte ist ein solcher Spot sonst nicht von einer einzelnen
   *  Lampe zu unterscheiden – und man wundert sich, warum er im Raum
   *  fehlt und beim Schalten der Leuchte mitgeht. */
  partOf?: string | null;
  /** «in 2 Abläufen und 1 Szene» – antippbar, führt zu den Abläufen.
   *  Nur auf der Geräteseite gesetzt: Wer vor einer Lampe steht, die von
   *  selbst angeht, soll den Urheber finden, ohne alles durchzulesen. */
  usedIn?: string;
  onUsedIn?: () => void;
}

/** Warnstufen brauchen je nach Palette andere Farben. */
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
  imRaumblock,
  rooms,
  onSetRoom,
  onRename,
  groups,
  onSetGroup,
  doorConfirm,
  onPress,
  onLongPress,
  chart,
  snapshotUri,
  sky,
  partOf,
  usedIn,
  onUsedIn,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [remoteOpen, setRemoteOpen] = useState(false);
  // Was als Nächstes läuft – hinter Cover und Titel der Musikkachel.
  const [listeOffen, setListeOffen] = useState(false);
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [menueOffen, setMenueOffen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const isOn = entity.state.state === 'on';

  // Was ein langer Druck anbietet. Im Anpassen-Modus nichts: Dort hält
  // dieselbe Geste die Kachel zum Verschieben fest, und die Knöpfe für
  // Name, Raum und Gruppe stehen ohnehin offen auf der Kachel.
  const aktionen = editing
    ? []
    : kachelAktionen({ umbenennen: Boolean(onRename), verlauf: Boolean(onLongPress) });
  const fuehreAus = (eintrag: KachelEintrag) => {
    setMenueOffen(false);
    if (eintrag.id === 'umbenennen') setRenameOpen(true);
    if (eintrag.id === 'verlauf') onLongPress?.();
  };
  // Ein Eintrag braucht keine Auswahl - eine Liste mit einer Zeile wäre
  // ein Klick mehr für nichts. Für alle, die nicht umbenennen dürfen,
  // bleibt der lange Druck damit genau das, was er war.
  const langerDruck =
    aktionen.length === 0
      ? undefined
      : aktionen.length === 1
        ? () => fuehreAus(aktionen[0])
        : () => setMenueOffen(true);

  const subtitle =
    (imRaumblock ? undefined : entity.room) || integrationLabel(entity.integration);
  // Offline-Geräte: mit «zuletzt vor …», damit man sieht, ob das Gerät
  // gerade eben oder seit Tagen weg ist. Bei einer Store am Funk steht
  // dort zusätzlich, dass Drücken trotzdem etwas bewirkt - siehe
  // lib/funkstille.ts.
  const offlineText = offlineSatz(
    entity,
    entity.last_seen ? sinceLabel(entity.last_seen) : null
  );
  const toggle = entity.commands.includes('toggle') ? () => onCommand('toggle') : undefined;

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
      case 'light': {
        // Die Farbreihe steht auch bei ausgeschaltetem Licht da: Ein Tipp
        // darauf schaltet ein und stellt die Farbe in einem Zug – so
        // gedacht ist es beim Sternenprojektor am Abend.
        const farben = entity.commands.includes('set_color') ? (
          <ColorRow entity={entity} onCommand={onCommand} />
        ) : null;
        return entity.commands.includes('set_brightness') ? (
          <View style={styles.stack}>
            <Bar
              value={isOn ? (entity.state.brightness ?? 100) : 0}
              onChange={(value) => onCommand('set_brightness', { brightness: value })}
            />
            <Text style={styles.hint}>
              {isOn ? `${Math.round(entity.state.brightness ?? 100)} % Helligkeit` : 'Aus'}
            </Text>
            {farben}
          </View>
        ) : farben ? (
          <View style={styles.stack}>
            <BigValue value={isOn ? 'An' : 'Aus'} on={isOn} />
            {farben}
          </View>
        ) : (
          <BigValue value={isOn ? 'An' : 'Aus'} on={isOn} />
        );
      }

      case 'switch':
        return <BigValue value={isOn ? 'An' : 'Aus'} on={isOn} note={powerNote()} />;

      // Der Einschlaf-Timer des Fernsehers als eigene Kachel: dieselbe
      // Bedienung wie in der Fernsehkachel, nur ohne den Fernseher drum
      // herum. Der Hub spiegelt den Timer auf beide.
      case 'timer':
        return <TvSleep entity={entity} onCommand={onCommand} />;

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
            {/* Cover und Titel öffnen, was als Nächstes kommt – wie in
                der grossen Karte in der Seitenspalte. */}
            <Pressable
              onPress={
                hatWarteschlange(entity.state) ? () => setListeOffen(true) : undefined
              }
              accessibilityRole={hatWarteschlange(entity.state) ? 'button' : undefined}
              accessibilityLabel={
                hatWarteschlange(entity.state) ? 'Was als Nächstes läuft' : undefined
              }
              style={({ pressed }) => [styles.nowPlayingRow, pressed && { opacity: 0.75 }]}
            >
              {entity.state.image ? (
                <Image
                  source={{ uri: String(entity.state.image) }}
                  style={styles.coverArt}
                  accessibilityIgnoresInvertColors
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.value} numberOfLines={2}>
                  {entity.state.track ?? 'Nichts läuft'}
                </Text>
                {entity.state.artist ? (
                  <Text style={styles.hint} numberOfLines={1}>
                    {entity.state.artist}
                    {entity.state.device ? ` · ${entity.state.device}` : ''}
                  </Text>
                ) : null}
              </View>
              {hatWarteschlange(entity.state) ? (
                <Ionicons name="list-outline" size={16} color={colors.inkFaint} />
              ) : null}
            </Pressable>
            <Musikliste
              state={entity.state}
              offen={listeOffen}
              onClose={() => setListeOffen(false)}
              onPlay={
                entity.commands.includes('play_queue')
                  ? (uri) => onCommand('play_queue', { uri })
                  : undefined
              }
            />
            {entity.commands.includes('next') ? (
              <View style={styles.mediaRow}>
                <MediaButton
                  icon="play-skip-back"
                  label="Zurück"
                  onPress={() => onCommand('previous')}
                />
                <MediaButton
                  icon={playing ? 'pause' : 'play'}
                  label={playing ? 'Pause' : 'Abspielen'}
                  onPress={() => onCommand(playing ? 'pause' : 'play')}
                />
                <MediaButton
                  icon="play-skip-forward"
                  label="Weiter"
                  onPress={() => onCommand('next')}
                />
                {hasRemote ? (
                  <MediaButton
                    icon="game-controller-outline"
                    label="Fernbedienung"
                    onPress={() => setRemoteOpen(true)}
                  />
                ) : null}
              </View>
            ) : null}
            <ShuffleRepeat entity={entity} onCommand={onCommand} />
            {/* Vor der Fernbedienung: «Zattoo oder Plex» ist die Frage,
                die man einer Fernsehkachel stellt - das Steuerkreuz
                braucht man erst danach. */}
            {entity.commands.includes('launch_app') ? (
              <TvApps entity={entity} onCommand={onCommand} />
            ) : null}
            {entity.commands.includes('sleep_timer') ? (
              <TvSleep entity={entity} onCommand={onCommand} />
            ) : null}
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
                  accessibilityLabel="Stumm schalten"
                >
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
                    value={
                      typeof entity.state.volume === 'number' ? entity.state.volume : 0
                    }
                    onChange={(value) => onCommand('set_volume', { volume: value })}
                  />
                </View>
                <Ionicons name="volume-high" size={20} color={colors.inkSoft} />
              </View>
            ) : null}
            {entity.commands.includes('play_playlist') ? (
              <SpotifyPanel entity={entity} onCommand={onCommand} />
            ) : null}
            {entity.commands.includes('play_radio') ? (
              <RadioPanel entity={entity} onCommand={onCommand} />
            ) : null}
            {/* Die schlichte Boxenzeile nur, wo keines der beiden Panels
                steht – die bringen ihre eigene mit, und zwei Reihen
                derselben Boxen untereinander sind eine zu viel. */}
            {!entity.commands.includes('play_playlist') &&
            !entity.commands.includes('play_radio') &&
            entity.commands.includes('play_on') &&
            Array.isArray(entity.state.devices) &&
            entity.state.devices.length > 0 ? (
              <View style={styles.deviceRow}>
                {entity.state.devices.map((name: string) => {
                  const active = name === entity.state.device;
                  return (
                    <Pressable
                      key={name}
                      onPress={() =>
                        active ? undefined : onCommand('play_on', { device: name })
                      }
                      style={[styles.deviceChip, active && styles.deviceChipActive]}
                    >
                      <Ionicons
                        name={active ? 'volume-high' : 'volume-medium-outline'}
                        size={12}
                        color={active ? '#FFFFFF' : colors.inkSoft}
                      />
                      <Text
                        style={[
                          styles.deviceChipText,
                          active && styles.deviceChipTextActive,
                        ]}
                        numberOfLines={1}
                      >
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
                // Web kennt stopPropagation, nativ nicht - deshalb offen
                // getippt und optional aufgerufen.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                <Text style={[styles.privacyText, privacyOn && { color: '#FFFFFF' }]}>
                  {privacyOn ? 'Privatsphäre beenden' : 'Privatsphäre'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      }

      case 'vacuum': {
        const cleaning = entity.state.state === 'cleaning';
        const rooms: { id: number; name: string; box?: number[] }[] = Array.isArray(
          entity.state.rooms
        )
          ? entity.state.rooms
          : [];
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
        return (
          <LockBody
            entity={entity}
            onCommand={onCommand}
            pending={pending}
            doorConfirm={doorConfirm}
          />
        );

      case 'cover':
        return <CoverBody entity={entity} sky={sky} onCommand={onCommand} />;

      case 'calendar': {
        const events: KalenderEintrag[] = entity.state.events ?? [];
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
        // Der Grill ist zwar auch ein Gerät, aber beim Grillen zählt etwas
        // anderes als bei der Spülmaschine: Temperatur, Fühler, Pellets.
        if (entity.integration === 'pitboss') {
          return <GrillBody entity={entity} onCommand={onCommand} />;
        }
        {
          const laeuft = entity.state.state === 'running';
          return (
            <View style={styles.stack}>
              <Pill
                label={zustandsText(entity.state.state)}
                tone={laeuft ? colors.accent : undefined}
              />
              {/* Programm und Restzeit gehören zu einer laufenden
                  Maschine. Eine stillstehende meldet je nach Firmware
                  weiter irgendetwas, und das stand dann unter «Bereit»
                  wie ein Programm, das keines ist. Dieselbe Regel gilt
                  auf der Startseite (lib/haushalt). */}
              {laeuft && entity.state.program ? (
                <Text style={styles.detail}>
                  {entity.state.program}
                  {entity.state.program_end ? ` · noch ${entity.state.program_end}` : ''}
                </Text>
              ) : null}
            </View>
          );
        }

      case 'alert': {
        const count = entity.state.count ?? 0;
        const severity = entity.state.max_severity;
        const alerts: Record<string, string | undefined>[] = entity.state.alerts ?? [];
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

      case 'scene': {
        // Eine Lichtszene hat nichts zum Ablesen und nichts zum Stellen –
        // sie hat einen Knopf. Ob sie gerade gilt, weiss die Bridge: Sie
        // meldet «inactive», sobald jemand eine der Lampen von Hand
        // verstellt hat. Deshalb steht «gilt gerade» und nicht «zuletzt
        // gedrückt» – Letzteres wäre nach einer Handbewegung eine Lüge.
        const gilt = entity.state.state === 'active';
        return (
          <View style={styles.stack}>
            <Pill
              label={gilt ? 'Gilt gerade' : 'Bereit'}
              tone={gilt ? colors.on : undefined}
            />
            <Pressable
              onPress={() => onCommand('activate')}
              accessibilityRole="button"
              accessibilityLabel={`Szene ${entity.name} aufrufen`}
              style={({ pressed }) => [styles.sceneButton, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="color-palette-outline" size={16} color="#FFFFFF" />
              <Text style={styles.sceneButtonText}>Aufrufen</Text>
            </Pressable>
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
      // Eine offene Türe ist keine Nebensache: Die Kachel färbt sich, statt
      // es nur danebenzuschreiben. Beim Aufsperren dreht das Schloss noch
      // (unlocking) - erst wenn es wirklich offen ist, färbt es sich.
      tint={
        entity.kind === 'lock' &&
        ['unlocked', 'unlatched'].includes(String(entity.state.state))
          ? colors.dangerSoft
          : undefined
      }
      dimmed={!entity.available || (hidden && !editing)}
      onPress={onPress}
      onLongPress={langerDruck}
    >
      {editing ? (
        // Chips und Knöpfe stehen in zwei umbrechenden Zeilen: auf einer
        // halbbreiten Telefonkachel passt sonst nicht alles nebeneinander
        // und die hinteren Symbole ragen aus der Kachel heraus.
        <View style={styles.editBox}>
          {partOf ? (
            <View style={styles.partOfRow}>
              <Ionicons name="git-merge-outline" size={12} color={colors.inkFaint} />
              <Text style={styles.partOfText} numberOfLines={1}>
                gehört zu «{partOf}»
              </Text>
            </View>
          ) : null}

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
                caption="Name"
                onPress={() => setRenameOpen(true)}
              />
            ) : null}
            <EditButton
              icon={favorite ? 'star' : 'star-outline'}
              active={!!favorite}
              label={favorite ? 'Favorit entfernen' : 'Als Favorit'}
              caption="Favorit"
              onPress={onToggleFavorite}
            />
            <EditButton
              icon={hidden ? 'eye-off' : 'eye-outline'}
              active={!!hidden}
              label={hidden ? 'Wieder einblenden' : 'Ausblenden'}
              caption={hidden ? 'Versteckt' : 'Ausblenden'}
              onPress={onToggleHidden}
            />
            {onToggleLocked ? (
              <EditButton
                icon={locked ? 'lock-closed' : 'lock-open-outline'}
                active={!!locked}
                label={locked ? 'Sperre aufheben' : 'Sperren – schaltet nur nach Rückfrage'}
                // «Rückfrage» statt «Sperren»: Das Wort sagt, was passiert.
                // Gesperrt klingt nach «geht nicht mehr» – es geht weiter,
                // nur mit einem Ja dazwischen.
                caption="Rückfrage"
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
      {aktionen.length > 1 ? (
        <KachelMenue
          visible={menueOffen}
          titel={entity.name}
          eintraege={aktionen}
          onClose={() => setMenueOffen(false)}
          onSelect={fuehreAus}
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
      {/* Solange der Befehl unterwegs ist, sitzt die Kachel noch auf dem
          alten Stand – die Schieber und Pfeile darin zeigen also etwas,
          das gleich nicht mehr stimmt. Blass gestellt sagt das jeder
          Kachelart auf einmal, ohne dass jede es einzeln wissen muss. */}
      <View style={[styles.body, pending && { opacity: 0.55 }]}>{body()}</View>
      {chart}
      <CardFooter
        title={entity.name}
        subtitle={pending ? 'wird geschaltet …' : entity.available ? subtitle : offlineText}
        on={isOn}
        onToggle={toggle}
        pending={pending}
      />
      {usedIn ? (
        <Pressable
          onPress={onUsedIn}
          accessibilityRole="button"
          accessibilityLabel={`${entity.name}: ${usedIn} – Abläufe öffnen`}
          hitSlop={6}
          style={styles.partOfRow}
        >
          <Ionicons name="git-branch-outline" size={12} color={colors.inkFaint} />
          <Text style={styles.partOfText}>{usedIn}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** Raumauswahl im Anpassen-Modus: „Kein Raum“ plus alle bekannten Räume. */

// Weiterhin von hier beziehbar - SidePanel u.a. importieren sie so.
export { RadioPanel, ShuffleRepeat, SpotifyPanel } from './entity/medien';
