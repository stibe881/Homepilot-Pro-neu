import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { PanResponder, View } from 'react-native';

import { radius, useColors } from '../theme';

/**
 * Kacheln direkt im Raster ziehen.
 *
 * Jede Kachel bekommt im Anpassen-Modus einen Griff; die gezogene Kachel
 * folgt dem Finger, beim Loslassen rückt sie an die Stelle der nächsten
 * Nachbarkachel. Die anderen Kacheln bleiben während des Zugs ruhig –
 * das Raster hat je nach Gerät verschieden hohe Kacheln, ein Live-Umbau
 * würde mehr springen als helfen.
 */

/** Nur für den Browser: Ohne diese beiden Angaben gewinnt die
 *  Wisch-Geste der Seite - sie scrollt, und die Kachel folgt dem Finger
 *  nur ein Stück weit. React Native kennt die Eigenschaften nicht,
 *  deshalb als loses Objekt und nicht im Stil-Typ. Auf nativen Geräten
 *  werden sie schlicht ignoriert. */
const WEB_GRIP = { touchAction: 'none', userSelect: 'none' } as const;

export interface CellLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Neue Reihenfolge nach dem Loslassen (rein, testbar).
 *
 * Massgeblich ist die Mitte der gezogenen Kachel: Sie landet vor oder
 * hinter der Kachel, deren Mitte ihr am nächsten liegt – in derselben
 * Zeile entscheidet links/rechts, sonst darüber/darunter. Null heisst:
 * nichts geändert.
 */
export function reorderByDrop(
  ids: string[],
  layouts: Map<string, CellLayout>,
  id: string,
  dx: number,
  dy: number
): string[] | null {
  const own = layouts.get(id);
  if (!own) return null;
  const cx = own.x + own.width / 2 + dx;
  const cy = own.y + own.height / 2 + dy;

  let targetId: string | null = null;
  let best = Infinity;
  for (const other of ids) {
    if (other === id) continue;
    const layout = layouts.get(other);
    if (!layout) continue;
    const distance =
      (layout.x + layout.width / 2 - cx) ** 2 + (layout.y + layout.height / 2 - cy) ** 2;
    if (distance < best) {
      best = distance;
      targetId = other;
    }
  }
  if (!targetId) return null;

  const target = layouts.get(targetId)!;
  const targetCy = target.y + target.height / 2;
  const sameRow = Math.abs(cy - targetCy) <= target.height / 2;
  const before = sameRow ? cx < target.x + target.width / 2 : cy < targetCy;

  const next = ids.filter((entry) => entry !== id);
  const index = next.indexOf(targetId);
  next.splice(before ? index : index + 1, 0, id);
  return next.every((entry, position) => entry === ids[position]) ? null : next;
}

export function DragCell({
  id,
  width,
  dragging,
  dx,
  dy,
  onStart,
  onMove,
  onEnd,
  onLayout,
  children,
}: {
  id: string;
  width: number;
  dragging: boolean;
  dx: number;
  dy: number;
  onStart: (id: string) => void;
  onMove: (dx: number, dy: number) => void;
  onEnd: (id: string, dx: number, dy: number) => void;
  onLayout: (id: string, layout: CellLayout) => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  // Der Responder hängt nur am Griff – die Kachel selbst bleibt bedienbar
  // und die Seite scrollbar.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => onStart(id),
        onPanResponderMove: (_event, gesture) => onMove(gesture.dx, gesture.dy),
        onPanResponderRelease: (_event, gesture) => onEnd(id, gesture.dx, gesture.dy),
        onPanResponderTerminate: (_event, gesture) => onEnd(id, gesture.dx, gesture.dy),
      }),
    [id, onStart, onMove, onEnd]
  );

  return (
    <View
      onLayout={(event) => onLayout(id, event.nativeEvent.layout)}
      style={{
        width,
        zIndex: dragging ? 30 : 0,
        elevation: dragging ? 8 : 0,
        opacity: dragging ? 0.92 : 1,
        transform: dragging
          ? [{ translateX: dx }, { translateY: dy }, { scale: 1.03 }]
          : undefined,
      }}
    >
      {children}
      <View
        {...pan.panHandlers}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          width: 32,
          height: 32,
          ...WEB_GRIP,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: dragging ? colors.accent : colors.surfaceStrong,
          borderWidth: 1,
          borderColor: dragging ? colors.accent : colors.surfaceBorder,
        }}
      >
        <Ionicons
          name="move"
          size={16}
          color={dragging ? '#FFFFFF' : colors.inkSoft}
        />
      </View>
    </View>
  );
}
