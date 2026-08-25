import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Entity, Scene } from '../api/types';
import { Colors, radius, useColors } from '../theme';

/**
 * Ein Suchfeld für alles.
 *
 * Bisher gab es drei getrennte Suchen – Geräte, Abläufe, Szenen – und jede
 * fand nur, was auf ihrer Seite lag. Wer den Namen kennt, aber nicht mehr
 * weiss, ob es eine Szene oder ein Ablauf war, sucht sonst dreimal.
 *
 * Räume sind mit dabei: «Bad» soll den Raum finden, nicht bloss die Geräte,
 * die zufällig «Bad» im Namen tragen.
 */

export type HitKind = 'entity' | 'scene' | 'automation' | 'room';

export interface Hit {
  kind: HitKind;
  id: string;
  label: string;
  detail: string;
}

const ICONS: Record<HitKind, keyof typeof Ionicons.glyphMap> = {
  entity: 'hardware-chip-outline',
  scene: 'sparkles-outline',
  automation: 'git-branch-outline',
  room: 'home-outline',
};

const LABELS: Record<HitKind, string> = {
  entity: 'Gerät',
  scene: 'Szene',
  automation: 'Ablauf',
  room: 'Raum',
};

/**
 * Alles durchsuchen (rein, testbar).
 *
 * Treffer am Wortanfang zuerst: Wer «Bad» tippt, meint das Bad und nicht
 * die «Fussbodenheizung Bad». Innerhalb derselben Güte bleibt die
 * gewachsene Reihenfolge – ein Alphabet über Gerätearten hinweg hilft
 * niemandem.
 */
export function search(
  query: string,
  entities: Entity[],
  scenes: Scene[],
  automations: { id: string; alias: string; category?: string | null }[],
  rooms: string[]
): Hit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const hits: Hit[] = [
    ...rooms.map((room) => ({
      kind: 'room' as const,
      id: room,
      label: room,
      detail: `${entities.filter((entity) => entity.room === room).length} Geräte`,
    })),
    // Nur Geräte mit Raum: Die Geräteliste ist das Verwaltungswerkzeug für
    // alles, was die Integrationen liefern – wer einem Gerät dort keinen
    // Raum gibt, will es im Alltag nicht sehen, auch nicht als Suchtreffer.
    ...entities
      .filter((entity) => entity.room)
      .map((entity) => ({
        kind: 'entity' as const,
        id: entity.id,
        label: entity.name,
        detail: entity.room ?? entity.integration,
      })),
    ...scenes.map((scene) => ({
      kind: 'scene' as const,
      id: scene.id,
      label: scene.name,
      detail: scene.room ?? 'Szene',
    })),
    ...automations.map((automation) => ({
      kind: 'automation' as const,
      id: automation.id,
      label: automation.alias,
      detail: automation.category ?? 'Ablauf',
    })),
  ];

  const matched = hits.filter((hit) => hit.label.toLowerCase().includes(needle));
  return matched
    .map((hit, index) => ({
      hit,
      // Am Anfang gefunden zählt besser als irgendwo mittendrin.
      rank: hit.label.toLowerCase().startsWith(needle) ? 0 : 1,
      index,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.hit)
    .slice(0, 40);
}

export function GlobalSearch({
  visible,
  entities,
  scenes,
  automations,
  rooms,
  onClose,
  onPick,
}: {
  visible: boolean;
  entities: Entity[];
  scenes: Scene[];
  automations: { id: string; alias: string; category?: string | null }[];
  rooms: string[];
  onClose: () => void;
  onPick: (hit: Hit) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  const hits = search(query, entities, scenes, automations, rooms);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.inkFaint} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Gerät, Raum, Szene oder Ablauf …"
              placeholderTextColor={colors.inkFaint}
              autoFocus
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.inkFaint} />
              </Pressable>
            ) : null}
          </View>

          {query.trim().length < 2 ? (
            <Text style={styles.hint}>
              Ab zwei Zeichen wird gesucht – über Geräte, Räume, Szenen und
              Abläufe hinweg.
            </Text>
          ) : hits.length === 0 ? (
            <Text style={styles.hint}>Nichts gefunden.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {hits.map((hit) => (
                <Pressable
                  key={`${hit.kind}:${hit.id}`}
                  onPress={() => {
                    setQuery('');
                    onPick(hit);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name={ICONS[hit.kind]} size={20} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {hit.label}
                    </Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {LABELS[hit.kind]} · {hit.detail}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      paddingTop: 80,
      paddingHorizontal: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 520,
      gap: 10,
      padding: 16,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    input: { flex: 1, color: colors.ink, fontSize: 16 },
    hint: { color: colors.inkFaint, fontSize: 13, lineHeight: 19, paddingVertical: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: colors.inkFaint, fontSize: 12 },
  });
