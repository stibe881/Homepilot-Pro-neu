/**
 * Wer hat was eingerichtet - und wann.
 *
 * Das Zugriffsprotokoll daneben beantwortet «wer hat geschaltet». Die
 * andere Hälfte fehlte: wer etwas *eingerichtet* hat. Umbenannt,
 * ausgeblendet, einen Ablauf geändert, eine Szene gelöscht, jemandem
 * eine Rolle gegeben. Bei vier Personen im Haus ist «seit wann heisst
 * das so?» eine reale Frage - und «warum läuft der Ablauf nicht mehr?»
 * erst recht.
 *
 * Bewusst zwei Karten und nicht eine Liste: Bedienung passiert hundertmal
 * am Tag, Einrichtung selten. Zusammen wäre die seltene nicht mehr zu
 * finden.
 *
 * Erst auf Antippen geladen - wie beim Zugriffsprotokoll: Die Frage
 * stellt man selten, und wenn, dann gezielt.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import { datumUhr } from '../lib/format';
import { Colors, type, useColors } from '../theme';

interface Eintrag {
  at: number;
  user: string;
  art: string;
  was: string;
  ziel?: string;
}

/** Ein Symbol je Art - damit sich die Zeilen im Vorbeilesen sortieren. */
const SYMBOLE: Record<string, keyof typeof Ionicons.glyphMap> = {
  geraet: 'hardware-chip-outline',
  haus: 'grid-outline',
  ablauf: 'git-branch-outline',
  szene: 'sparkles-outline',
  benutzer: 'person-circle-outline',
  leuchte: 'bulb-outline',
  alarm: 'shield-checkmark-outline',
  regel: 'notifications-outline',
  konfiguration: 'document-text-outline',
};

export function Einrichtungsprotokoll({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [entries, setEntries] = useState<Eintrag[] | null>(null);
  const [arten, setArten] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const laden = async () => {
    setBusy(true);
    const body = await hub.get<{ entries?: Eintrag[]; arten?: Record<string, string> }>(
      '/api/system/einrichtung?limit=150',
      { fallback: { entries: [] } }
    );
    setEntries(Array.isArray(body.entries) ? body.entries : []);
    // Die Namen der Arten kommen vom Hub: So steht dieselbe Liste nicht
    // zweimal da und läuft nicht auseinander.
    setArten(body.arten && typeof body.arten === 'object' ? body.arten : {});
    setBusy(false);
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => {
          const next = !open;
          setOpen(next);
          if (next && entries === null) laden();
        }}
        accessibilityRole="button"
        style={styles.head}
      >
        <Text style={styles.heading}>Wer hat was eingerichtet</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.inkSoft}
        />
      </Pressable>
      {!open ? (
        <Text style={styles.hint}>
          Umbenannt, ausgeblendet, Ablauf geändert, Rolle vergeben – wer,
          was und wann.
        </Text>
      ) : entries === null ? (
        <Text style={styles.hint}>{busy ? 'Wird geladen …' : ''}</Text>
      ) : entries.length === 0 ? (
        <Text style={styles.hint}>
          Noch nichts eingerichtet, seit der Hub mitschreibt.
        </Text>
      ) : (
        <View style={styles.list}>
          {entries.map((row, index) => (
            <View key={index} style={styles.row}>
              <Ionicons
                name={SYMBOLE[row.art] ?? 'ellipse-outline'}
                size={18}
                color={colors.inkSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {row.user} · {row.ziel || arten[row.art] || row.art}
                </Text>
                <Text style={styles.rowDetail}>
                  {row.was} · {datumUhr(row.at * 1000)}
                  {row.ziel ? ` · ${arten[row.art] ?? row.art}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
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
