import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { lampenNachStromausfall, stromausfallSatz } from '../lib/einschaltverhalten';
import { Colors, radius, type, useColors } from '../theme';

import { Card } from './Card';

/**
 * «Nach Stromausfall» unter System (Punkt 630 der Werkbank).
 *
 * Der Auslöser «Nach Stromausfall» räumt auf, wenn das Haus nach einem
 * Ausfall in vollem Licht steht. Diese Karte setzt eine Stufe früher
 * an: Ein Knopf stellt alle Lampen, die es können, auf «wie vorher» -
 * dann bleibt um drei Uhr nachts dunkel, was dunkel war. Darunter
 * steht, welche Lampen der Hub nicht einstellen kann; bei denen führt
 * der Weg weiter über die App des Herstellers.
 *
 * Ein Befehl je Lampe, nacheinander: Die Einstellung reist bei Zigbee
 * und Homematic über Funk ins Gerät, und ein Schwall von zwanzig
 * gleichzeitigen Aufträgen ist genau das, was der Sendespeicher der
 * CCU nicht mag.
 */
export function StromausfallCard({
  entities,
  settings,
}: {
  entities: Entity[];
  settings: HubSettings;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [zeigeListe, setZeigeListe] = useState(false);
  const { stellbar, umzustellen, koennenNicht } = useMemo(
    () => lampenNachStromausfall(entities),
    [entities]
  );

  // Ohne Lampen keine Karte - eine Überschrift über nichts.
  if (stellbar.length + koennenNicht.length === 0) return null;

  const alleAufVorher = async () => {
    if (laeuft || umzustellen.length === 0) return;
    setLaeuft(true);
    setErgebnis(null);
    const hub = hubClient(settings.url, settings.token);
    const fehler: string[] = [];
    for (const lampe of umzustellen) {
      try {
        await hub.post(
          `/api/entities/${encodeURIComponent(lampe.id)}/command`,
          { command: 'set_power_on', data: { mode: 'previous' } },
          { still: true }
        );
      } catch (err) {
        fehler.push(`${lampe.name}: ${err instanceof Error ? err.message : 'abgelehnt'}`);
      }
    }
    const geschafft = umzustellen.length - fehler.length;
    setErgebnis(
      fehler.length === 0
        ? `${geschafft} ${geschafft === 1 ? 'Lampe' : 'Lampen'} auf «wie vorher» gestellt.`
        : `${geschafft} umgestellt, ${fehler.length} nicht: ${fehler.join(' · ')}`
    );
    setLaeuft(false);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.kopf}>
        <Ionicons name="flash-off-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.heading}>Nach Stromausfall</Text>
      </View>
      <Text style={styles.satz}>{stromausfallSatz(stellbar.length, umzustellen.length)}</Text>
      {umzustellen.length > 0 ? (
        <Pressable
          onPress={alleAufVorher}
          disabled={laeuft}
          accessibilityRole="button"
          style={({ pressed }) => [styles.knopf, (pressed || laeuft) && { opacity: 0.6 }]}
        >
          <Text style={styles.knopfText}>
            {laeuft ? 'Wird gestellt …' : 'Alle Lampen auf «wie vorher» stellen'}
          </Text>
        </Pressable>
      ) : null}
      {ergebnis ? <Text style={styles.hinweis}>{ergebnis}</Text> : null}
      {koennenNicht.length > 0 ? (
        <>
          <Pressable
            onPress={() => setZeigeListe((offen) => !offen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: zeigeListe }}
            style={styles.zeile}
          >
            <Text style={[styles.hinweis, { flex: 1 }]}>
              {koennenNicht.length === 1
                ? '1 Lampe kann der Hub nicht einstellen'
                : `${koennenNicht.length} Lampen kann der Hub nicht einstellen`}
              {' – dort gilt die App des Herstellers.'}
            </Text>
            <Ionicons
              name={zeigeListe ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.inkFaint}
            />
          </Pressable>
          {zeigeListe
            ? koennenNicht.map((lampe) => (
                <Text key={lampe.id} style={styles.eintrag}>
                  {lampe.name}
                  {lampe.room ? ` · ${lampe.room}` : ''} · {lampe.integration}
                </Text>
              ))
            : null}
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    satz: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
    hinweis: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    zeile: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    eintrag: { color: colors.inkSoft, fontSize: 13, paddingLeft: 12 },
    knopf: {
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  });
