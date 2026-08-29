import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { ROW, verschoben, zielIndex } from '../lib/ziehen';
import { Colors, radius, useColors } from '../theme';

/** Nur für den Browser: Ohne diese beiden Angaben gewinnt die
 *  Wisch-Geste der Seite. React Native kennt die Eigenschaften nicht,
 *  deshalb als loses Objekt – auf Geräten werden sie ignoriert.
 *  Dieselbe Notiz steht in DragGrid.tsx; dort war sie schon nötig. */
const WEB_GRIP = { touchAction: 'none', userSelect: 'none' } as const;

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
  onDragging,
}: {
  items: Item[];
  onReorder: (ids: string[]) => void;
  /** Meldet, solange eine Zeile am Finger hängt.
   *
   *  Der Aufrufer schaltet damit das Scrollen seines Blattes ab. Der
   *  Capture-Anspruch oben hält die *begonnene* Geste – aber ein nativer
   *  ScrollView, der weiter scrollen darf, verschiebt den Inhalt unter
   *  der Zeile, und beim Loslassen landet sie an der falschen Stelle.
   *  Die Startseite macht es mit den Kacheln genauso (scrollEnabled). */
  onDragging?: (aktiv: boolean) => void;
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
    onDragging?.(true);
  };
  const move = (delta: number) => setDy(delta);
  const end = (index: number, delta: number) => {
    const next = verschoben(order, index, zielIndex(index, delta, order.length));
    if (next) {
      setOrder(next);
      onReorder(next.map((entry) => entry.id));
    }
    setActive(null);
    setDy(0);
    onDragging?.(false);
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
  /**
   * Der PanResponder wird **einmal** gebaut und nie wieder – daran hing
   * der ganze Fehler.
   *
   * Vorher hingen die Rückrufe in den Abhängigkeiten des useMemo. Sie
   * entstehen bei jedem Zeichnen neu, und gezeichnet wird bei jeder
   * Fingerbewegung (der Versatz steckt im Zustand). Es gab also je
   * Bewegung einen neuen PanResponder – und ein PanResponder merkt sich
   * den Startpunkt der Geste in seinem eigenen Innern. Der neue kannte
   * ihn nicht, also fing `gesture.dy` jedes Mal von vorn an: Wer eine
   * Zeile 200 Punkte weit zog, bekam als Weg die letzten zwölf gemeldet.
   * Die Zeile rührte sich kaum, und beim Loslassen war das Ziel dieselbe
   * Stelle.
   *
   * Die Rückrufe kommen deshalb über eine Referenz herein: immer die
   * aktuellen, ohne den Responder anzufassen. Dasselbe gilt für den
   * Index – er ändert sich, wenn die Liste umsortiert wird.
   */
  const aktuell = useRef({ index, onStart, onMove, onEnd });
  aktuell.current = { index, onStart, onMove, onEnd };
  const pan = useMemo(
    () =>
      PanResponder.create({
        // In der **Erfassungsphase**, nicht erst danach: iOS fragt erst
        // die Eltern (Capture, aussen nach innen), dann die Kinder. Der
        // native ScrollView nimmt sich die Geste in seiner eigenen
        // Capture-Runde – wer sie behalten will, muss sie dort schon
        // beanspruchen. Im Browser fiel das nie auf, denn dort ist der
        // ScrollView ein gewöhnlicher Kasten ohne eigene Gesten; genau
        // deshalb sah die Browser-Prüfung zweimal gut aus, während das
        // iPhone weiter scrollte statt zu ziehen.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Ohne diese beiden liess sich hier gar nicht ziehen: Die Liste
        // steht in einem ScrollView, und der fordert die Geste beim
        // ersten senkrechten Millimeter für sich an. Wird ihm nicht
        // widersprochen, bricht er das Ziehen sofort ab – die Zeile
        // zuckte kurz, dann scrollte nur noch die Liste.
        //
        // Sie allein genügten allerdings nicht: Die Geste kam an, wurde
        // aber falsch gemessen (siehe oben, der Startpunkt). Beides
        // gehört zusammen, sonst zuckt die Zeile weiterhin nur.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => aktuell.current.onStart(aktuell.current.index),
        onPanResponderMove: (_event, gesture) => aktuell.current.onMove(gesture.dy),
        onPanResponderRelease: (_event, gesture) =>
          aktuell.current.onEnd(aktuell.current.index, gesture.dy),
        onPanResponderTerminate: (_event, gesture) =>
          aktuell.current.onEnd(aktuell.current.index, gesture.dy),
      }),
    []
  );
  return (
    // Die **ganze Zeile** zieht, nicht nur das Symbol daneben. In diesen
    // Blättern gibt es nichts anderes zu tippen, also gibt es keinen
    // Grund, die Greiffläche auf vierzig Punkte zu verkleinern – und
    // «ich treffe den Griff nicht» fühlt sich exakt an wie «es geht
    // nicht». Das ☰ bleibt als Hinweis stehen. WEB_GRIP direkt im
    // Literal: die zwei Browser-Eigenschaften kennt React Native nicht.
    <View
      {...pan.panHandlers}
      style={[
        styles.row,
        active && styles.rowActive,
        { ...WEB_GRIP, transform: [{ translateY: dy }], zIndex: active ? 20 : 0 },
      ]}
    >
      <View style={{ padding: 8 }}>
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
    name: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' },
  });
