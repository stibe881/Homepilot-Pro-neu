import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, Scene } from '../api/types';
import { Colors, radius, useColors } from '../theme';
import { Card } from './Card';
import { raumSymbol, raumZeile, wichtigeZuerst } from '../lib/raum';
import { zustandsText } from '../lib/haushalt';

/**
 * Raum-Kachel für die Seite «Räume»: der Raumname, darunter kompakt die
 * Geräte des Raums. Lichter und Schalter lassen sich direkt in der Kachel
 * schalten; alles andere zeigt kurz seinen Zustand. Antippen der Kachel
 * öffnet die volle Raumansicht.
 */

export const KIND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  light: 'bulb-outline',
  switch: 'power-outline',
  sensor: 'thermometer-outline',
  binary_sensor: 'radio-button-on-outline',
  button: 'ellipse-outline',
  media_player: 'musical-notes-outline',
  camera: 'videocam-outline',
  vacuum: 'sparkles-outline',
  appliance: 'cube-outline',
  calendar: 'calendar-outline',
  lock: 'key-outline',
  cover: 'reorder-four-outline',
  weather: 'partly-sunny-outline',
  alert: 'warning-outline',
  scene: 'color-palette-outline',
};

/** Kurzer Zustand für die rechte Spalte – nur für nicht schaltbare Geräte. */
export function shortState(entity: Entity): string {
  const state = entity.state.state;
  switch (entity.kind) {
    case 'cover': {
      const position = entity.state.position;
      if (typeof position === 'number') return `${position}% offen`;
      return state === 'closed' ? 'Zu' : state === 'open' ? 'Offen' : '–';
    }
    case 'sensor':
      return `${state ?? '–'}${entity.state.unit ?? ''}`;
    case 'binary_sensor':
      return state === 'on' ? 'Aktiv' : 'Ruhig';
    case 'button':
      // Was zuletzt gedrückt wurde – ein Taster hat keinen Zustand.
      return state === 'long' ? 'Lang' : state === 'short' ? 'Kurz' : 'Bereit';
    case 'media_player':
      return state === 'playing' ? 'Spielt' : 'Still';
    case 'lock':
      return state === 'locked' ? 'Zu' : 'Offen';
    case 'vacuum':
      return state === 'cleaning' ? 'Reinigt' : state === 'charging' ? 'Lädt' : 'Bereit';
    case 'appliance':
      // Nicht «sonst Bereit»: Ein Gerät im Standby oder ohne je gehörte
      // Meldung ist nicht bereit, es schweigt nur.
      return zustandsText(state);
    case 'scene':
      // «Gilt», solange die Lampen so stehen, wie die Szene sie gesetzt
      // hat. Die Bridge meldet es; wer eine Lampe von Hand verstellt,
      // hat die Szene verlassen.
      return state === 'active' ? 'Gilt' : 'Bereit';
    default:
      return String(state ?? '–');
  }
}

/**
 * Welche Fahrtrichtungen sind bei diesem Storen noch möglich? (rein, testbar)
 *
 * Die Position zählt 100 = ganz offen, 0 = ganz zu. Steht die Store am
 * Anschlag, fehlt der Pfeil in diese Richtung – er würde nichts mehr
 * bewirken und nur suggerieren, es ginge noch weiter.
 */
export function coverMoves(entity: Entity): { up: boolean; down: boolean } {
  const canOpen = entity.commands.includes('open');
  const canClose = entity.commands.includes('close');
  const position = entity.state.position;
  if (typeof position === 'number') {
    // Etwas Spiel an den Enden: Manche Motoren melden 99 statt 100.
    return { up: canOpen && position < 99, down: canClose && position > 1 };
  }
  // Ohne Positionsmeldung entscheidet der grobe Zustand.
  const state = entity.state.state;
  return { up: canOpen && state !== 'open', down: canClose && state !== 'closed' };
}

const MAX_ROWS = 6;

