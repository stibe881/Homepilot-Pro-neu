/**
 * Das Einstellungs-Menü auf dem Telefon: eine Zeile statt einer Seite.
 *
 * Auf dem breiten Bildschirm steht das Menü links neben dem Inhalt, und
 * ein Tipp auf «Einstellungen» öffnet gleich eine Seite. Auf dem Telefon
 * ist für eine Spalte daneben kein Platz - aber der Zwischenschritt über
 * die Kachelliste war hier derselbe Umweg: Wer von den Abläufen zum
 * System wollte, ging zurück zur Liste, suchte den Punkt und tippte
 * wieder. Drei Handgriffe für einen Wechsel.
 *
 * Also dieselbe Idee, quer: eine schiebbare Zeile über dem Inhalt, in der
 * jeder Punkt einen Tipp weit weg ist. Der offene ist gefüllt, und die
 * Zeile schiebt sich von selbst dorthin - sonst stünde man auf «System»
 * und sähe vorne «Suche», ohne zu ahnen, wo man ist.
 *
 * Ganz links bleibt der Weg zur Kachelliste: Dort stehen die Erklärungen
 * unter jedem Punkt, und wer sucht statt weiss, braucht sie.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Colors, radius, useColors } from '../theme';

export interface Menuepunkt {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

export function EinstellungsTabs({
  punkte,
  active,
  onSelect,
  onUebersicht,
}: {
  punkte: Menuepunkt[];
  /** Der offene Punkt – oder nichts, wenn gerade die Kachelliste steht. */
  active: string | null;
  onSelect: (key: string) => void;
  /** Zurück zur Kachelliste mit den Erklärungen. */
  onUebersicht: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const streifen = useRef<ScrollView>(null);
  // Wo jeder Punkt liegt – gemessen beim Zeichnen, weil die Breite vom
  // Text abhängt und niemand sie vorher kennt.
  const stellen = useRef<Record<string, number>>({});
  const gezeigt = useRef<string | null>(null);

  const hinschieben = (key: string) => {
    if (gezeigt.current === key) return;
    const x = stellen.current[key];
    if (x === undefined) return;
    gezeigt.current = key;
    // 24 Pixel Vorlauf: Der offene Punkt soll nicht am Rand kleben,
    // sondern zeigen, dass links noch etwas steht.
    streifen.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  };

  // Beim Wechsel nachziehen. `onLayout` allein genügt nicht: Es meldet
  // sich nur, wenn sich die Grösse ändert - wer von «Suche» zu «System»
  // springt, bewegt keinen einzigen Knopf, und die Zeile bliebe stehen,
  // wo sie war.
  useEffect(() => {
    if (active) hinschieben(active);
  }, [active]);

  return (
    <ScrollView
      ref={streifen}
      horizontal
      showsHorizontalScrollIndicator={false}
      // Feste Höhe: ein waagrechter ScrollView in einer senkrechten Liste
      // hat sonst keine eigene Höhe und verschwindet.
      style={styles.streifen}
      contentContainerStyle={styles.zeile}
    >
      <Pressable
        onPress={onUebersicht}
        accessibilityRole="button"
        accessibilityLabel="Alle Einstellungen"
        style={({ pressed }) => [
          styles.tab,
          styles.uebersicht,
          active === null && styles.offen,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Ionicons
          name="apps-outline"
          size={16}
          color={active === null ? colors.ink : colors.onGradient}
        />
      </Pressable>

      {punkte.map((punkt) => {
        const offen = punkt.key === active;
        return (
          <Pressable
            key={punkt.key}
            onPress={() => onSelect(punkt.key)}
            onLayout={(event) => {
              stellen.current[punkt.key] = event.nativeEvent.layout.x;
              if (offen) hinschieben(punkt.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: offen }}
            style={({ pressed }) => [
              styles.tab,
              offen && styles.offen,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={punkt.icon}
              size={16}
              color={offen ? colors.ink : colors.onGradient}
            />
            <Text
              style={[styles.text, offen && styles.textOffen]}
              numberOfLines={1}
            >
              {punkt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    streifen: { height: 44, flexGrow: 0, flexShrink: 0 },
    zeile: { gap: 8, paddingRight: 20, alignItems: 'center' },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    uebersicht: { paddingHorizontal: 12 },
    offen: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
    text: { color: colors.onGradient, fontSize: 14, fontWeight: '600' },
    textOffen: { color: colors.ink, fontWeight: '700' },
  });
