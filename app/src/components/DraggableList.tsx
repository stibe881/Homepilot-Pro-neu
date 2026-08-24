import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

/** Höhe einer Zeile – Grundlage fürs Umrechnen der Ziehdistanz in Positionen. */
const ROW = 56;

interface Item {
  id: string;
  name: string;
}

/**
 * Einspaltige Liste, deren Einträge sich am Griff (☰) ziehen lassen.
 *
 * Bewusst ohne zusätzliche Bibliothek: nur der eingebaute PanResponder. Der
 * gezogene Eintrag folgt dem Finger, beim Loslassen landet er an der neuen
 * Stelle. Die anderen Zeilen bleiben ruhig – das reicht für ein Ordnen und
 * kommt ohne native Abhängigkeiten aus.
 */
export function DraggableList({
  items,
  onReorder,
}: {
  items: Item[];
  onReorder: (ids: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [order, setOrder] = useState<Item[]>(items);
  const [active, setActive] = useState<number | null>(null);
  const [dy, setDy] = useState(0);

  // Live-Updates der Geräteliste übernehmen, solange gerade nicht gezogen wird.
  useEffect(() => {
    if (active === null) setOrder(items);
  }, [items, active]);

  const start = (index: number) => {
    setActive(index);
    setDy(0);
  };
  const move = (delta: number) => setDy(delta);
  const end = (index: number, delta: number) => {
    const target = Math.max(
      0,
      Math.min(order.length - 1, index + Math.round(delta / ROW))
    );
    if (target !== index) {
      const next = [...order];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setOrder(next);
      onReorder(next.map((entry) => entry.id));
    }
    setActive(null);
    setDy(0);
  };

  return (
    <View>
      {order.map((item, index) => (
        <DragRow
          key={item.id}
          item={item}
          index={index}
          active={active === index}
          dy={active === index ? dy : 0}
          onStart={start}
          onMove={move}
          onEnd={end}
          styles={styles}
          colors={colors}
        />
      ))}
    </View>
  );
}

function DragRow({
  item,
  index,
  active,
  dy,
  onStart,
  onMove,
  onEnd,
  styles,
  colors,
}: {
  item: Item;
  index: number;
  active: boolean;
  dy: number;
  onStart: (index: number) => void;
  onMove: (delta: number) => void;
  onEnd: (index: number, delta: number) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  // Der PanResponder hängt nur am Griff, damit die Liste sonst scrollbar bleibt.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Ohne diese beiden liess sich hier gar nicht ziehen: Die Liste
        // steht in einem ScrollView, und der fordert die Geste beim
        // ersten senkrechten Millimeter für sich an. Wird ihm nicht
        // widersprochen, bricht er das Ziehen sofort ab – die Zeile
        // zuckte kurz, dann scrollte nur noch die Liste.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => onStart(index),
        onPanResponderMove: (_event, gesture) => onMove(gesture.dy),
        onPanResponderRelease: (_event, gesture) => onEnd(index, gesture.dy),
        onPanResponderTerminate: (_event, gesture) => onEnd(index, gesture.dy),
      }),
    [index, onStart, onMove, onEnd]
  );
  return (
    <View
      style={[
        styles.row,
        active && styles.rowActive,
        { transform: [{ translateY: dy }], zIndex: active ? 20 : 0 },
      ]}
    >
      <View style={styles.handle} {...pan.panHandlers}>
        <Ionicons name="reorder-three" size={24} color={colors.inkSoft} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {item.name}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      height: ROW,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 8,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 8,
    },
    rowActive: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceStrong,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    handle: { padding: 8 },
    name: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' },
  });
