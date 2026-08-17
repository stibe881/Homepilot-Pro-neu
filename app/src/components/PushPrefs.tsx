import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, type, useColors } from '../theme';

/**
 * Welche Push-Nachrichten dieser Benutzer bekommen will.
 *
 * Je Person, nicht global: Wen die schwache Batterie im Keller nicht
 * interessiert, der soll deswegen nicht den Alarm mit abschalten. Und
 * bewusst als «abbestellen» statt «bestellen» – eine neue Nachrichtenart
 * kommt damit erst einmal an, statt unbemerkt zu fehlen.
 */

interface Category {
  key: string;
  label: string;
}

export function PushPrefs({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  const load = useCallback(() => {
    fetch(`${settings.url}/api/push/categories`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setCategories(data.categories ?? []);
        setMuted(data.muted ?? []);
      })
      .catch((err) => setError(String(err.message ?? err)));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  const toggle = async (key: string) => {
    const next = muted.includes(key)
      ? muted.filter((entry) => entry !== key)
      : [...muted, key];
    // Sofort umschalten, damit das Antippen nicht hakt; der Hub bestätigt.
    setMuted(next);
    try {
      const response = await fetch(`${settings.url}/api/push/categories`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: next }),
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const data = await response.json();
      setMuted(data.muted ?? next);
    } catch (err: any) {
      setError(String(err.message ?? err));
      load();
    }
  };

  if (error) {
    return (
      <Card style={styles.card}>
        <Text style={styles.heading}>Benachrichtigungen</Text>
        <Text style={styles.hint}>Nicht abrufbar: {error}</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Benachrichtigungen</Text>
      <Text style={styles.hint}>
        Gilt nur für dich – andere im Haushalt stellen es für sich ein. Der
        Push-Test kommt immer an, auch wenn hier alles aus ist.
      </Text>
      {categories == null ? (
        <Text style={styles.hint}>Wird geladen …</Text>
      ) : (
        categories.map((category) => {
          const on = !muted.includes(category.key);
          return (
            <Pressable
              key={category.key}
              onPress={() => toggle(category.key)}
              accessibilityRole="switch"
              accessibilityState={{ checked: on }}
              style={styles.row}
            >
              <Ionicons
                name={on ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={on ? colors.on : colors.inkFaint}
              />
              <Text style={[styles.rowTitle, !on && { color: colors.inkFaint }]}>
                {category.label}
              </Text>
            </Pressable>
          );
        })
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
  });
