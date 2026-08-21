import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuditEntry, HubSettings } from '../api/types';
import { Card } from '../components/Card';
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
export function AccessLog({
  settings,
  headers,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${settings.url}/api/system/audit?limit=150`, {
        headers,
      });
      const body = await response.json();
      setEntries(Array.isArray(body.entries) ? body.entries : []);
    } catch {
      setEntries([]);
    } finally {
      setBusy(false);
    }
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
                  {new Date(row.at * 1000).toLocaleString('de-CH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
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
