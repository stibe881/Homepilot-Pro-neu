import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Wartungserinnerungen: Filter, Batterien, Entkalken.
 *
 * Der Unterschied zu einer Aufgabe in der Familienliste: Diese Dinge
 * wiederholen sich in Monaten, nicht in Tagen – und genau deshalb denkt
 * niemand daran. Der Wasserfilter hält ein halbes Jahr und steht in
 * keinem Kalender.
 *
 * «Erledigt» zählt ab heute weiter, nicht ab der alten Frist: Wer drei
 * Wochen zu spät wechselt, hat danach wieder ein volles halbes Jahr. Bei
 * Verschleiss zählt, wann es getan wurde.
 */

interface Item {
  id: string;
  text: string;
  interval_days: number;
  due: string;
  last_done?: string | null;
  days_left?: number;
}

const INTERVALLE = [
  { label: '1 Monat', days: 30 },
  { label: '3 Monate', days: 90 },
  { label: '6 Monate', days: 180 },
  { label: '1 Jahr', days: 365 },
];

/** Wie dringend es ist – in Worten (rein, testbar). */
export function faelligText(item: Item): string {
  const tage = item.days_left;
  if (typeof tage !== 'number') return `fällig am ${item.due}`;
  if (tage < 0) return `seit ${Math.abs(tage)} Tagen fällig`;
  if (tage === 0) return 'heute fällig';
  return `in ${tage} Tagen`;
}

export function Maintenance({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Item[]>([]);
  const [faellig, setFaellig] = useState<Item[]>([]);
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [tage, setTage] = useState(180);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const laden = useCallback(() => {
    // Ohne Verbindung bleibt die Karte beim letzten Stand - das
    // Verbindungsproblem zeigt die Kopfzeile, nicht jede Karte einzeln.
    hub
      .get<{ items?: Item[]; due?: Item[] } | null>('/api/maintenance', {
        fallback: null,
        still: true,
      })
      .then((body) => {
        if (!body) return;
        setItems(Array.isArray(body.items) ? body.items : []);
        setFaellig(Array.isArray(body.due) ? body.due : []);
      });
  }, [hub]);

  useEffect(laden, [laden]);

  const schicken = async (pfad: string, method: string) => {
    // Kein eigener Fehlertext: laden() gleich danach zeigt den echten
    // Stand - ein gescheitertes Abhaken steht damit sichtbar wieder da.
    if (method === 'DELETE') {
      await hub.del(pfad, { fallback: null });
    } else {
      await hub.post(pfad, undefined, { fallback: null });
    }
    laden();
  };

  const anlegen = async () => {
    if (!text.trim()) return;
    // Auch hier: laden() zeigt gleich, ob der Eintrag angekommen ist.
    await hub.post(
      '/api/maintenance',
      { text: text.trim(), interval_days: tage },
      { fallback: null }
    );
    setText('');
    setOffen(false);
    laden();
  };

  // Fällige zuoberst, danach der Rest - was ansteht, soll man sehen, ohne
  // zu suchen.
  const faelligeIds = new Set(faellig.map((item) => item.id));
  const rest = items.filter((item) => !faelligeIds.has(item.id));

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="construct-outline" size={18} color={colors.inkSoft} />
        <Text style={[styles.heading, { flex: 1 }]}>Wartung</Text>
        {faellig.length > 0 ? (
          <Text style={styles.badge}>{faellig.length} fällig</Text>
        ) : null}
      </View>

      {faellig.map((item) => (
        <View key={item.id} style={styles.row}>
          <Ionicons
            name="alert-circle"
            size={18}
            color={(item.days_left ?? 0) < 0 ? colors.danger : colors.warn}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.text}</Text>
            <Text
              style={[
                styles.rowDetail,
                { color: (item.days_left ?? 0) < 0 ? colors.danger : colors.warn },
              ]}
            >
              {faelligText(item)}
            </Text>
          </View>
          <Pressable
            onPress={() => schicken(`/api/maintenance/${item.id}/done`, 'POST')}
            accessibilityRole="button"
            accessibilityLabel={`${item.text} erledigt`}
            style={({ pressed }) => [styles.doneButton, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="checkmark" size={15} color="#FFFFFF" />
            <Text style={styles.doneText}>Erledigt</Text>
          </Pressable>
        </View>
      ))}

      {rest.map((item) => (
        <View key={item.id} style={styles.row}>
          <Ionicons name="time-outline" size={18} color={colors.inkFaint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.text}</Text>
            <Text style={styles.rowDetail}>
              nächste am {item.due} · alle {item.interval_days} Tage
              {item.last_done ? ` · zuletzt ${item.last_done}` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => schicken(`/api/maintenance/${item.id}`, 'DELETE')}
            hitSlop={8}
            accessibilityLabel={`${item.text} löschen`}
          >
            <Ionicons name="close" size={17} color={colors.inkFaint} />
          </Pressable>
        </View>
      ))}

      {offen ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Was, z.B. Wasserfilter wechseln"
            placeholderTextColor={colors.inkFaint}
          />
          <View style={styles.chipRow}>
            {INTERVALLE.map((option) => (
              <Pressable
                key={option.days}
                onPress={() => setTage(option.days)}
                accessibilityRole="radio"
                accessibilityState={{ selected: tage === option.days }}
                style={[styles.chip, tage === option.days && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, tage === option.days && styles.chipTextActive]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.formButtons}>
            <Pressable onPress={() => setOffen(false)} style={styles.secondary}>
              <Text style={styles.secondaryText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={anlegen}
              disabled={!text.trim()}
              style={({ pressed }) => [
                styles.primary,
                (!text.trim() || pressed) && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.primaryText}>Eintragen</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setOffen(true)} style={styles.newButton}>
          <Ionicons name="add" size={17} color={colors.ink} />
          <Text style={styles.newButtonText}>Wartung eintragen</Text>
        </Pressable>
      )}

      <Text style={styles.hint}>
        Erinnert wird eine Woche im Voraus, morgens – einen Filter, den man
        erst am Stichtag bestellt, hat man zu spät bestellt. «Erledigt»
        zählt ab heute weiter.
      </Text>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    badge: { color: colors.warn, fontSize: 12, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
    doneButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.control,
      backgroundColor: colors.on,
    },
    doneText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    form: { gap: 8 },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    formButtons: { flexDirection: 'row', gap: 8 },
    primary: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 11,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    secondary: {
      alignItems: 'center',
      paddingVertical: 11,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    secondaryText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    newButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
  });