export function RoomTile({
  name,
  items,
  width,
  favorites = [],
  onOpen,
  onCommand,
  scenes = [],
  onScene,
}: {
  name: string;
  items: Entity[];
  width: number;
  /** Sterne entscheiden mit, welche Zeilen die Kachel zeigt. */
  favorites?: string[];
  onOpen: () => void;
  onCommand: (entityId: string, command: string) => void;
  /** Die Szenen dieses Raums – höchstens zwei, sonst ist die Kachel
   *  keine Übersicht mehr. Vorausgewählt von szenenFuerKachel. */
  scenes?: Scene[];
  onScene?: (sceneId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Nicht die Meldereihenfolge der Integration entscheidet, was in die
  // sechs Zeilen passt, sondern was einem wichtig ist: Favoriten, dann
  // Laufendes, dann Bedienbares, Messwerte zuletzt.
  const shownItems = wichtigeZuerst(items, favorites).slice(0, MAX_ROWS);
  const moreCount = items.length - shownItems.length;
  const activeCount = items.filter(
    (entity) => entity.state.state === 'on' || entity.state.state === 'playing'
  ).length;
  // Wie warm, was offen, ob Musik läuft – der Zustand des Raums, nicht
  // nur seine Gerätezahl.
  const zeile = raumZeile(items);

  return (
    <Card style={{ ...styles.tile, width }} onPress={onOpen}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Ionicons name={raumSymbol(name)} size={16} color={colors.inkSoft} />
          <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
            {name}
          </Text>
          {/* Neben dem Titel war Platz, und die Szene des Zimmers lag
              zwei Tipps entfernt: erst den Raum öffnen, dann die Szene.
              Für «Kino» im Wohnzimmer ist das ein Weg zu viel. */}
          {onScene
            ? scenes.map((scene) => {
                const aktiv = !!scene.active;
                return (
                  <Pressable
                    key={scene.id}
                    onPress={() => onScene(scene.id)}
                    hitSlop={6}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: aktiv }}
                    accessibilityLabel={
                      aktiv
                        ? `Szene ${scene.name} in ${name} zurücknehmen`
                        : `Szene ${scene.name} in ${name}`
                    }
                    style={({ pressed }) => [
                      styles.scene,
                      aktiv && styles.sceneOn,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Ionicons
                      name={
                        (scene.icon as keyof typeof Ionicons.glyphMap) ||
                        'sparkles-outline'
                      }
                      size={13}
                      color={aktiv ? '#FFFFFF' : colors.ink}
                    />
                    <Text
                      style={[styles.sceneText, aktiv && { color: '#FFFFFF' }]}
                      numberOfLines={1}
                    >
                      {scene.name}
                    </Text>
                  </Pressable>
                );
              })
            : null}
        </View>
        {zeile ? <Text style={styles.zeile}>{zeile}</Text> : null}
        <Text style={styles.count}>
          {activeCount > 0 ? `${activeCount} an · ` : ''}
          {items.length} Geräte
        </Text>
      </View>

      {shownItems.map((entity) => {
        const togglable = entity.commands.includes('toggle');
        // Eine geltende Lichtszene zählt hier als «an»: Ihr Symbol soll
        // dieselbe Farbe haben wie das Licht, das sie eingeschaltet hat.
        const on =
          entity.state.state === 'on' ||
          (entity.kind === 'scene' && entity.state.state === 'active');
        const moves = entity.kind === 'cover' ? coverMoves(entity) : null;
        return (
          <View key={entity.id} style={styles.row}>
            <Ionicons
              name={KIND_ICONS[entity.kind] ?? 'hardware-chip-outline'}
              size={15}
              color={on ? colors.accent : colors.inkSoft}
            />
            <Text
              style={[styles.rowName, !entity.available && { color: colors.inkFaint }]}
              numberOfLines={1}
            >
              {entity.name}
            </Text>
            {togglable ? (
              <Pressable
                onPress={() => onCommand(entity.id, 'toggle')}
                hitSlop={8}
                accessibilityRole="switch"
                accessibilityLabel={`${entity.name} ${on ? 'ausschalten' : 'einschalten'}`}
                accessibilityState={{ checked: on }}
                style={[styles.toggle, on && styles.toggleOn]}
              >
                <Ionicons name="power" size={13} color={on ? '#FFFFFF' : colors.inkSoft} />
              </Pressable>
            ) : entity.kind === 'scene' ? (
              // Eine Lichtszene hat nichts zum Umschalten – sie hat einen
              // Knopf. Die Bridge kann eine Szene setzen, aber nicht
              // zurücknehmen; ein Schalter wäre hier eine Behauptung.
              <Pressable
                onPress={() => onCommand(entity.id, 'activate')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Szene ${entity.name} aufrufen`}
                style={[styles.toggle, on && styles.toggleOn]}
              >
                <Ionicons
                  name="color-palette"
                  size={13}
                  color={on ? '#FFFFFF' : colors.inkSoft}
                />
              </Pressable>
            ) : moves ? (
              // Storen: Zustand plus die Pfeile, die gerade etwas bewirken.
              //
              // Ein voller Pfeil, kein Winkel (chevron): Der Winkel heisst
              // überall sonst «aufklappen» oder «herunterladen» – hier
              // fährt aber wirklich etwas nach oben oder unten.
              <View style={styles.coverCell}>
                <Text style={styles.rowState} numberOfLines={1}>
                  {shortState(entity)}
                </Text>
                {moves.up ? (
                  <Pressable
                    onPress={() => onCommand(entity.id, 'open')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${entity.name} hochfahren`}
                    style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="arrow-up" size={14} color={colors.ink} />
                  </Pressable>
                ) : null}
                {moves.down ? (
                  <Pressable
                    onPress={() => onCommand(entity.id, 'close')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${entity.name} runterfahren`}
                    style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="arrow-down" size={14} color={colors.ink} />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={styles.rowState} numberOfLines={1}>
                {shortState(entity)}
              </Text>
            )}
          </View>
        );
      })}

      {moreCount > 0 ? (
        <Text style={styles.more}>+ {moreCount} weitere …</Text>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    tile: { minHeight: 0, gap: 8 },
    head: { gap: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // Szenen-Knöpfe neben dem Raumnamen. Klein und mit Höchstbreite: Ein
    // langer Szenenname darf den Raumnamen nicht wegdrücken.
    scene: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      maxWidth: 120,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    sceneOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    sceneText: { color: colors.ink, fontSize: 12, fontWeight: '600', flexShrink: 1 },
    name: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    zeile: { color: colors.inkSoft, fontSize: 12 },
    count: { color: colors.inkFaint, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowName: { color: colors.inkSoft, fontSize: 13, flex: 1 },
    rowState: { color: colors.inkFaint, fontSize: 12 },
    toggle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.off,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleOn: { backgroundColor: colors.accent },
    coverCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    arrow: {
      width: 26,
      height: 26,
      borderRadius: 13,
      // Dieselbe Fläche wie der Ein/Aus-Knopf daneben, damit die Zeilen
      // einer Kachel nicht aus zwei Formensprachen bestehen.
      backgroundColor: colors.off,
      alignItems: 'center',
      justifyContent: 'center',
    },
    more: { color: colors.inkFaint, fontSize: 12 },
  });
