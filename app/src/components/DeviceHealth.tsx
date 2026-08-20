import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Card } from './Card';
import { epochAgo } from '../lib/zeit';
import { Colors, type, useColors } from '../theme';

/**
 * Geräte-Gesundheit: alle Batteriegeräte auf einen Blick.
 *
 * Der Wächter meldet erst, wenn eine Batterie schwach ist – die Übersicht
 * davor fehlte: Wer vor den Ferien wissen will, welche Melder demnächst
 * dran sind, musste jedes Gerät einzeln antippen. Sortiert nach
 * Dringlichkeit: leere zuerst, volle zuletzt.
 */

// Ab hier gilt eine Batterie als «demnächst dran» und wird gelb.
const BATTERY_SOON = 25;

export interface HealthRow {
  entity: Entity;
  /** Prozent, wenn das Gerät einen Stand meldet – manche melden nur
   *  «schwach ja/nein». */
  percent: number | null;
  low: boolean;
}

/** Batteriegeräte, dringendste zuerst (rein, testbar).
 *
 * «Schwach»-Melder ohne Prozentwert stehen ganz oben: Sie sagen nur noch
 * «bald leer», und danach sind sie still. */
export function batteryRows(entities: Entity[]): HealthRow[] {
  const rows: HealthRow[] = [];
  for (const entity of entities) {
    const raw = entity.state?.battery;
    const percent = typeof raw === 'number' && raw >= 0 && raw <= 100 ? raw : null;
    const low = entity.state?.low_battery === true;
    if (percent === null && !low) continue;
    rows.push({ entity, percent, low });
  }
  return rows.sort((a, b) => {
    const rank = (row: HealthRow) =>
      row.low ? -1 : row.percent === null ? 999 : row.percent;
    return rank(a) - rank(b) || a.entity.name.localeCompare(b.entity.name);
  });
}

export function DeviceHealth({ entities }: { entities: Entity[] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const rows = batteryRows(entities);
  if (rows.length === 0) return null;

  const urgent = rows.filter(
    (row) => row.low || (row.percent !== null && row.percent <= BATTERY_SOON)
  );

  const tone = (row: HealthRow) =>
    row.low || (row.percent !== null && row.percent <= 10)
      ? colors.danger
      : row.percent !== null && row.percent <= BATTERY_SOON
        ? colors.warn
        : colors.on;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Ionicons
          name="battery-half-outline"
          size={18}
          color={urgent.length > 0 ? colors.warn : colors.inkSoft}
        />
        <Text style={[styles.heading, { flex: 1 }]}>Batterien</Text>
        <Text style={styles.count}>
          {urgent.length > 0 ? `${urgent.length} bald leer · ` : ''}
          {rows.length} Geräte
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>

      {open ? (
        <>
          {rows.map((row) => (
            <View key={row.entity.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{row.entity.name}</Text>
                <Text style={styles.detail}>
                  {row.entity.room ?? 'Ohne Raum'}
                  {epochAgo(row.entity.last_seen)
                    ? ` · zuletzt gesehen ${epochAgo(row.entity.last_seen)}`
                    : ''}
                </Text>
              </View>
              <Text style={[styles.value, { color: tone(row) }]}>
                {row.percent !== null ? `${row.percent} %` : 'schwach'}
              </Text>
            </View>
          ))}
          <Text style={styles.hint}>
            Dringendste zuerst. «Schwach» ohne Prozentzahl heisst: Das Gerät
            meldet nur noch, dass es bald leer ist – danach ist es still,
            ohne sich abzumelden.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    count: { color: colors.inkFaint, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    value: { fontSize: 14, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
