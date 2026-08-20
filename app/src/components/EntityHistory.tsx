import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { epochAgo, epochTime } from '../lib/zeit';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Verlauf eines einzelnen Geräts: wann schaltete es, und wer war es.
 *
 * Die Antwort auf «warum ging die Lampe um drei Uhr an?» – ohne Scrollen
 * durch den Gesamtverlauf. Jede Zeile trägt ihre Quelle: ein Benutzer,
 * ein Ablauf, eine Szene, die Anwesenheitssimulation – oder das Gerät
 * selbst (Wandschalter, Hersteller-App, Zeitschaltung ausserhalb des Hubs).
 */

interface HistoryEvent {
  state: string | null;
  at: number;
  source: { kind?: string | null; label?: string | null };
}

const STATE_LABEL: Record<string, string> = {
  on: 'Eingeschaltet',
  off: 'Ausgeschaltet',
  open: 'Geöffnet',
  closed: 'Geschlossen',
  locked: 'Abgeschlossen',
  unlocked: 'Aufgeschlossen',
  running: 'Gestartet',
  idle: 'Fertig',
};

/** Wer war es – als lesbarer Satzteil (rein, testbar). */
export function sourceLabel(source: HistoryEvent['source']): string {
  const kind = source?.kind ?? '';
  const label = source?.label ?? '';
  if (kind === 'user') return label || 'Benutzer';
  if (kind === 'automation') return `Ablauf «${label}»`;
  if (kind === 'scene') return `Szene «${label}»`;
  if (kind === 'simulation') return label || 'Anwesenheitssimulation';
  // Ohne Quelle kam der Wechsel nicht über den Hub: Wandschalter,
  // Hersteller-App oder eine Zeitschaltung im Gerät selbst.
  return 'am Gerät / von aussen';
}

export function EntityHistory({
  entity,
  settings,
  onClose,
}: {
  entity: Entity;
  settings: HubSettings;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};
    fetch(`${settings.url}/api/entities/${encodeURIComponent(entity.id)}/log`, {
      headers,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then((data) => setEvents(data.events ?? []))
      .catch((err) => setError(String(err.message ?? err)));
  }, [entity.id, settings.url, settings.token]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Ionicons name="time-outline" size={18} color={colors.inkSoft} />
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
              {entity.name}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Schliessen">
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>

          {error ? <Text style={styles.hint}>Nicht abrufbar: {error}</Text> : null}
          {events == null && !error ? (
            <Text style={styles.hint}>Wird geladen …</Text>
          ) : null}
          {events != null && events.length === 0 ? (
            <Text style={styles.hint}>
              Noch nichts aufgezeichnet. Das Protokoll beginnt beim Start des
              Hubs – nach einem Update ist es zunächst leer.
            </Text>
          ) : null}

          <ScrollView style={{ maxHeight: 420 }}>
            {(events ?? []).map((event, index) => (
              <View key={index} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.state}>
                    {STATE_LABEL[String(event.state)] ?? String(event.state ?? '–')}
                  </Text>
                  <Text style={styles.detail}>{sourceLabel(event.source)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.time}>{epochTime(event.at)}</Text>
                  <Text style={styles.detail}>{epochAgo(event.at)}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {events != null && events.length > 0 ? (
            <Text style={styles.hint}>
              «Am Gerät / von aussen» heisst: Der Wechsel kam nicht über den
              Hub – Wandschalter, Hersteller-App oder eine Zeitschaltung im
              Gerät selbst.
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 440,
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: 16,
      gap: 10,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    state: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    time: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
