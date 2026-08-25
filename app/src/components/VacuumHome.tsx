import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CommandData, Entity } from '../api/types';
import {
  Box,
  VacuumRoom,
  contentBox,
  inCrop,
  padBox,
  robotRoom,
  roomAt,
  shapeInCrop,
  vacuumText,
} from '../lib/saugerkarte';
import { Colors, radius, type, useColors } from '../theme';

/** Ein Verschleissteil des Saugers, wie der Hub es meldet. */
interface WartungsTeil {
  part?: string;
  label?: string;
  percent_left?: number;
  used_hours?: number;
  life_hours?: number;
}

/**
 * Saugerkarte für die Startseite.
 *
 * Die rohe Karte des Saugers ist ein Bild mit viel leerem Rand – klein
 * dargestellt bleibt davon ein blaues Rechteck mit Briefmarke drin. Deshalb
 * wird hier auf den tatsächlichen Wohnungsumriss zugeschnitten (die
 * Raum-Bereiche kennen wir ja), und während der Reinigung zoomt die Karte
 * auf das Zimmer, in dem der Sauger gerade steht – seine Position kommt
 * vom Hub als Bild-Anteil mit.
 *
 * Antippen öffnet den Reinigungs-Dialog: komplette Reinigung, einzelne
 * Zimmer (auch mehrere) oder eine frei aufgezogene Zone.
 */

// Das Rechnen wohnt in src/lib/saugerkarte.ts – dort ist es prüfbar.
// Re-exportiert, weil andere Stellen VacuumRoom von hier importieren.
export type { VacuumRoom } from '../lib/saugerkarte';
export { contentBox, padBox, roomAt, robotRoom, vacuumText } from '../lib/saugerkarte';

/**
 * Ein ausgewähltes Zimmer, seiner tatsächlichen Form nach.
 *
 * Bisher lag über der Auswahl ein weisses Rechteck – die Hülle des
 * Zimmers. Bei einer diagonal geschnittenen Wohnung deckt die halbe
 * Nachbarräume mit ab, und man wählt scheinbar den halben Flur mit aus.
 *
 * Der Hub liefert die Form als Liste von Rechtecken; hier wird jedes zu
 * einer View. Ein Zimmer sind ein paar Dutzend davon - günstiger als
 * SVG und ohne dessen Rundungsfehler an den Kanten.
 *
 * Das Übermass (`SAUM`) schliesst die Haarlinien, die zwischen zwei
 * prozentual positionierten Nachbarn sonst durchscheinen. Die Rechtecke
 * überlappen sich dadurch minimal – bei einer durchscheinenden Füllung
 * sieht man das nicht, weil sie in *einer* Ebene liegen.
 */
const SAUM = 0.004;

