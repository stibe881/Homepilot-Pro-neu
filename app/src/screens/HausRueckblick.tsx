/**
 * «Was war heute los?» – der Rückblick über alle Geräte.
 *
 * Der Verlauf je Gerät beantwortet «warum ging *das* an?». Diese Frage
 * ist eine andere, und sie liess sich bisher nur beantworten, indem man
 * jede Kachel einzeln aufmachte.
 *
 * Gerechnet wird in lib/hausrueckblick.ts; hier steht nur, wie es
 * aussieht.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Fehlschlag, Laedt, Leer } from '../components/Zustand';
import {
  GeraetAngabe,
  HausEreignis,
  artName,
  hausAbschnitte,
  vorhandeneArten,
} from '../lib/hausrueckblick';
import { LogSpan, reichweiteText } from '../lib/verlauf';
import { Colors, radius, type, useColors } from '../theme';

/** Wie weit zurück man schauen kann. */
const FENSTER = [
  { key: 24, label: '24 Std.' },
  { key: 72, label: '3 Tage' },
  { key: 168, label: '1 Woche' },
];

export function HausRueckblick({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);

  const [stunden, setStunden] = useState(24);
  const [ereignisse, setEreignisse] = useState<HausEreignis[] | null>(null);
  const [geraete, setGeraete] = useState<Record<string, GeraetAngabe>>({});
  const [span, setSpan] = useState<LogSpan | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [art, setArt] = useState<string | null>(null);

  const laden = useCallback(() => {
    setEreignisse(null);
    hub
      .get<{
        events?: HausEreignis[];
        devices?: Record<string, GeraetAngabe>;
        log?: LogSpan;
      } | null>(`/api/log?hours=${stunden}`, { fallback: null, still: true })
      .then((daten) => {
        if (daten === null) {
          setFehler('Der Hub antwortet gerade nicht.');
          setEreignisse([]);
          return;
        }
        setFehler(null);
        setEreignisse(daten.events ?? []);
        setGeraete(daten.devices ?? {});
        setSpan(daten.log ?? null);
      });
  }, [hub, stunden]);

  useEffect(laden, [laden]);

  const abschnitte = useMemo(
    () => hausAbschnitte(ereignisse ?? [], geraete),
    [ereignisse, geraete],
  );
  const arten = useMemo(
    () => vorhandeneArten(abschnitte.flatMap((a) => a.zeilen)),
    [abschnitte],
  );
  const gefiltert = useMemo(
    () =>
      art === null
        ? abschnitte
        : abschnitte
            .map((abschnitt) => ({
              ...abschnitt,
              zeilen: abschnitt.zeilen.filter((zeile) => zeile.kind === art),
            }))
            // Ein Tag ohne passende Zeile braucht keine Überschrift.
            .filter((abschnitt) => abschnitt.zeilen.length > 0),
    [abschnitte, art],
  );

  return (
    <Card>
      <View style={styles.kopf}>
        <Ionicons name="time-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.titel}>Was war los</Text>
        <Pressable
          onPress={laden}
          accessibilityRole="button"
          accessibilityLabel="Neu laden"
          hitSlop={8}
        >
          <Ionicons name="refresh" size={18} color={colors.inkSoft} />
        </Pressable>
      </View>

      <View style={styles.chips}>
        {FENSTER.map((eintrag) => (
          <Pressable
            key={eintrag.key}
            onPress={() => setStunden(eintrag.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: stunden === eintrag.key }}
            style={({ pressed }) => [
              styles.chip,
              stunden === eintrag.key && styles.chipAn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[styles.chipText, stunden === eintrag.key && styles.chipTextAn]}
            >
              {eintrag.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {arten.length > 1 ? (
        <View style={styles.chips}>
          <Pressable
            onPress={() => setArt(null)}
            accessibilityRole="radio"
            accessibilityState={{ selected: art === null }}
            style={({ pressed }) => [
              styles.chip,
              art === null && styles.chipAn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.chipText, art === null && styles.chipTextAn]}>Alles</Text>
          </Pressable>
          {arten.map((kind) => (
            <Pressable
              key={kind}
              onPress={() => setArt(art === kind ? null : kind)}
              accessibilityRole="radio"
              accessibilityState={{ selected: art === kind }}
              style={({ pressed }) => [
                styles.chip,
                art === kind && styles.chipAn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.chipText, art === kind && styles.chipTextAn]}>
                {artName(kind)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {fehler ? <Fehlschlag text={fehler} /> : null}
      {ereignisse === null && !fehler ? <Laedt was="Rückblick" klein /> : null}
      {ereignisse !== null && gefiltert.length === 0 && !fehler ? (
        <Leer
          icon="time-outline"
          titel="Nichts aufgezeichnet"
          hinweis={
            reichweiteText(span) ||
            'Sobald im Haus etwas schaltet, steht es hier – der Verlauf übersteht Neustarts und Updates.'
          }
        />
      ) : null}

      <ScrollView style={{ maxHeight: 520 }}>
        {gefiltert.map((abschnitt) => (
          <View key={abschnitt.titel}>
            <Text style={styles.tag}>{abschnitt.titel}</Text>
            {abschnitt.zeilen.map((zeile) => (
              <View key={zeile.key} style={styles.zeile}>
                <Text style={styles.uhr}>{uhrzeit(zeile.at)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wer} numberOfLines={1}>
                    {zeile.wer}
                  </Text>
                  <Text style={styles.was} numberOfLines={1}>
                    {zeile.was}
                    {zeile.detail ? ` · ${zeile.detail}` : ''} · {zeile.quelle}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      {ereignisse !== null && ereignisse.length > 0 ? (
        <Text style={styles.hinweis}>{reichweiteText(span)}</Text>
      ) : null}
    </Card>
  );
}

/** Nur die Uhrzeit – das Datum steht im Abschnittstitel. */
function uhrzeit(at: number): string {
  if (!at || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700', flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    chip: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    chipAn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    chipTextAn: { color: '#FFFFFF' },
    tag: {
      color: colors.inkFaint,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      marginTop: 12,
      marginBottom: 2,
    },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 7,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    uhr: {
      color: colors.inkSoft,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      width: 48,
    },
    wer: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    was: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    hinweis: { color: colors.inkFaint, fontSize: 11, marginTop: 8, lineHeight: 16 },
  });
