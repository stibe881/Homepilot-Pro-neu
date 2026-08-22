import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { datumVoll, uhr } from '../lib/format';
import { Colors, radius, useColors } from '../theme';

/**
 * Datum und Uhrzeit wählen – ohne zusätzliche Bibliothek.
 *
 * Bewusst selbst gebaut: Ein nativer Datumswähler wäre ein weiteres
 * natives Paket und damit ein neuer Build, nur für zwei Felder. Und die
 * Web-Fassung der App hätte ihn ohnehin nicht. So sieht es auf iPhone,
 * Android und im Browser gleich aus und lässt sich direkt antippen.
 *
 * Aufgeklappt statt im Modal: Wer einen Zeitraum wählt, will Beginn und
 * Ende nebeneinander sehen – zwei Dialoge hintereinander verlieren den
 * Zusammenhang.
 */

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Die Tage eines Monats als Wochenzeilen, Montag zuerst (rein, testbar).
 *
 *  null = leeres Feld vor dem Ersten bzw. nach dem Letzten. Ohne die
 *  Lücken stünde der Monatsanfang unter dem falschen Wochentag. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  // getDay() zählt ab Sonntag; hier beginnt die Woche am Montag.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(cells.slice(index, index + 7));
  }
  return rows;
}

/** Gleicher Kalendertag? (rein, testbar) */
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Minuten auf ein Raster runden – 09:07 wird zu 09:00 (rein, testbar). */
export function snap(date: Date, step = 15): Date {
  const copy = new Date(date);
  copy.setMinutes(Math.round(copy.getMinutes() / step) * step, 0, 0);
  return copy;
}

/** «Do., 21.08.2026, 09:00» */
export function readable(date: Date): string {
  return `${datumVoll(date)}, ${uhr(date)}`;
}

export function DateTimePick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  // Welcher Monat gerade im Raster steht – unabhängig vom gewählten Tag,
  // sonst könnte man nicht vorblättern, ohne etwas auszuwählen.
  const [shown, setShown] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));

  const pickDay = (day: number) => {
    const next = new Date(value);
    next.setFullYear(shown.getFullYear(), shown.getMonth(), day);
    onChange(next);
  };

  const shift = (minutes: number) => {
    const next = new Date(value);
    next.setMinutes(next.getMinutes() + minutes);
    onChange(next);
  };

  const move = (months: number) =>
    setShown(new Date(shown.getFullYear(), shown.getMonth() + months, 1));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.summary, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="calendar-outline" size={16} color={colors.inkSoft} />
        <Text style={styles.summaryText}>{readable(value)}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.inkSoft}
        />
      </Pressable>

      {open ? (
        <View style={styles.panel}>
          <View style={styles.monthRow}>
            <Pressable onPress={() => move(-1)} hitSlop={8} accessibilityLabel="Monat zurück">
              <Ionicons name="chevron-back" size={18} color={colors.ink} />
            </Pressable>
            <Text style={styles.monthName}>
              {MONTHS[shown.getMonth()]} {shown.getFullYear()}
            </Text>
            <Pressable onPress={() => move(1)} hitSlop={8} accessibilityLabel="Monat vor">
              <Ionicons name="chevron-forward" size={18} color={colors.ink} />
            </Pressable>
          </View>

          <View style={styles.week}>
            {WEEKDAYS.map((day) => (
              <Text key={day} style={styles.weekday}>
                {day}
              </Text>
            ))}
          </View>

          {monthGrid(shown.getFullYear(), shown.getMonth()).map((row, index) => (
            <View key={index} style={styles.week}>
              {row.map((day, cell) => {
                if (day === null) return <View key={cell} style={styles.day} />;
                const active = sameDay(
                  new Date(shown.getFullYear(), shown.getMonth(), day),
                  value
                );
                return (
                  <Pressable
                    key={cell}
                    onPress={() => pickDay(day)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.day, active && styles.dayActive]}
                  >
                    <Text style={[styles.dayText, active && styles.dayTextActive]}>
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.timeRow}>
            <Stepper label="Stunde" onLess={() => shift(-60)} onMore={() => shift(60)} />
            <Text style={styles.clock}>
              {uhr(value)}
            </Text>
            <Stepper label="Minute" onLess={() => shift(-15)} onMore={() => shift(15)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Zwei Knöpfe für eine Grösse – als eigenes Stück, weil es zweimal
 *  vorkommt und sonst die Lesbarkeit der Maske leidet. */
function Stepper({
  label,
  onLess,
  onMore,
}: {
  label: string;
  onLess: () => void;
  onMore: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onLess}
        hitSlop={6}
        accessibilityLabel={`${label} weniger`}
        style={({ pressed }) => [styles.step, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="remove" size={16} color={colors.ink} />
      </Pressable>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable
        onPress={onMore}
        hitSlop={6}
        accessibilityLabel={`${label} mehr`}
        style={({ pressed }) => [styles.step, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="add" size={16} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrap: { gap: 5 },
    label: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    summaryText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600' },
    panel: {
      gap: 6,
      padding: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingBottom: 2,
    },
    monthName: { color: colors.ink, fontSize: 14, fontWeight: '700' },
    week: { flexDirection: 'row' },
    weekday: {
      flex: 1,
      textAlign: 'center',
      color: colors.inkFaint,
      fontSize: 11,
      fontWeight: '700',
    },
    day: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
    dayActive: { backgroundColor: colors.accent, borderRadius: 999 },
    dayText: { color: colors.ink, fontSize: 13 },
    dayTextActive: { color: '#FFFFFF', fontWeight: '700' },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    clock: { color: colors.ink, fontSize: 20, fontWeight: '700' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    step: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.track,
    },
    stepLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '600', width: 44, textAlign: 'center' },
  });
