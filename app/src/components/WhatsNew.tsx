import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * «Was ist neu» – einmal nach jedem Update, dann weggeklickt.
 *
 * Wer das Update anstösst, probiert die Neuerungen sofort aus. Alle
 * anderen im Haushalt erfahren sonst nie, dass es sie gibt. Die Liste
 * sind die Änderungs-Betreffzeilen seit dem vorherigen Stand; das
 * Weggeklickt-Sein gehört zur Person (Hub-Prefs), nicht zum Gerät –
 * einmal gelesen heisst überall gelesen.
 *
 * Als Popup und nicht als Karte in der Übersicht: Eine Karte zwischen den
 * Räumen übersieht man, und wer sie nicht wegklickt, hat sie für immer
 * dort stehen. Ein Fenster wird gelesen und ist danach weg – genau die
 * eine Aufmerksamkeit, die eine Änderungsliste verdient.
 */

export function WhatsNew({
  settings,
  seen,
  onSeen,
}: {
  settings: HubSettings;
  /** Bis zu welchem Stand die Karte schon weggeklickt wurde. */
  seen: string | undefined;
  onSeen: (commit: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [commit, setCommit] = useState<string | null>(null);
  const [changes, setChanges] = useState<string[]>([]);

  useEffect(() => {
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};
    fetch(`${settings.url}/api/system/changes`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        setCommit(typeof data.commit === 'string' ? data.commit : null);
        setChanges(Array.isArray(data.changes) ? data.changes : []);
      })
      .catch(() => {});
  }, [settings.url, settings.token]);

  // Von Hand geschlossen, ohne «Alles klar»: für diesen Besuch weg, beim
  // nächsten Start wieder da. Wegklicken heisst gelesen - und das soll
  // eine bewusste Bewegung sein, kein versehentlicher Tipp daneben.
  const [zurueckgestellt, setZurueckgestellt] = useState(false);

  const zeigen =
    !!commit &&
    commit !== 'unbekannt' &&
    changes.length > 0 &&
    seen !== commit &&
    !zurueckgestellt;

  if (!zeigen) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => setZurueckgestellt(true)}
    >
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <View style={styles.head}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
            <Text style={[styles.title, { flex: 1 }]}>Was ist neu</Text>
            <Text style={styles.commit}>Stand {commit}</Text>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
            {changes.map((line, index) => (
              <View key={index} style={styles.row}>
                <Text style={styles.bullet}>·</Text>
                <Text style={styles.line}>{line}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable
              onPress={() => setZurueckgestellt(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.buttonText}>Später</Text>
            </Pressable>
            <Pressable
              onPress={() => onSeen(commit!)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                styles.buttonPrimary,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>Alles klar</Text>
            </Pressable>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: 20,
    },
    card: { minHeight: 0, gap: 8, maxHeight: '80%' },
    // Viele Änderungen auf einmal sollen das Fenster nicht über den Rand
    // schieben - dann sieht man die Knöpfe nicht mehr.
    list: { flexGrow: 0 },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    commit: { color: colors.inkFaint, fontSize: 11 },
    row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    bullet: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    line: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, flex: 1 },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
      marginTop: 2,
    },
    buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    buttonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  });
