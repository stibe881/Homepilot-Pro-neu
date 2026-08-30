import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
  Line as SvgLine,
} from 'react-native-svg';

import { Entity, EntityState } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import { Colors, radius, useColors } from '../theme';
import {
  Punkt,
  flaeche,
  spanne,
  teile,
  vergleich,
  verschiebe,
  wovon,
} from '../lib/verlaufkurve';

/** Wählbare Zeiträume: Tag, Woche, Monat. */
const RANGES: { hours: number; label: string }[] = [
  { hours: 24, label: '24 h' },
  { hours: 24 * 7, label: '7 Tage' },
  { hours: 24 * 30, label: '30 Tage' },
];

/**
 * Verlauf eines Sensors – und die Antwort auf «mehr oder weniger als sonst?».
 *
 * Die Daten kommen über den Hub aus Supabase – ohne Datenbank antwortet er
 * mit 503, und statt eines leeren Rahmens steht dann ein erklärender Satz.
 *
 * Geholt wird der **doppelte** Zeitraum: Die ältere Hälfte liegt als
 * blasse Linie dahinter, und darunter steht in einem Satz, wie sich die
 * beiden unterscheiden. Das kostet keinen zweiten Abruf und keine neue
 * Schnittstelle - der Hub kennt nur «die letzten n Stunden»
 * (lib/verlaufkurve.ts).
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
  const [points, setPunkts] = useState<Punkt[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  useEffect(() => {
    let cancelled = false;
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};

    setNote(null);
    // Der doppelte Zeitraum, damit die Hälfte davor als Vergleich
    // dienen kann - und mehr Punkte, damit beide Hälften noch Auflösung
    // haben.
    fetch(
      `${settings.url}/api/entities/${entity.id}/history?hours=${hours * 2}&limit=1000`,
      { headers }
    )
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
        const parsed: Punkt[] = (data.history ?? [])
          .map((row: { recorded_at: string; state?: EntityState }) => ({
            at: new Date(row.recorded_at).getTime(),
            value: Number(row.state?.state),
          }))
          .filter((point: Punkt) => Number.isFinite(point.value))
          .sort((a: Punkt, b: Punkt) => a.at - b.at);
        setPunkts(parsed);
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
                setPunkts(null);
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

  // Die jüngere Hälfte ist die Kurve, die ältere der Vergleich - über
  // sie gelegt, damit man Montag mit Montag vergleicht.
  const jetzt = points[points.length - 1]?.at ?? Date.now();
  const geteilt = teile(points, hours, jetzt);
  const kurve = geteilt.jetzt.length >= 2 ? geteilt.jetzt : points;
  const davor = geteilt.jetzt.length >= 2 ? verschiebe(geteilt.davor, hours) : [];
  const { min, max } = spanne([kurve, davor]);
  const span = max - min;
  const pad = 8;
  const innerWidth = Math.max(width - pad * 2, 1);
  const innerHeight = height - pad * 2;

  // Über die Zeit und nicht über den Listenplatz: Sonst zöge eine Nacht
  // ohne Messwerte die Kurve seitlich auseinander, und die beiden
  // Hälften lägen nicht mehr übereinander.
  const von = kurve[0]?.at ?? jetzt - hours * 3600_000;
  const bis = kurve[kurve.length - 1]?.at ?? jetzt;
  const dauer = Math.max(1, bis - von);
  const x = (at: number) => pad + ((at - von) / dauer) * innerWidth;
  const y = (value: number) => pad + innerHeight - ((value - min) / span) * innerHeight;
  const pfadVon = (reihe: Punkt[]) =>
    reihe
      .map((punkt, index) => `${index === 0 ? 'M' : 'L'} ${x(punkt.at)} ${y(punkt.value)}`)
      .join(' ');

  // Schmale Kachel oder breite Seite? Danach entscheidet sich, wie viel
  // unter die Kurve passt.
  const eng = width < 230;
  const path = pfadVon(kurve);
  const boden = pad + innerHeight;
  const flaechenPfad = flaeche(path, x(von), x(bis), boden);
  const satz = vergleich(geteilt.jetzt, geteilt.davor, wovon(hours));
  const last = kurve[kurve.length - 1];

  return (
    <View style={styles.wrapper}>
      <Svg width={width} height={height}>
        <Defs>
          {/* Die Fläche unter der Kurve sagt dasselbe wie die Linie -
              aber sie sagt es auch aus dem Augenwinkel: Man sieht die
              Menge, nicht nur den Verlauf. Nach unten aus, damit sie
              die Grundlinie nicht zur zweiten Kurve macht. */}
          <LinearGradient id="verlaufFlaeche" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.28} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <SvgLine
          x1={pad}
          y1={pad + innerHeight / 2}
          x2={width - pad}
          y2={pad + innerHeight / 2}
          stroke={colors.track}
          strokeWidth={1}
        />
        {/* Der Zeitraum davor, blass dahinter: die Antwort auf «mehr
            oder weniger als sonst?». Gestrichelt, damit man sie auch
            ohne Farbunterschied auseinanderhält. */}
        {davor.length >= 2 ? (
          <Path
            d={pfadVon(davor)}
            stroke={colors.inkFaint}
            strokeWidth={1.5}
            strokeDasharray="3 4"
            opacity={0.55}
            fill="none"
          />
        ) : null}
        <Path d={flaechenPfad} fill="url(#verlaufFlaeche)" />
        <Path d={path} stroke={colors.accent} strokeWidth={2} fill="none" />
        {/* Der aktuelle Wert bekommt einen Punkt – das Ende der Kurve ist
            die Zahl, die einen interessiert. Der helle Ring darum hebt
            ihn auch dann ab, wenn die Kurve dort dicht liegt. */}
        <Circle
          cx={x(last.at)}
          cy={y(last.value)}
          r={6}
          fill={colors.accent}
          opacity={0.25}
        />
        <Circle cx={x(last.at)} cy={y(last.value)} r={3.5} fill={colors.accent} />
      </Svg>
      {/* Der Vergleich steht auf einer eigenen Zeile: neben den
          Zeitraum-Knöpfen drängte er sie über den Kachelrand hinaus und
          brach selbst über vier Zeilen um. */}
      {satz ? (
        <Text style={styles.vergleich} numberOfLines={2}>
          {satz}
        </Text>
      ) : null}
      <View style={[styles.scale, eng && styles.scaleEng]}>
        {/* Auf einer schmalen Kachel ist für die Spanne kein Platz - und
            sie ist die weniger wichtige der beiden Angaben: Wie hoch und
            wie tief, sieht man an der Kurve. */}
        {eng ? null : (
          <Text style={styles.scaleText} numberOfLines={1}>
            {round(min)}–{round(max)} {entity.state.unit ?? ''}
          </Text>
        )}
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
      alignItems: 'center',
      paddingHorizontal: 10,
    },
    scaleEng: { justifyContent: 'flex-start' },
    scaleText: { color: colors.inkFaint, fontSize: 11 },
    /** Die Antwort auf «mehr oder weniger als sonst?» - die eine Zeile,
     *  wegen der man überhaupt hinschaut. Darum kräftiger als die
     *  Spanne darunter. */
    vergleich: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 10,
      paddingBottom: 2,
    },
    // Umbrechend: Drei Knöpfe passen auf einer schmalen Kachel nicht in
    // eine Zeile, und über den Rand hinausragen ist keine Lösung.
    rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 1 },
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
