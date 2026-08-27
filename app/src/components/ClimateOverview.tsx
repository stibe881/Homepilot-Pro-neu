import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { FEUCHTE_MAX, FEUCHTE_MIN, bandPosition, klimaUrteil } from '../lib/komfort';
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
    let cancelled = false;
    // Min/Max aus dem Verlauf - je Sensor eine Abfrage, nur beim Öffnen.
    // Ohne Datenbank (503) bleibt die Spalte einfach leer.
    const client = hubClient(settings.url, settings.token);
    rows.forEach((row) => {
      client
        .get<{ history?: { state?: Record<string, unknown> }[] } | null>(
          `/api/entities/${row.temp.id}/history?hours=24`,
          { fallback: null, still: true }
        )
        .then((data) => {
          if (cancelled || !data) return;
          const values = (data.history ?? [])
            .map((entry) => Number(entry.state?.state))
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
        // Ohne Verlauf bleiben die Kacheln ohne Kurve - Messwerte stehen
        // trotzdem da.
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
            // Vorgelesen ergäbe die Zeile «45 Prozent, 21,3 Grad» – die
            // Bedeutung der Zahlen steckt allein in ihrer Position. Deshalb
            // trägt die Zeile den ganzen Satz, und die Teile darin nichts.
            // Das eine Wort, wenn etwas nicht stimmt: «zu trocken» im
            // Winter, «Schimmelgefahr» am Anschlag - im grünen Bereich
            // schweigt die Zeile (lib/komfort.ts).
            const urteil = klimaUrteil(Number(row.temp.state.state), row.humidity);
            const gesprochen =
              `${row.room}: ${Number(row.temp.state.state).toFixed(1)} Grad` +
              (row.humidity != null ? `, ${Math.round(row.humidity)} Prozent Feuchte` : '') +
              (urteil ? `, ${urteil.wort}` : '') +
              (span ? `, heute ${span.min.toFixed(1)} bis ${span.max.toFixed(1)} Grad` : '');
            return (
              <View
                key={row.temp.id}
                style={styles.row}
                accessible
                accessibilityLabel={gesprochen}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {row.room}
                    {urteil ? (
                      <Text
                        style={[
                          styles.urteil,
                          { color: urteil.ton === 'danger' ? colors.danger : colors.warn },
                        ]}
                      >
                        {'  '}
                        {urteil.wort}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={styles.detail}>
                    {span
                      ? `heute ${span.min.toFixed(1)}–${span.max.toFixed(1)} °C`
                      : row.temp.name}
                  </Text>
                  {/* Das Zielband: 40-60 % sind grün, der Punkt ist der
                      Raum. So sieht man ohne Zahlenvergleich, wie weit
                      «35 %» vom Ziel weg ist. */}
                  {row.humidity != null ? (
                    <View style={styles.band}>
                      <View
                        style={[
                          styles.bandZiel,
                          {
                            left: `${bandPosition(FEUCHTE_MIN) * 100}%`,
                            width: `${(bandPosition(FEUCHTE_MAX) - bandPosition(FEUCHTE_MIN)) * 100}%`,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bandPunkt,
                          { left: `${bandPosition(row.humidity) * 100}%` },
                          urteil?.ton === 'danger' && { backgroundColor: colors.danger },
                          urteil?.ton === 'warn' && { backgroundColor: colors.warn },
                        ]}
                      />
                    </View>
                  ) : null}
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
    urteil: { fontSize: 12, fontWeight: '700' },
    // Das Feuchte-Zielband: schmal und leise - eine Beilage zur Zeile,
    // kein eigenes Diagramm.
    band: {
      marginTop: 5,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.track,
      maxWidth: 180,
    },
    bandZiel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderRadius: 2,
      backgroundColor: colors.onSoft,
    },
    bandPunkt: {
      position: 'absolute',
      top: -2,
      width: 8,
      height: 8,
      borderRadius: 4,
      marginLeft: -4,
      backgroundColor: colors.on,
    },
  });
