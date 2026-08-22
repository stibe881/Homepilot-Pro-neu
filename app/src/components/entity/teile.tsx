/**
 * Kleinteile der Kachel: Pillen, Werte, Zeit- und Namens-Helfer.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { datumKurz, uhr, wochentagUhr } from '../../lib/format';
import { Colors, useColors } from '../../theme';
import { makeStyles } from './stil';


export function severityColor(colors: Colors, severity: string): string {
  return severity === 'Extreme' || severity === 'Severe' ? colors.danger : colors.warn;
}

export function eventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return uhr(date);
  return wochentagUhr(date);
}

/** Uhrzeit heute, sonst Datum – für „letzte Bewegung“. */
export function clock(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? `um ${uhr(date)}` : `am ${datumKurz(date)} um ${uhr(date)}`;
}

export function BigValue({ value, on, note }: { value: string; on?: boolean; note?: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View>
      <Text style={[styles.value, on && { color: colors.on }]}>{value}</Text>
      {note ? <Text style={styles.hint}>{note}</Text> : null}
    </View>
  );
}

export function Pill({ label, tone, solid }: { label: string; tone?: string; solid?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const color = tone ?? colors.inkSoft;
  return (
    <View
      style={[
        styles.pill,
        solid
          ? { backgroundColor: color }
          : { backgroundColor: colors.surfaceSoft, borderColor: color, borderWidth: 1 },
      ]}
    >
      <Text style={[styles.pillText, solid ? { color: '#fff' } : { color }]}>{label}</Text>
    </View>
  );
}

export function format(value: unknown): string {
  if (typeof value === 'number') {
    return String(Math.round(value * 10) / 10);
  }
  return String(value ?? '–');
}

/** «Zuletzt gesehen»-Abstand in Alltagssprache (rein, testbar). */
export function sinceLabel(epochSeconds: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (seconds < 90) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
}

export function integrationLabel(integration: string): string {
  const names: Record<string, string> = {
    hue: 'Philips Hue',
    mqtt: 'Tasmota',
    homematic: 'Homematic',
    unifi: 'UniFi',
    twinkly: 'Twinkly',
    vzug: 'V-ZUG',
    meteoalarm: 'MeteoAlarm',
    demo: 'Demo',
  };
  return names[integration] ?? integration;
}

