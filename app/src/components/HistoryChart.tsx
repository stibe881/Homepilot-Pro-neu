import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Line as SvgLine } from 'react-native-svg';

import { Entity, EntityState } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import { Colors, radius, useColors } from '../theme';

interface Point {
  at: number;
  value: number;
}

/** Wählbare Zeiträume: Tag, Woche, Monat. */
const RANGES: { hours: number; label: string }[] = [
  { hours: 24, label: '24 h' },
  { hours: 24 * 7, label: '7 Tage' },
  { hours: 24 * 30, label: '30 Tage' },
];

/**
 * Verlauf eines Sensors der letzten 24 Stunden.
 *
 * Die Daten kommen über den Hub aus Supabase – ohne Datenbank antwortet er
 * mit 503, und statt eines leeren Rahmens steht dann ein erklärender Satz.
 */
export function HistoryChart({
  entity,
  width,
  height = 120,
}: {
  entity: Entity;
  width: number;
  height?: number;
}) {
  // Zugangsdaten aus dem Context statt als Prop-Schleppe durch
  // EntityCard und EnergyScreen (Punkt 61 der Werkbank).
  const settings = useSettings();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  useEffect(() => {
    let cancelled = false;
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};

    setNote(null);
    fetch(`${settings.url}/api/entities/${entity.id}/history?hours=${hours}`, { headers })
      .then(async (response) => {
        if (response.status === 503) {
          throw new Error('Kein Verlauf – im Hub ist keine Datenbank eingerichtet.');
        }
        if (!response.ok) {
          throw new Error(`Hub antwortet mit ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const parsed: Point[] = (data.history ?? [])
          .map((row: { recorded_at: string; state?: EntityState }) => ({
            at: new Date(row.recorded_at).getTime(),
            value: Number(row.state?.state),
          }))
          .filter((point: Point) => Number.isFinite(point.value))
          .sort((a: Point, b: Point) => a.at - b.at);
        setPoints(parsed);
        if (parsed.length < 2) {
          setNote('Noch zu wenig Verlauf für eine Kurve.');
        }
      })
      .catch((err) => {
        if (!cancelled) setNote(String(err instanceof Error ? err.message : err));
      });

    return () => {
      cancelled = true;
    };
  }, [entity.id, settings.url, settings.token, hours]);

  if (note) {
    return (
      <View>
        <Text style={styles.note}>{note}</Text>
        <View style={styles.rangeRow}>
          {RANGES.map((range) => (
            <Text
              key={range.hours}
              onPress={() => {
                setPoints(null);
                setHours(range.hours);
              }}
              style={[styles.rangeChip, hours === range.hours && styles.rangeChipActive]}
            >
              {range.label}
            </Text>
          ))}
        </View>
      </View>
    );
  }
  if (!points) {
    return <Text style={styles.note}>Verlauf wird geladen …</Text>;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Eine flache Linie soll in der Mitte liegen und nicht am Rand kleben.
  const span = max - min || 1;
  const pad = 8;
  const innerWidth = Math.max(width - pad * 2, 1);
  const innerHeight = height - pad * 2;

  const x = (index: number) => pad + (index / (points.length - 1)) * innerWidth;
  const y = (value: number) => pad + innerHeight - ((value - min) / span) * innerHeight;

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`)
    .join(' ');
  const last = points[points.length - 1];

  return (
    <View style={styles.wrapper}>
      <Svg width={width} height={height}>
        <SvgLine
          x1={pad}
          y1={pad + innerHeight / 2}
          x2={width - pad}
          y2={pad + innerHeight / 2}
          stroke={colors.track}
          strokeWidth={1}
        />
        <Path d={path} stroke={colors.accent} strokeWidth={2} fill="none" />
        {/* Der aktuelle Wert bekommt einen Punkt – das Ende der Kurve ist
            die Zahl, die einen interessiert. */}
        <Circle
          cx={x(points.length - 1)}
          cy={y(last.value)}
          r={4}
          fill={colors.accent}
        />
      </Svg>
      <View style={styles.scale}>
        <Text style={styles.scaleText}>
          {round(min)}–{round(max)} {entity.state.unit ?? ''}
        </Text>
        <View style={styles.rangeRow}>
          {RANGES.map((range) => (
            <Text
              key={range.hours}
              onPress={() => setHours(range.hours)}
              style={[styles.rangeChip, hours === range.hours && styles.rangeChipActive]}
            >
              {range.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function round(value: number): string {
  return String(Math.round(value * 10) / 10);
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrapper: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      paddingBottom: 6,
    },
    scale: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
    },
    scaleText: { color: colors.inkFaint, fontSize: 11 },
    rangeRow: { flexDirection: 'row', gap: 4 },
    rangeChip: {
      color: colors.inkFaint,
      fontSize: 11,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    rangeChipActive: { color: '#FFFFFF', backgroundColor: colors.accent },
    note: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
  });
