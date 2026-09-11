import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { datumUhr } from '../lib/format';
import { Meldung, sortiert } from '../lib/posteingang';
import { verpasstsatz } from '../lib/pushruhe';
import { Colors, icon, radius, space, type, useColors } from '../theme';

/**
 * Der Posteingang (Punkt 435) - hinter der Glocke auf der Startseite.
 *
 * «Zuletzt gemeldet» in den Push-Einstellungen gab es schon, drei
 * Tipps tief und ohne Unterschied zwischen «ich habe es übersehen» und
 * «das Haus hat es für sich behalten». Hier steht das Zweite zuerst:
 * die Meldungen, die in der Nacht, während etwas stillgestellt war oder
 * über dem Tagesdeckel nie gebrummt haben - die Liste, die man am
 * Morgen durchgeht. Darunter, zum Nachschlagen, der Rest der Woche.
 */
export function Posteingang({
  settings,
  onSchliessen,
}: {
  settings: HubSettings;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [meldungen, setMeldungen] = useState<Meldung[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    hubClient(settings.url, settings.token)
      .get<{ log?: Meldung[] } | null>('/api/push/log', { fallback: null, still: true })
      .then((antwort) => setMeldungen(antwort?.log ?? []))
      .catch((err) => setFehler(String(err instanceof Error ? err.message : err)));
  }, [settings.url, settings.token]);

  const { zurueckgehalten, uebrige } = sortiert(meldungen ?? []);

  const zeile = (eintrag: Meldung, index: number) => (
    <View key={`${eintrag.at}-${index}`} style={styles.zeile}>
      <Text style={styles.zeit}>{datumUhr(eintrag.at * 1000)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.titel} numberOfLines={2}>
          {eintrag.title}
        </Text>
        {eintrag.body ? (
          <Text style={styles.text} numberOfLines={3}>
            {eintrag.body}
          </Text>
        ) : null}
        {eintrag.verpasst ? (
          <Text style={styles.grund}>{verpasstsatz(eintrag.held)}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onSchliessen}>
      <Pressable style={styles.grund_} onPress={onSchliessen} accessibilityLabel="Schliessen">
        <Pressable style={styles.blatt} onPress={() => {}}>
          <View style={styles.kopf}>
            <Ionicons name="notifications-outline" size={icon.mittel} color={colors.ink} />
            <Text style={styles.ueberschrift}>Posteingang</Text>
            <Pressable onPress={onSchliessen} hitSlop={10} accessibilityRole="button" accessibilityLabel="Schliessen">
              <Ionicons name="close" size={icon.gross} color={colors.inkSoft} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
            {fehler ? (
              <Text style={styles.text}>Nicht abrufbar: {fehler}</Text>
            ) : meldungen == null ? (
              <Text style={styles.text}>Wird geladen …</Text>
            ) : (
              <>
                <Text style={styles.abschnitt}>Für dich zurückgehalten</Text>
                {zurueckgehalten.length === 0 ? (
                  <Text style={styles.text}>
                    Nichts – was das Haus gemeldet hat, hat auch gebrummt.
                  </Text>
                ) : (
                  zurueckgehalten.map(zeile)
                )}
                <Text style={styles.abschnitt}>Die letzten Tage</Text>
                {uebrige.length === 0 ? (
                  <Text style={styles.text}>In den letzten Tagen kam nichts.</Text>
                ) : (
                  uebrige.slice(0, 30).map(zeile)
                )}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    grund_: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: space.gap,
    },
    blatt: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 520,
      backgroundColor: colors.panel,
      borderRadius: radius.card,
      padding: space.gap,
      gap: 8,
    },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    ueberschrift: { flex: 1, color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    abschnitt: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 10,
      marginBottom: 4,
    },
    zeile: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
    zeit: { color: colors.inkFaint, fontSize: 12, minWidth: 96, paddingTop: 2 },
    titel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    text: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
    grund: { color: colors.warn, fontSize: 12, lineHeight: 17, marginTop: 2 },
  });
