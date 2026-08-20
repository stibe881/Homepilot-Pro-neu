import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Küchen-Timer: Minuten wählen, und der Hub meldet sich.
 *
 * Der Eierwecker, den man nie suchen muss: Nach Ablauf kommt eine Push
 * an alle und – wo Cast-Boxen stehen – eine Durchsage. Läuft auf dem
 * Hub, nicht im Telefon: Die App darf zu, das Telefon in die Tasche.
 */

interface Timer {
  id: string;
  text: string;
  ends_at: number;
  minutes: number;
  by: string;
}

/** «7:05» aus Restsekunden (rein, testbar). */
export function remainingLabel(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.round(endsAt - now));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const QUICK = [3, 5, 10, 15, 30];

export function KitchenTimer({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // Uhr für die Restzeit – tickt nur, solange Timer laufen.
  const [now, setNow] = useState(() => Date.now() / 1000);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  const load = useCallback(() => {
    fetch(`${settings.url}/api/timers`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setTimers(data?.timers ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  useEffect(() => {
    if (timers.length === 0) return;
    const tick = setInterval(() => {
      setNow(Date.now() / 1000);
      // Abgelaufene verschwinden von selbst – einmal nachladen genügt.
      if (timers.some((timer) => timer.ends_at <= Date.now() / 1000)) load();
    }, 1000);
    return () => clearInterval(tick);
  }, [timers, load]);

  const start = async (minutes: number) => {
    setNote(null);
    try {
      const response = await fetch(`${settings.url}/api/timers`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes, text: text.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      setTimers(body.timers ?? []);
      setText('');
    } catch (err: any) {
      setNote(String(err.message ?? err));
    }
  };

  const cancel = async (id: string) => {
    try {
      const response = await fetch(`${settings.url}/api/timers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setTimers(body.timers ?? []);
    } catch {
      load();
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="timer-outline" size={18} color={colors.inkSoft} />
        <Text style={[styles.heading, { flex: 1 }]}>Küchen-Timer</Text>
      </View>

      {timers.map((timer) => (
        <View key={timer.id} style={styles.row}>
          <Text style={styles.remaining}>{remainingLabel(timer.ends_at, now)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.text} numberOfLines={1}>
              {timer.text}
            </Text>
            <Text style={styles.detail}>
              {timer.minutes} Min. · von {timer.by}
            </Text>
          </View>
          <Pressable
            onPress={() => cancel(timer.id)}
            accessibilityLabel="Timer abbrechen"
            hitSlop={8}
          >
            <Ionicons name="close-circle-outline" size={20} color={colors.inkSoft} />
          </Pressable>
        </View>
      ))}

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Pizza rausnehmen! (wird durchgesagt)"
        placeholderTextColor={colors.inkFaint}
        maxLength={100}
      />
      <View style={styles.chips}>
        {QUICK.map((minutes) => (
          <Pressable
            key={minutes}
            onPress={() => start(minutes)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.chipText}>{minutes} Min.</Text>
          </Pressable>
        ))}
      </View>
      {note ? <Text style={styles.hint}>{note}</Text> : null}
      <Text style={styles.hint}>
        Läuft auf dem Hub – App zu ist egal. Nach Ablauf: Push an alle und
        Durchsage auf den Boxen. Ein Hub-Neustart bricht laufende Timer ab.
      </Text>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    remaining: {
      color: colors.accent,
      fontSize: 18,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      minWidth: 56,
    },
    text: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12 },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
