import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Durchsage: «Essen ist fertig» auf die Cast-Boxen im Haus.
 *
 * Der Hub macht aus dem Text eine Sprachdatei und lässt sie die Boxen
 * abspielen – ohne Auswahl gehen alle, sonst nur die angetippten.
 */

export function Broadcast({
  settings,
  entities,
}: {
  settings: HubSettings;
  entities: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const speakers = entities.filter(
    (entity) => entity.commands.includes('play_url') && entity.available
  );
  if (speakers.length === 0) return null;

  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`${settings.url}/api/broadcast`, {
        method: 'POST',
        headers: {
          ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text.trim(), speakers: picked }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      const errors: string[] = body.errors ?? [];
      setNote(
        `Läuft auf ${(body.sent ?? []).join(', ') || 'keiner Box'}.` +
          (errors.length > 0 ? ` Nicht erreicht: ${errors.join(' · ')}` : '')
      );
      setText('');
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Durchsage</Text>
      <Text style={styles.hint}>
        Der Text wird vorgelesen – ohne Auswahl auf allen Boxen.
      </Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Essen ist fertig!"
          placeholderTextColor={colors.inkFaint}
          maxLength={200}
          onSubmitEditing={() => text.trim() && !busy && send()}
        />
        <Pressable
          onPress={send}
          disabled={busy || !text.trim()}
          accessibilityRole="button"
          accessibilityLabel="Durchsage senden"
          style={({ pressed }) => [
            styles.send,
            (pressed || busy || !text.trim()) && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="megaphone-outline" size={18} color="#FFFFFF" />
        </Pressable>
      </View>
      {speakers.length > 1 ? (
        <View style={styles.chips}>
          {speakers.map((speaker) => {
            const active = picked.includes(speaker.id);
            return (
              <Pressable
                key={speaker.id}
                onPress={() =>
                  setPicked((prev) =>
                    active
                      ? prev.filter((id) => id !== speaker.id)
                      : [...prev, speaker.id]
                  )
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {speaker.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {note ? <Text style={styles.hint}>{note}</Text> : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 8 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
      flex: 1,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
  });