function RoomShape({
  shape,
  crop,
  farbe,
}: {
  shape: number[][] | undefined;
  crop: Box;
  farbe: string;
}) {
  const teile = shapeInCrop(shape, crop);
  if (teile.length === 0) return null;
  return (
    <>
      {teile.map(([x, y, w, h], index) => (
        <View
          key={index}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${(w + SAUM) * 100}%`,
            height: `${(h + SAUM) * 100}%`,
            backgroundColor: farbe,
          }}
        />
      ))}
    </>
  );
}

/**
 * Kartenbild, zugeschnitten auf einen Ausschnitt.
 *
 * Der Trick: Das Bild wird grösser als sein Rahmen gerendert und so
 * verschoben, dass genau der Ausschnitt sichtbar ist. Der Rahmen bekommt
 * das Seitenverhältnis des Ausschnitts – dann verzerrt «stretch» nichts.
 */
function CroppedMap({
  uri,
  crop,
  mapSize,
  onPressPoint,
  children,
}: {
  uri: string;
  crop: Box;
  mapSize?: { width: number; height: number };
  /** Tippt jemand auf die Karte: Punkt als Anteile des GANZEN Bilds. */
  onPressPoint?: (x: number, y: number) => void;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const frame = React.useRef<View>(null);
  // Bis das Bild da ist, schwebten die Zimmernamen auf leerem Grund - das
  // sieht nach einer kaputten Karte aus, nicht nach einer ladenden. Der
  // Hub muss die Karte beim Sauger holen und zeichnen; das dauert beim
  // ersten Mal spürbar.
  const [geladen, setGeladen] = useState(false);
  const cropWidth = crop[2] - crop[0];
  const cropHeight = crop[3] - crop[1];
  const source = mapSize && mapSize.height > 0 ? mapSize.width / mapSize.height : 4 / 3;
  const aspect = (cropWidth * source) / cropHeight || 4 / 3;

  return (
    <Pressable
      // Der View-Ref hat measureInWindow, aber die Pressable-Typen wissen
      // das nicht - Plattform-Messung bleibt eine getypte Lücke.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={frame as any}
      onPress={(event) => {
        if (!onPressPoint) return;
        // Bildschirm-Koordinaten gegen die gemessene Lage des Rahmens –
        // locationX/offsetX wären je nach Plattform relativ zum getroffenen
        // Kind (etwa dem vergrösserten Kartenbild) und zeigten dann auf das
        // falsche Zimmer.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const native: any = event.nativeEvent;
        const pageX = native.pageX ?? native.changedTouches?.[0]?.pageX;
        const pageY = native.pageY ?? native.changedTouches?.[0]?.pageY;
        if (typeof pageX !== 'number' || typeof pageY !== 'number') return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (frame.current as any)?.measureInWindow?.(
          (x: number, y: number, width: number, height: number) => {
            if (width <= 0 || height <= 0) return;
            onPressPoint(
              crop[0] + ((pageX - x) / width) * cropWidth,
              crop[1] + ((pageY - y) / height) * cropHeight
            );
          }
        );
      }}
      style={{
        width: '100%',
        aspectRatio: aspect,
        borderRadius: radius.control,
        overflow: 'hidden',
        backgroundColor: colors.surfaceSoft,
      }}
    >
      <Image
        source={{ uri }}
        resizeMode="stretch"
        onLoad={() => setGeladen(true)}
        // Auch ein Fehlschlag beendet das Warten: Lieber die Namen ohne
        // Bild als ein Rad, das sich für immer dreht.
        onError={() => setGeladen(true)}
        style={{
          position: 'absolute',
          left: `${(-crop[0] / cropWidth) * 100}%`,
          top: `${(-crop[1] / cropHeight) * 100}%`,
          width: `${100 / cropWidth}%`,
          height: `${100 / cropHeight}%`,
        }}
      />
      {children}
      {geladen ? null : (
        <View pointerEvents="none" style={ladeStil.mitte}>
          <ActivityIndicator color={colors.inkSoft} />
          <Text style={[ladeStil.text, { color: colors.inkSoft }]}>Karte wird geladen …</Text>
        </View>
      )}
    </Pressable>
  );
}

const ladeStil = StyleSheet.create({
  mitte: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: { fontSize: 13 },
});

/** Punkt-Markierung des Saugers – auffälliger als das winzige Symbol, das
 *  der Karten-Renderer selbst zeichnet. */
function RobotDot({ robot, crop }: { robot: number[]; crop: Box }) {
  const colors = useColors();
  const spot = inCrop([robot[0], robot[1], robot[0], robot[1]], crop);
  if (!spot) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: `${spot[0] * 100}%`,
        top: `${spot[1] * 100}%`,
        marginLeft: -7,
        marginTop: -7,
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: colors.accent,
        borderWidth: 2.5,
        borderColor: '#FFFFFF',
      }}
    />
  );
}

type CleanMode = 'full' | 'rooms' | 'zone';

export function VacuumHome({
  entity,
  uri,
  now,
  onCommand,
}: {
  entity: Entity;
  uri?: string;
  now: Date;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rooms: VacuumRoom[] = Array.isArray(entity.state.rooms) ? entity.state.rooms : [];
  const mapSize = entity.state.map as { width: number; height: number } | undefined;
  const robot = Array.isArray(entity.state.robot) ? (entity.state.robot as number[]) : undefined;
  const cleaning = entity.state.state === 'cleaning';
  const [dialog, setDialog] = useState<{ mode: CleanMode; preselect?: number } | null>(null);
  const [stationOpen, setStationOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const maintenance: WartungsTeil[] = Array.isArray(entity.state.maintenance)
    ? entity.state.maintenance
    : [];

  // Beim Reinigen jede Minute ein frisches Bild, sonst hielte der Cache den
  // Sauger auf der Karte fest, während er längst im nächsten Zimmer ist.
  const separator = uri?.includes('?') ? '&' : '?';
  const liveUri = uri
    ? `${uri}${separator}t=${cleaning ? Math.floor(now.getTime() / 60_000) : 'still'}`
    : undefined;

  const content = contentBox(rooms);
  const currentRoom = robotRoom(rooms, robot);
  // Beim Reinigen näher heran: Das Zimmer, in dem der Sauger steht, füllt
  // die Karte – so sieht man auf einen Blick, wo er gerade ist.
  const crop: Box | null =
    cleaning && currentRoom?.box
      ? padBox(currentRoom.box as Box, 0.05)
      : content;

  const openDialog = (preselect?: number) =>
    setDialog({ mode: preselect != null ? 'rooms' : 'full', preselect });

  return (
    <View style={styles.stack}>
      <View style={styles.headRow}>
        <Text style={[styles.state, cleaning && { color: colors.accent }]}>
          {vacuumText(entity)}
          {cleaning && currentRoom ? ` · ${currentRoom.name}` : ''}
        </Text>
        {entity.commands.includes('dock') ? (
          <Pressable
            onPress={() => setStationOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Ladestation"
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="battery-charging-outline" size={16} color={colors.ink} />
          </Pressable>
        ) : null}
        {maintenance.length > 0 ? (
          <Pressable
            onPress={() => setCareOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Wartung"
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="construct-outline" size={16} color={colors.ink} />
          </Pressable>
        ) : null}
        {entity.commands.includes('start') ? (
          <Pressable
            onPress={() =>
              cleaning ? onCommand(entity.id, 'dock') : setDialog({ mode: 'full' })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.75 }]}
          >
            <Ionicons
              name={cleaning ? 'home-outline' : 'play-outline'}
              size={14}
              color={colors.ink}
            />
            <Text style={styles.actionText}>{cleaning ? 'Zur Station' : 'Reinigen'}</Text>
          </Pressable>
        ) : null}
      </View>

      {liveUri && crop ? (
        <>
          <CroppedMap
            uri={liveUri}
            crop={crop}
            mapSize={mapSize}
            onPressPoint={(x, y) => openDialog(roomAt(rooms, x, y)?.id)}
          >
            {rooms.map((room) => {
              if (!Array.isArray(room.box)) return null;
              const area = inCrop(room.box, crop);
              if (!area) return null;
              return (
                <View
                  key={room.id}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: `${area[0] * 100}%`,
                    top: `${area[1] * 100}%`,
                    width: `${(area[2] - area[0]) * 100}%`,
                    height: `${(area[3] - area[1]) * 100}%`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text numberOfLines={1} style={styles.roomLabel}>
                    {room.name}
                  </Text>
                </View>
              );
            })}
            {robot ? <RobotDot robot={robot} crop={crop} /> : null}
          </CroppedMap>
          <Text style={styles.hint}>
            Karte antippen für Zimmer-, Zonen- oder komplette Reinigung
          </Text>
        </>
      ) : liveUri ? (
        // Karte ohne Raum-Bereiche: unbeschnitten zeigen, Dialog gibt es trotzdem.
        <Pressable onPress={() => openDialog()}>
          <Image
            source={{ uri: liveUri }}
            resizeMode="contain"
            style={styles.plainMap}
          />
        </Pressable>
      ) : null}

      <StationDialog
        visible={stationOpen}
        entity={entity}
        onClose={() => setStationOpen(false)}
        onCommand={onCommand}
      />
      <CareDialog
        visible={careOpen}
        entity={entity}
        maintenance={maintenance}
        onClose={() => setCareOpen(false)}
        onCommand={onCommand}
      />
      <CleanDialog
        visible={dialog != null}
        initialMode={dialog?.mode ?? 'full'}
        preselect={dialog?.preselect}
        entity={entity}
        uri={liveUri}
        rooms={rooms}
        mapSize={mapSize}
        robot={robot}
        onClose={() => setDialog(null)}
        onCommand={onCommand}
      />
    </View>
  );
}

/** Der Reinigungs-Dialog: Art wählen, dann Räume antippen oder eine Zone
 *  mit zwei Fingertipps aufziehen. */
function CleanDialog({
  visible,
  initialMode,
  preselect,
  entity,
  uri,
  rooms,
  mapSize,
  robot,
  onClose,
  onCommand,
}: {
  visible: boolean;
  initialMode: CleanMode;
  preselect?: number;
  entity: Entity;
  uri?: string;
  rooms: VacuumRoom[];
  mapSize?: { width: number; height: number };
  robot?: number[];
  onClose: () => void;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState<CleanMode>(initialMode);
  const [selected, setSelected] = useState<number[]>([]);
  // Zone: erst eine Ecke, dann die zweite; ein dritter Tipp beginnt neu.
  const [corners, setCorners] = useState<[number, number][]>([]);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setSelected(preselect != null ? [preselect] : []);
      setCorners([]);
    }
  }, [visible, initialMode, preselect]);

  const crop = contentBox(rooms);
  const mappable = uri != null && crop != null;
  const canZone = mappable && entity.commands.includes('clean_zone');
  const modes: { key: CleanMode; label: string }[] = [
    { key: 'full', label: 'Komplett' },
    ...(rooms.length > 0 ? [{ key: 'rooms' as const, label: 'Zimmer' }] : []),
    ...(canZone ? [{ key: 'zone' as const, label: 'Zone' }] : []),
  ];

  const toggleRoom = (id: number) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );

  const zoneBox: Box | null =
    corners.length === 2
      ? [
          Math.min(corners[0][0], corners[1][0]),
          Math.min(corners[0][1], corners[1][1]),
          Math.max(corners[0][0], corners[1][0]),
          Math.max(corners[0][1], corners[1][1]),
        ]
      : null;

  const ready =
    mode === 'full' || (mode === 'rooms' ? selected.length > 0 : zoneBox != null);

  const start = () => {
    if (mode === 'full') onCommand(entity.id, 'start');
    else if (mode === 'rooms') onCommand(entity.id, 'clean_rooms', { rooms: selected });
    else if (zoneBox) onCommand(entity.id, 'clean_zone', { zone: zoneBox });
    onClose();
  };

  const startLabel =
    mode === 'full'
      ? 'Komplette Reinigung starten'
      : mode === 'rooms'
        ? selected.length === 1
          ? '1 Zimmer saugen'
          : `${selected.length} Zimmer saugen`
        : 'Zone saugen';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>{entity.name}</Text>

          <View style={styles.modeRow}>
            {modes.map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => setMode(key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === key }}
                style={[styles.modeChip, mode === key && styles.modeChipActive]}
              >
                <Text style={[styles.modeText, mode === key && styles.modeTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {mappable && crop ? (
            <CroppedMap
              uri={uri!}
              crop={crop}
              mapSize={mapSize}
              onPressPoint={
                mode === 'zone'
                  ? (x, y) =>
                      setCorners((current) =>
                        current.length >= 2 ? [[x, y]] : [...current, [x, y]]
                      )
                  : mode === 'rooms'
                    ? (x, y) => {
                        const hit = roomAt(rooms, x, y);
                        if (hit) toggleRoom(hit.id);
                      }
                    : undefined
              }
            >
              {/* Erst die Flächen, dann die Namen: Sonst deckt die
                  Hervorhebung des einen Zimmers die Beschriftung des
                  Nachbarn zu. */}
              {rooms.map((room) => {
                const active = mode === 'rooms' && selected.includes(room.id);
                if (!active) return null;
                return (
                  <RoomShape
                    key={`form-${room.id}`}
                    shape={room.shape}
                    crop={crop}
                    farbe="rgba(47,107,246,0.55)"
                  />
                );
              })}
              {rooms.map((room) => {
                if (!Array.isArray(room.box)) return null;
                const area = inCrop(room.box, crop);
                if (!area) return null;
                const active = mode === 'rooms' && selected.includes(room.id);
                // Ohne Form bleibt es beim Rahmen um die Hülle – besser
                // ungenau als unsichtbar.
                const rahmen = active && !Array.isArray(room.shape);
                return (
                  <View
                    key={room.id}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: `${area[0] * 100}%`,
                      top: `${area[1] * 100}%`,
                      width: `${(area[2] - area[0]) * 100}%`,
                      height: `${(area[3] - area[1]) * 100}%`,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: rahmen ? 2 : 0,
                      borderColor: '#FFFFFF',
                      borderRadius: 6,
                      backgroundColor: rahmen ? 'rgba(47,107,246,0.45)' : 'transparent',
                    }}
                  >
                    <Text numberOfLines={1} style={styles.roomLabel}>
                      {room.name}
                    </Text>
                  </View>
                );
              })}
              {mode === 'zone'
                ? corners.map(([x, y], index) => {
                    const spot = inCrop([x, y, x, y], crop);
                    if (!spot) return null;
                    return (
                      <View
                        key={index}
                        pointerEvents="none"
                        style={[
                          styles.corner,
                          { left: `${spot[0] * 100}%`, top: `${spot[1] * 100}%` },
                        ]}
                      />
                    );
                  })
                : null}
              {mode === 'zone' && zoneBox
                ? (() => {
                    const area = inCrop(zoneBox, crop);
                    if (!area) return null;
                    return (
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          left: `${area[0] * 100}%`,
                          top: `${area[1] * 100}%`,
                          width: `${(area[2] - area[0]) * 100}%`,
                          height: `${(area[3] - area[1]) * 100}%`,
                          borderWidth: 2,
                          borderColor: colors.accent,
                          backgroundColor: 'rgba(47,107,246,0.25)',
                          borderRadius: 4,
                        }}
                      />
                    );
                  })()
                : null}
              {robot ? <RobotDot robot={robot} crop={crop} /> : null}
            </CroppedMap>
          ) : mode === 'rooms' ? (
            // Ohne Karte: Räume als Chips – auswählen geht trotzdem.
            <View style={styles.chipRow}>
              {rooms.map((room) => {
                const active = selected.includes(room.id);
                return (
                  <Pressable
                    key={room.id}
                    onPress={() => toggleRoom(room.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    style={[styles.modeChip, active && styles.modeChipActive]}
                  >
                    <Text style={[styles.modeText, active && styles.modeTextActive]}>
                      {room.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.dialogHint}>
            {mode === 'full'
              ? 'Der Sauger reinigt die ganze Wohnung und kehrt danach zur Station zurück.'
              : mode === 'rooms'
                ? 'Zimmer antippen – auch mehrere. Noch einmal tippen wählt ab.'
                : corners.length === 0
                  ? 'Erste Ecke der Zone auf der Karte antippen.'
                  : corners.length === 1
                    ? 'Zweite Ecke antippen – die Zone spannt sich dazwischen auf.'
                    : 'Zone steht. Ein weiterer Tipp beginnt eine neue.'}
          </Text>

          <View style={styles.dialogActions}>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={ready ? start : undefined}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              style={[styles.confirm, !ready && { opacity: 0.4 }]}
            >
              <Ionicons name="play" size={14} color="#FFFFFF" />
              <Text style={styles.confirmText}>{startLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


/** Übersetzungen für die Stations-Angaben – Unbekanntes erscheint roh,
 *  besser als gar nicht. */
const DOCK_LABELS: Record<string, string> = {
  error: 'Störung',
  type: 'Stationstyp',
  wash_phase: 'Waschgang',
  drying: 'Trocknung',
  dust_collection: 'Staubentleerung',
  auto_empty: 'Automatische Entleerung',
};

const DOCK_VALUE_LABELS: Record<string, string> = {
  empty_wash_fill_dry_dock: 'Absaugen, Waschen, Trocknen',
  auto_empty_dock: 'Absaug-Station',
  wash_fill_dock: 'Waschstation',
  no_dock: 'Einfache Ladestation',
};

/** Ladestation: was sie meldet, und was sie auf Zuruf tut. */
function StationDialog({
  visible,
  entity,
  onClose,
  onCommand,
}: {
  visible: boolean;
  entity: Entity;
  onClose: () => void;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dock = (entity.state.dock ?? {}) as Record<string, unknown>;
  const run = (command: string) => {
    onCommand(entity.id, command);
    onClose();
  };
  const alle: { command: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { command: 'dock', label: 'Zur Station fahren', icon: 'home-outline' },
    { command: 'collect_dust', label: 'Staub absaugen', icon: 'trash-outline' },
    { command: 'wash_mop', label: 'Mopp waschen', icon: 'water-outline' },
    { command: 'stop_wash', label: 'Waschen stoppen', icon: 'stop-circle-outline' },
    { command: 'locate', label: 'Sauger finden', icon: 'search-outline' },
  ];
  const actions = alle.filter((action) => entity.commands.includes(action.command));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Ladestation</Text>
          <View style={{ gap: 6 }}>
            {entity.state.battery != null ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Akku</Text>
                <Text style={styles.infoValue}>{entity.state.battery} %</Text>
              </View>
            ) : null}
            {Object.entries(dock).map(([key, value]) => (
              <View key={key} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{DOCK_LABELS[key] ?? key}</Text>
                <Text
                  style={[styles.infoValue, key === 'error' && { color: colors.danger }]}
                  numberOfLines={1}
                >
                  {DOCK_VALUE_LABELS[String(value)] ?? String(value)}
                </Text>
              </View>
            ))}
            {Object.keys(dock).length === 0 ? (
              <Text style={styles.dialogHint}>
                Die Station meldet gerade keine weiteren Angaben.
              </Text>
            ) : null}
          </View>
          <View style={{ gap: 8 }}>
            {actions.map((action) => (
              <Pressable
                key={action.command}
                onPress={() => run(action.command)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.listButton, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={action.icon} size={16} color={colors.ink} />
                <Text style={styles.listButtonText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Schliessen</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Wartung: Verschleissteile mit Rest-Lebensdauer, je mit Zurücksetzen
 *  nach dem Tausch (zweiter Tipp bestätigt). */
function CareDialog({
  visible,
  entity,
  maintenance,
  onClose,
  onCommand,
}: {
  visible: boolean;
  entity: Entity;
  maintenance: WartungsTeil[];
  onClose: () => void;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) setConfirm(null);
  }, [visible]);
  const canReset = entity.commands.includes('reset_consumable');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Wartung</Text>
          {maintenance.map((part) => {
            const percent = Number(part.percent_left ?? 0);
            const tone =
              percent <= 10 ? colors.danger : percent <= 30 ? colors.warn : colors.on;
            return (
              <View key={String(part.part)} style={{ gap: 6 }}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{part.label ?? part.part}</Text>
                  <Text style={[styles.infoValue, { color: tone }]}>
                    {percent} % übrig
                  </Text>
                </View>
                <View style={styles.careTrack}>
                  <View
                    style={[
                      styles.careFill,
                      { width: `${Math.max(2, percent)}%`, backgroundColor: tone },
                    ]}
                  />
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.dialogHint}>
                    ~{part.used_hours ?? '?'} von {part.life_hours ?? '?'} h im Einsatz
                  </Text>
                  {canReset ? (
                    <Pressable
                      onPress={() => {
                        if (confirm === part.part) {
                          onCommand(entity.id, 'reset_consumable', { part: part.part });
                          setConfirm(null);
                        } else {
                          setConfirm(String(part.part));
                        }
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.resetButton,
                        confirm === part.part && { borderColor: colors.danger },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.resetText,
                          confirm === part.part && { color: colors.danger },
                        ]}
                      >
                        {confirm === part.part ? 'Wirklich zurücksetzen?' : 'Zurücksetzen'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          <Text style={styles.dialogHint}>
            Zurücksetzen nach dem Tausch bzw. der Reinigung des Teils – der
            Zähler beginnt dann wieder bei 100 %.
          </Text>
          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Schliessen</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: 10 },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    state: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    actionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    iconButton: {
      width: 34,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    infoLabel: { color: colors.inkSoft, fontSize: 14 },
    infoValue: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    listButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    listButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    careTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceSoft,
      overflow: 'hidden',
    },
    careFill: { height: '100%', borderRadius: 3 },
    resetButton: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    resetText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    hint: { color: colors.inkFaint, fontSize: 12 },
    plainMap: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.control },
    roomLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.55)',
      textShadowRadius: 3,
      maxWidth: '95%',
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 560,
      gap: 12,
      padding: 18,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    sheetTitle: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    modeRow: { flexDirection: 'row', gap: 8 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    modeChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    modeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    modeText: { color: colors.inkSoft, fontSize: 14, fontWeight: '600' },
    modeTextActive: { color: '#FFFFFF' },
    corner: {
      position: 'absolute',
      marginLeft: -6,
      marginTop: -6,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    dialogHint: { color: colors.inkFaint, fontSize: 13, lineHeight: 19 },
    dialogActions: { flexDirection: 'row', gap: 10 },
    cancel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    cancelText: { color: colors.inkSoft, fontSize: 15, fontWeight: '700' },
    confirm: {
      flex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
