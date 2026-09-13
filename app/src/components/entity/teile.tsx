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
      <Text style={[styles.value, on && { color: colors.onInk }]}>{value}</Text>
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
      <Text style={[styles.pillText, { color: pillSchrift(colors, color, !!solid) }]}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Die Schriftfarbe einer Pille (rein, testbar) - Punkt 609 der Werkbank.
 *
 * Der Ton kommt vom Aufrufer als Signalfarbe (`on`, `warn`, `danger`,
 * `accent`), und die ist am Rand der Pille richtig: Dort trägt die Form
 * die Bedeutung. Als *Schrift* trägt sie nicht - «Online» in Grün kam
 * auf einer Karte im Hellen auf 1,7:1 -, deshalb bekommt der Text die
 * Tinte derselben Farbe (`onInk`, `warnInk`), wie es Punkt 442 für
 * Orange eingeführt hat. Gefüllt stand fest Weiss darauf: auf Grün und
 * Orange nirgends lesbar («Geöffnet», «Bewegung»), auf dem hellen
 * Akzent der dunklen Bilder auch nicht - jetzt die Gegenfarbe der
 * Palette (`onSignal`, `onAccent`).
 */
export function pillSchrift(colors: Colors, ton: string, solid: boolean): string {
  if (solid) return ton === colors.on || ton === colors.warn ? colors.onSignal : colors.onAccent;
  if (ton === colors.on) return colors.onInk;
  if (ton === colors.warn) return colors.warnInk;
  return ton;
}

/** Werte, die «noch nichts» heissen – und nicht so aussehen sollen. */
const OHNE_WERT = new Set(['unknown', 'unavailable', 'none', 'null', '']);

export function format(value: unknown): string {
  if (typeof value === 'number') {
    return String(Math.round(value * 10) / 10);
  }
  // `unknown` ist kein Messwert, sondern der Platzhalter, den der Hub
  // setzt, bis das Gerät sich zum ersten Mal meldet
  // (integrations/zigbee2mqtt.py). Auf vier frisch angelernten
  // Klimafühlern stand dadurch in grossen Buchstaben «unknown» - ein
  // englisches Wort aus dem Inneren, das aussieht wie ein Defekt.
  //
  // Ein echter Fehlerwert («error») steht weiterhin da: Der ist die
  // Wahrheit, und man kann danach suchen. Übersetzt wird nur, was
  // ausdrücklich «noch keine Messung» bedeutet.
  const text = String(value ?? '–');
  return OHNE_WERT.has(text.trim().toLowerCase()) ? '–' : text;
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

