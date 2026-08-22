import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { Colors, radius, useColors } from '../theme';
import { useTakt } from '../hooks/useTakt';
import { dauerText } from '../lib/format';

/**
 * Einschlaf-Timer auf der Fernsehkachel.
 *
 * Der Timer selbst läuft im Hub, nicht hier: Wer einschläft, sperrt sein
 * Telefon, und ein Timer, der davon abhinge, wäre keiner. Von dort kommt
 * ein Zeitpunkt – die Kachel rechnet daraus die Restzeit und zählt
 * selbst herunter, statt dass der Hub im Minutentakt etwas schickt.
 */

/** Vorgabe, falls der Hub noch keine Liste mitschickt (ältere Fassung). */
const FALLBACK = [30, 60, 90, 120, 150];

/**
 * Verbleibende Minuten aus dem Zeitpunkt des Hubs (rein, testbar).
 *
 * Aufgerundet: Solange etwas läuft, soll auch etwas dastehen – «0 min»
 * neben einem laufenden Timer liest sich wie ein Fehler. `null` heisst:
 * kein Timer.
 */
export function restMinuten(sleepUntil: unknown, jetzt: number): number | null {
  const bis = typeof sleepUntil === 'number' ? sleepUntil * 1000 : null;
  if (bis === null) return null;
  const rest = bis - jetzt;
  if (rest <= 0) return null;
  return Math.max(1, Math.ceil(rest / 60000));
}

export function TvSleep({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now());

  const auswahl: number[] = Array.isArray(entity.state.sleep_minutes)
    ? entity.state.sleep_minutes.filter((m: unknown) => typeof m === 'number')
    : FALLBACK;
  const rest = restMinuten(entity.state.sleep_until, jetzt);

  // Nur mitzählen, solange etwas läuft. Ein Zähler, der auch bei
  // abgeschaltetem Timer jede Viertelminute neu zeichnet, kostet Akku für
  // nichts.
  useTakt(() => setJetzt(Date.now()), rest === null ? null : 15000);

  if (auswahl.length === 0) return null;

  return (
    <View style={styles.box}>
      <Pressable
        onPress={() => setOffen((war) => !war)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        style={({ pressed }) => [
          styles.head,
          rest !== null && styles.headActive,
          pressed && { opacity: 0.8 },
        ]}
      >
        <Ionicons
          name={rest !== null ? 'moon' : 'moon-outline'}
          size={15}
          color={rest !== null ? colors.accent : colors.inkSoft}
        />
        <Text
          style={[styles.headText, rest !== null && { color: colors.accent }]}
          numberOfLines={1}
        >
          {rest !== null ? `Aus in ${dauerText(rest)}` : 'Einschlaf-Timer'}
        </Text>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.inkFaint}
        />
      </Pressable>

      {offen ? (
        <View style={styles.list}>
          {auswahl.map((minuten) => (
            <Pressable
              key={minuten}
              onPress={() => {
                onCommand('sleep_timer', { minutes: minuten });
                setOffen(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.chipText}>{dauerText(minuten)}</Text>
            </Pressable>
          ))}
          {rest !== null ? (
            <Pressable
              onPress={() => {
                onCommand('sleep_timer', { minutes: 0 });
                setOffen(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.chip,
                styles.chipStop,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.chipText, { color: colors.danger }]}>
                Timer aus
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: { gap: 6 },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    headActive: { borderColor: colors.accent },
    headText: { color: colors.ink, fontSize: 13, fontWeight: '600', flex: 1 },
    list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipStop: { borderColor: colors.danger },
    chipText: { color: colors.ink, fontSize: 13 },
  });
