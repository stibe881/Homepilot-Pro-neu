import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from './Card';
import { Entity } from '../api/types';
import {
  aufnahmeAktionen,
  aufnahmeSatz,
  aufnehmbar,
  namensvorschlag,
} from '../lib/raumszene';
import { Colors, radius, type, useColors } from '../theme';

/**
 * «So wie jetzt» – der Knopf, der ein Zimmer zur Szene macht.
 *
 * Er steht im Raum und nicht bei den Abläufen, und das ist der ganze
 * Punkt: Die Stimmung, die man festhalten will, steht gerade im
 * Zimmer. Wer dafür erst zu den Abläufen wechselt, hat unterwegs
 * niemanden, der die Werte für ihn festhält – und den Schnappschuss
 * dort nimmt ohnehin das ganze Haus auf.
 *
 * Was aufgenommen würde, steht vorher da. Ein Knopf, der ungesehen
 * zwölf Geräte einsammelt, ist einer, dem man beim zweiten Mal nicht
 * mehr traut.
 */
export function SzeneAufnehmen({
  room,
  items,
  onSpeichern,
  onSchliessen,
}: {
  room: string;
  /** Die Geräte dieses Raums – gefiltert wird in lib/raumszene.ts. */
  items: Entity[];
  /** Legt die Szene an; wirft, wenn es schiefgeht. */
  onSpeichern: (name: string, aktionen: ReturnType<typeof aufnahmeAktionen>) => Promise<void>;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(() => namensvorschlag(room));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const dabei = aufnehmbar(items);
  const satz = aufnahmeSatz(items);

  const sichern = async () => {
    const sauber = name.trim();
    if (!sauber || dabei.length === 0) return;
    setBusy(true);
    setFehler(null);
    try {
      await onSpeichern(sauber, aufnahmeAktionen(items));
      onSchliessen();
    } catch (err) {
      setFehler(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.kopf}>
        <Ionicons name="camera-outline" size={18} color={colors.accent} />
        <Text style={[styles.titel, { flex: 1 }]}>Szene aufnehmen</Text>
        <Pressable
          onPress={onSchliessen}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Aufnahme abbrechen"
        >
          <Ionicons name="close" size={18} color={colors.inkFaint} />
        </Pressable>
      </View>
      <Text style={styles.text}>
        {dabei.length > 0
          ? `Festgehalten wird, wie ${room} gerade eingestellt ist: ${satz}.`
          : satz}
      </Text>
      {dabei.length > 0 ? (
        <>
          <TextInput
            style={styles.feld}
            value={name}
            onChangeText={setName}
            placeholder="Name der Szene"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Name der Szene"
          />
          <Pressable
            onPress={sichern}
            disabled={busy || !name.trim()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.knopf,
              (busy || !name.trim() || pressed) && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.knopfText}>
              {busy ? 'Wird angelegt …' : 'Als Szene sichern'}
            </Text>
          </Pressable>
        </>
      ) : null}
      {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    text: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
    feld: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    knopf: {
      alignItems: 'center',
      paddingVertical: 11,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    knopfText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    fehler: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  });
