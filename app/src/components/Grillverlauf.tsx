/**
 * Das Diagramm des Grillabends - Garraum, Sollwert und die Fühler in
 * einem Bild (Punkt 566).
 *
 * Gewünscht im Haus: «Man soll auch bei den Fühlern und bei der
 * Grilltemperatur eine Statistik sehen mit Diagramm.» Ein Bild, nicht
 * fünf: Beim Grillen will man sehen, wie das Fleisch dem Garraum folgt
 * - die Kurven gehören übereinander, in denselben Massstab.
 *
 * Die Daten kommen aus dem Zustandsverlauf des Hubs (Supabase), wie
 * beim Sensor-Verlauf (HistoryChart). Ohne Datenbank steht ein Satz da
 * statt eines leeren Rahmens. Die Rechnung steht in lib/grillverlauf.ts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Line as SvgLine } from 'react-native-svg';

import { Entity } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import {
  GRILL_ZEITRAEUME,
  Grillkurven,
  Verlaufszeile,
  grillkurven,
  hatVerlauf,
  reihenUmschalten,
} from '../lib/grillverlauf';
import { FUEHLERFARBEN } from '../lib/grillziel';
import { Punkt, spanne } from '../lib/verlaufkurve';
import { Colors, radius, useColors } from '../theme';

export function Grillverlauf({
  entity,
  width,
  height = 160,
}: {
  entity: Entity;
  width: number;
  height?: number;
}) {
  const settings = useSettings();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [kurven, setKurven] = useState<Grillkurven | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hours, setHours] = useState(6);
  // Was in der Legende abgewählt ist (Punkt 573) - gemerkt wird, was
  // aus ist, damit ein neu eingesteckter Fühler von selbst erscheint.
  const [ausgeblendet, setAusgeblendet] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};
    setNote(null);
    // Der Grill meldet alle dreissig Sekunden - 24 Stunden sind 2880
    // Zeilen, mehr gibt der Hub ohnehin nicht her (limit 2000).
    fetch(`${settings.url}/api/entities/${entity.id}/history?hours=${hours}&limit=2000`, {
      headers,
    })
      .then(async (response) => {
        if (response.status === 503) {
          throw new Error('Kein Verlauf – im Hub ist keine Datenbank eingerichtet.');
        }
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then((data: { history?: Verlaufszeile[] }) => {
        if (cancelled) return;
        const neu = grillkurven(data.history);
        setKurven(neu);
        if (!hatVerlauf(neu)) setNote('Noch zu wenig Verlauf für eine Kurve.');
      })
      .catch((err) => {
        if (!cancelled) setNote(String(err instanceof Error ? err.message : err));
      });
    return () => {
      cancelled = true;
    };
  }, [entity.id, settings.url, settings.token, hours]);

  const zeitraeume = (
    <View style={styles.rangeRow}>
      {GRILL_ZEITRAEUME.map((range) => (
        <Text
          key={range.hours}
          onPress={() => {
            setKurven(null);
            setHours(range.hours);
          }}
          style={[styles.rangeChip, hours === range.hours && styles.rangeChipActive]}
        >
          {range.label}
        </Text>
      ))}
    </View>
  );

  if (note) {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.note}>{note}</Text>
        {zeitraeume}
      </View>
    );
  }
  if (!kurven) {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.note}>Verlauf wird geladen …</Text>
      </View>
    );
  }

  const reihen: { name: string; punkte: Punkt[]; farbe: string; gestrichelt?: boolean }[] = [
    { name: 'Garraum', punkte: kurven.temperatur, farbe: colors.accent },
    { name: 'Ziel', punkte: kurven.ziel, farbe: colors.inkFaint, gestrichelt: true },
    ...Object.entries(kurven.fuehler).map(([nummer, punkte]) => ({
      name: `P${nummer}`,
      punkte,
      farbe: FUEHLERFARBEN[nummer] ?? colors.ink,
    })),
  ].filter((reihe) => reihe.punkte.length >= 2);
  // Gezeichnet wird, was nicht abgewählt ist - und der Massstab folgt
  // dem Sichtbaren: Wer den Garraum wegnimmt, will die Fühler gross
  // sehen, nicht in der unteren Hälfte eines leeren Bilds.
  const sichtbar = reihen.filter((reihe) => !ausgeblendet.includes(reihe.name));

  // Ein Massstab für alle - sonst läge der Fühler bei 60° optisch auf
  // dem Garraum bei 120°, und genau dieser Abstand ist die Auskunft.
  const { min, max } = spanne(sichtbar.map((reihe) => reihe.punkte));
  const span = max - min;
  const pad = 8;
  const innerWidth = Math.max(width - pad * 2, 1);
  const innerHeight = height - pad * 2;
  const alle = sichtbar.flatMap((reihe) => reihe.punkte);
  const von = alle.length ? Math.min(...alle.map((punkt) => punkt.at)) : 0;
  const bis = alle.length ? Math.max(...alle.map((punkt) => punkt.at)) : 1;
  const dauer = Math.max(1, bis - von);
  const x = (at: number) => pad + ((at - von) / dauer) * innerWidth;
  const y = (value: number) => pad + innerHeight - ((value - min) / span) * innerHeight;
  const pfadVon = (reihe: Punkt[]) =>
    reihe
      .map((punkt, index) => `${index === 0 ? 'M' : 'L'} ${x(punkt.at)} ${y(punkt.value)}`)
      .join(' ');
  const einheit = String(entity.state.unit ?? '°');

  return (
    <View
      style={styles.wrapper}
      accessibilityLabel={`Verlauf: ${sichtbar.map((r) => r.name).join(', ') || 'alles ausgeblendet'}`}
    >
      <Svg width={width} height={height}>
        <SvgLine
          x1={pad}
          y1={pad + innerHeight / 2}
          x2={width - pad}
          y2={pad + innerHeight / 2}
          stroke={colors.track}
          strokeWidth={1}
        />
        {sichtbar.map((reihe) => (
          <Path
            key={reihe.name}
            d={pfadVon(reihe.punkte)}
            stroke={reihe.farbe}
            strokeWidth={reihe.gestrichelt ? 1.5 : 2}
            strokeDasharray={reihe.gestrichelt ? '4 4' : undefined}
            fill="none"
          />
        ))}
      </Svg>
      <View style={styles.fuss}>
        <View style={styles.legende}>
          {/* Die Legende ist der Schalter (Punkt 573): ein Tipp blendet
              die Reihe aus, der nächste wieder ein. Abgewählt: blass
              und durchgestrichen, damit man sieht, dass sie da wäre. */}
          {reihen.map((reihe) => {
            const aus = ausgeblendet.includes(reihe.name);
            return (
              <Pressable
                key={reihe.name}
                onPress={() => setAusgeblendet((vorher) => reihenUmschalten(vorher, reihe.name))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !aus }}
                accessibilityLabel={`${reihe.name} im Verlauf`}
                hitSlop={6}
                style={({ pressed }) => [styles.legendeEintrag, pressed && { opacity: 0.6 }]}
              >
                <View
                  style={[
                    styles.legendeFarbe,
                    { backgroundColor: reihe.farbe },
                    aus && { opacity: 0.3 },
                  ]}
                />
                <Text style={[styles.legendeText, aus && styles.legendeAus]}>{reihe.name}</Text>
              </Pressable>
            );
          })}
          <Text style={styles.legendeText}>
            {Math.round(min)}–{Math.round(max)}
            {einheit}
          </Text>
        </View>
        {zeitraeume}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrapper: {
      width: '100%',
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      paddingBottom: 6,
    },
    note: { color: colors.inkSoft, fontSize: 12, padding: 10 },
    fuss: { gap: 6, paddingHorizontal: 8 },
    legende: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
    legendeEintrag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendeFarbe: { width: 10, height: 3, borderRadius: 2 },
    legendeText: { color: colors.inkSoft, fontSize: 11 },
    legendeAus: { color: colors.inkFaint, textDecorationLine: 'line-through' },
    rangeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingBottom: 4 },
    rangeChip: {
      color: colors.inkSoft,
      fontSize: 12,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    rangeChipActive: { color: colors.ink, backgroundColor: colors.accentSoft },
  });
