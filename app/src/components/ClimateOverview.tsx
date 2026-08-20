import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, type, useColors } from '../theme';

/**
 * Klima-Übersicht: Temperatur (und Feuchte) aller Räume auf einen Blick.
 *
 * Heute muss man jeden Sensor einzeln antippen. Hier steht das Haus in
 * einer Karte, mit Tages-Min/Max aus dem Verlauf – das «im Schlafzimmer
 * war es letzte Nacht 16 Grad» ohne Kurvenlesen.
 */

export interface ClimateRow {
  room: string;
  temp: Entity;
  /** Feuchte in Prozent, wenn der Sensor (oder ein Nachbar) sie meldet. */
  humidity: number | null;
}

/** Ein Temperatursensor? (rein, testbar) */
export function isTemperature(entity: Entity): boolean {
  return (
    entity.kind === 'sensor' &&
    typeof entity.state?.state === 'number' &&
    (entity.state?.device_class === 'temperature' || entity.state?.unit === '°C')
  );
}

/** Je Raum ein Temperatursensor, alphabetisch (rein, testbar).
 *
 * Bei mehreren Sensoren im Raum gewinnt der erste nach Name - eine
 * Übersicht will einen Wert je Zimmer, keine Debatte. Die Feuchte kommt
 * vom selben Sensor (Attribut) oder einem Feuchte-Sensor im Raum. */
export function climateRows(entities: Entity[]): ClimateRow[] {
  const byRoom = new Map<string, Entity[]>();
  for (const entity of entities) {
    if (!entity.room) continue;
    byRoom.set(entity.room, [...(byRoom.get(entity.room) ?? []), entity]);
  }
  const rows: ClimateRow[] = [];
  for (const [room, here] of byRoom) {
    const temps = here.filter(isTemperature).sort((a, b) => a.name.localeCompare(b.name));
    const temp = temps[0];
    if (!temp) continue;
    const own = temp.state?.humidity;
    const neighbour = here.find(
      (entity) =>
        entity.state?.device_class === 'humidity' &&
        typeof entity.state?.state === 'number'
    );
    rows.push({
      room,
      temp,
      humidity:
        typeof own === 'number'
          ? own
          : neighbour
            ? Number(neighbour.state.state)
            : null,
    });
  }
  return rows.sort((a, b) => a.room.localeCompare(b.room));
}

export function ClimateOverview({
  settings,
  entities,
}: {
  settings: HubSettings;
  entities: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  // entity_id → {min, max} der letzten 24 Stunden, nachgeladen beim Öffnen.
  const [range, setRange] = useState<Record<string, { min: number; max: number }>>({});

  const rows = climateRows(entities);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};
    let cancelled = false;
    // Min/Max aus dem Verlauf - je Sensor eine Abfrage, nur beim Öffnen.
    // Ohne Datenbank (503) bleibt die Spalte einfach leer.
    rows.forEach((row) => {
      fetch(`${settings.url}/api/entities/${row.temp.id}/history?hours=24`, { headers })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          const values = (data.history ?? [])
            .map((entry: any) => Number(entry.state?.state))
            .filter((value: number) => Number.isFinite(value));
          if (values.length === 0) return;
          setRange((prev) => ({
            ...prev,
            [row.temp.id]: {
              min: Math.min(...values),
              max: Math.max(...values),
            },
          }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.url, settings.token, rows.length]);

  if (rows.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Ionicons name="thermometer-outline" size={18} color={colors.inkSoft} />
        <Text style={[styles.heading, { flex: 1 }]}>Klima</Text>
        <Text style={styles.count}>{rows.length} Räume</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>

      {open ? (
        <>
          {rows.map((row) => {
            const span = range[row.temp.id];
            return (
              <View key={row.temp.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.room}</Text>
                  <Text style={styles.detail}>
                    {span
                      ? `heute ${span.min.toFixed(1)}–${span.max.toFixed(1)} °C`
                      : row.temp.name}
                  </Text>
                </View>
                {row.humidity != null ? (
                  <Text style={styles.humidity}>{Math.round(row.humidity)} %</Text>
                ) : null}
                <Text style={styles.value}>
                  {Number(row.temp.state.state).toFixed(1)} °C
                </Text>
              </View>
            );
          })}
          <Text style={styles.hint}>
            Min/Max der letzten 24 Stunden stammen aus dem Verlauf und
            erscheinen nur mit eingerichteter Datenbank.
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
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    humidity: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    value: { color: colors.ink, fontSize: 16, fontWeight: '700', minWidth: 62, textAlign: 'right' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
