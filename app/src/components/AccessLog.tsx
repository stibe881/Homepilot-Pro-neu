import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { AuditEntry, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { datumUhr } from '../lib/format';
import { Colors, type, useColors } from '../theme';

/**
 * Zugriffsprotokoll: wer hat wann was geschaltet.
 *
 * Die Liste «Zuletzt passiert» auf der Startseite ist flüchtig – sie
 * beginnt bei jedem Verbinden neu. Hier steht, was den Neustart überlebt
 * hat: die Befehle von Menschen, bei Schloss und Alarm samt Adresse.
 *
 * Erst auf Antippen geladen: Die Frage stellt man selten, und wenn, dann
 * gezielt.
 */
export function AccessLog({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const body = await hub.get<{ entries?: AuditEntry[] }>(
      '/api/system/audit?limit=150',
      { fallback: { entries: [] } }
    );
    setEntries(Array.isArray(body.entries) ? body.entries : []);
    setBusy(false);
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => {
          const next = !open;
          setOpen(next);
          if (next && entries === null) load();
        }}
        accessibilityRole="button"
        style={styles.head}
      >
        <Text style={styles.heading}>Zugriffsprotokoll</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.inkSoft}
        />
      </Pressable>
      {!open ? (
        <Text style={styles.hint}>
          Wer hat wann was geschaltet – auch über Neustarts hinweg.
        </Text>
      ) : entries === null ? (
        <Text style={styles.hint}>{busy ? 'Wird geladen …' : ''}</Text>
      ) : entries.length === 0 ? (
        <Text style={styles.hint}>Noch nichts protokolliert.</Text>
      ) : (
        <View style={styles.list}>
          {entries.map((row, index) => (
            <View key={index} style={styles.row}>
              <Ionicons name="person-circle-outline" size={18} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {row.user} · {row.entity}
                </Text>
                <Text style={styles.rowDetail}>
                  {commandLabel(row.command)} ·{' '}
                  {datumUhr(row.at * 1000)}
                  {row.address ? ` · ${row.address}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Befehlsnamen lesbar machen (rein, testbar). */
export function commandLabel(command: string): string {
  const labels: Record<string, string> = {
    turn_on: 'eingeschaltet',
    turn_off: 'ausgeschaltet',
    toggle: 'umgeschaltet',
    open: 'geöffnet',
    close: 'geschlossen',
    stop: 'gestoppt',
    lock: 'abgeschlossen',
    unlock: 'aufgeschlossen',
    unlatch: 'aufgezogen',
    open_door: 'Türe geöffnet',
    arm: 'scharf geschaltet',
    disarm: 'unscharf geschaltet',
    start: 'gestartet',
    dock: 'zur Station geschickt',
  };
  return labels[command] ?? command;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    list: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 12 },
  });
