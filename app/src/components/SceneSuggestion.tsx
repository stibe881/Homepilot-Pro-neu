import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * «Du schaltest abends immer diese drei – als Szene sichern?»
 *
 * Der Hub sieht das Muster ohnehin im Verlauf. Was er NICHT tut: etwas
 * von selbst anlegen oder schalten. Hier steht ein Satz und daneben ein
 * Knopf – eine Hausautomation, die eigenmächtig Regeln erfindet, ist
 * genau die, der man nach dem zweiten Mal nicht mehr traut.
 *
 * Weggeklickt heisst weg: Wer den Vorschlag nicht will, soll ihn nicht
 * morgen wieder lesen. Das merkt sich das Gerät für diese Sitzung; nach
 * einem Neustart des Hubs ist der Verlauf ohnehin leer.
 */

interface Suggestion {
  hour: number;
  entity_ids: string[];
  names: string[];
  days: number;
  text: string;
}

export function SceneSuggestion({
  settings,
  onCreated,
}: {
  settings: HubSettings;
  onCreated: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [weg, setWeg] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  useEffect(() => {
    let abgebrochen = false;
    hub
      .get<{ suggestion?: Suggestion } | null>('/api/suggestions/scene', { fallback: null, still: true })
      .then((body) => {
        if (abgebrochen || !body?.suggestion) return;
        setSuggestion(body.suggestion);
        setName(
          body.suggestion.hour >= 18
            ? 'Abendlicht'
            : body.suggestion.hour < 10
              ? 'Morgens'
              : 'Mein Licht'
        );
      })
      // Ohne Vorschlag einfach kein Kärtchen - nichts fehlt.
      .catch(() => {});
    return () => {
      abgebrochen = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.url, settings.token]);

  const anlegen = async () => {
    if (!suggestion || !name.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${settings.url}/api/scenes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          name: name.trim(),
          actions: suggestion.entity_ids.map((id) => ({
            entity_id: id,
            command: 'turn_on',
          })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? 'Fehlgeschlagen');
      setNote(`«${name.trim()}» angelegt – zu finden bei den Szenen.`);
      setSuggestion(null);
      onCreated();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  if (note && !suggestion) {
    return (
      <Card style={styles.card}>
        <Text style={styles.note}>{note}</Text>
      </Card>
    );
  }
  if (!suggestion || weg) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="bulb-outline" size={18} color={colors.accent} />
        <Text style={[styles.heading, { flex: 1 }]}>Aufgefallen</Text>
        <Pressable
          onPress={() => setWeg(true)}
          hitSlop={8}
          accessibilityLabel="Vorschlag ausblenden"
        >
          <Ionicons name="close" size={18} color={colors.inkFaint} />
        </Pressable>
      </View>
      <Text style={styles.text}>{suggestion.text}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Name der Szene"
        placeholderTextColor={colors.inkFaint}
      />
      <View style={styles.buttons}>
        <Pressable onPress={() => setWeg(true)} style={styles.secondary}>
          <Text style={styles.secondaryText}>Nein danke</Text>
        </Pressable>
        <Pressable
          onPress={anlegen}
          disabled={busy || !name.trim()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            (busy || !name.trim() || pressed) && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.primaryText}>Als Szene sichern</Text>
        </Pressable>
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    text: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
    note: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    buttons: { flexDirection: 'row', gap: 8 },
    primary: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 11,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    secondary: {
      alignItems: 'center',
      paddingVertical: 11,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    secondaryText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  });
