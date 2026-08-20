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

/** Die Kategorien nach dem sortiert, worum es geht.

    Eine Liste von dreizehn gleichen Zeilen beantwortet die eigentliche
    Frage nicht: «Was weckt mich nachts, was ist bloss Betrieb?» Die
    Reihenfolge innerhalb der Gruppen kommt vom Hub; hier steht nur, was
    zusammengehört. Unbekannte Schlüssel landen unter «Weiteres», damit
    eine neue Kategorie nie unsichtbar ist. */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Sicherheit', keys: ['alarm', 'alarm_arming', 'open', 'leak'] },
  { title: 'Haushalt', keys: ['appliance', 'tasks', 'automation', 'frost'] },
  { title: 'Betrieb', keys: ['outage', 'device_down', 'battery', 'disk'] },
];

export function groupCategories(
  categories: Category[]
): { title: string; items: Category[] }[] {
  const known = new Set(GROUPS.flatMap((group) => group.keys));
  const sections = GROUPS.map((group) => ({
    title: group.title,
    items: categories.filter((category) => group.keys.includes(category.key)),
  }));
  // «test» absichtlich nirgends: Der Test kommt immer an, ein Schalter
  // dafür wäre eine Attrappe.
  const rest = categories.filter(
    (category) => !known.has(category.key) && category.key !== 'test'
  );
  if (rest.length > 0) sections.push({ title: 'Weiteres', items: rest });
  return sections.filter((section) => section.items.length > 0);
}

export function PushPrefs({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Der Test gehört zu den Benachrichtigungen - wer hier einstellt, will
  // gleich wissen, ob überhaupt etwas ankommt, ohne zum System-Screen zu
  // wechseln.
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

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

  const runTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      const response = await fetch(`${settings.url}/api/push/test`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const data = await response.json();
      const problems: string[] = Array.isArray(data.errors) ? data.errors : [];
      if (problems.length > 0) {
        setTestNote(problems.join(' '));
      } else if (Number(data.sent ?? 0) > 0) {
        setTestNote(`Zugestellt an ${data.sent} Gerät(e).`);
      } else {
        setTestNote('Kein Gerät angemeldet – die App auf dem Telefon einmal öffnen.');
      }
    } catch (err: any) {
      setTestNote(String(err.message ?? err));
    } finally {
      setTesting(false);
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
      <View style={styles.headRow}>
        <Text style={styles.hint}>
          Gilt nur für dich – andere im Haushalt stellen es für sich ein.
        </Text>
        <Pressable
          onPress={runTest}
          disabled={testing}
          accessibilityRole="button"
          style={({ pressed }) => [styles.testButton, (pressed || testing) && { opacity: 0.7 }]}
        >
          <Ionicons name="paper-plane-outline" size={14} color={colors.ink} />
          <Text style={styles.testText}>{testing ? 'Sendet …' : 'Push testen'}</Text>
        </Pressable>
      </View>
      {testNote ? <Text style={styles.hint}>{testNote}</Text> : null}

      {categories == null ? (
        <Text style={styles.hint}>Wird geladen …</Text>
      ) : (
        groupCategories(categories).map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {/* flexWrap: Auf dem Telefon eine Spalte, auf dem breiten
                Schirm zwei bis drei - dieselbe Liste, ohne Sonderfall. */}
            <View style={styles.sectionRows}>
              {section.items.map((category) => {
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
                      size={20}
                      color={on ? colors.on : colors.inkFaint}
                    />
                    <Text
                      style={[styles.rowTitle, !on && { color: colors.inkFaint }]}
                      numberOfLines={1}
                    >
                      {category.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18, flexShrink: 1 },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    testButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    testText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    section: { gap: 2 },
    sectionTitle: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 4,
    },
    sectionRows: { flexDirection: 'row', flexWrap: 'wrap' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
      paddingRight: 16,
      // Breit genug für die längste Beschriftung, schmal genug, dass auf
      // einem breiten Schirm zwei bis drei nebeneinander stehen.
      minWidth: 290,
      flexGrow: 1,
      flexBasis: 290,
      maxWidth: 420,
    },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  });
