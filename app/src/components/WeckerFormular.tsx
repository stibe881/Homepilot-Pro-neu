/**
 * Einen Musikwecker stellen.
 *
 * Vorher war alles fest: Mo–Fr, erste Radiobox, 30 Prozent. Das war ein
 * Anfang, kein Formular. Wählbar ist jetzt, was der Hub ohnehin kann –
 * Sender oder Playlist, die Box, die Tage und die Lautstärke.
 *
 * Die Vorschläge kommen aus dem Gerät selbst: Ein Radioplayer führt
 * seine Sender im Zustand mit, Spotify seine Playlists. Wer tippen will,
 * kann trotzdem tippen – ein Sender, den der Hub noch nicht kennt, wird
 * beim Weckversuch mit einer lesbaren Meldung abgelehnt.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity } from '../api/types';
import { WeckerEntwurf, vorschlaege } from '../lib/weckerentwurf';
import { Colors, radius, type, useColors } from '../theme';

const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export type { WeckerEntwurf };

export function WeckerFormular({
  entities,
  entwurf,
  onChange,
  onSave,
  onCancel,
}: {
  entities: Entity[];
  entwurf: WeckerEntwurf;
  onChange: (entwurf: WeckerEntwurf) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const spieler = entities.filter(
    (entity) =>
      entity.commands.includes('play_radio') || entity.commands.includes('play_playlist'),
  );
  const gewaehlt = entities.find((entity) => entity.id === entwurf.player);
  const boxen = Array.isArray(gewaehlt?.state?.devices)
    ? (gewaehlt?.state?.devices as unknown[]).map(String)
    : [];
  const namen = vorschlaege(gewaehlt, entwurf.kind);

  const tagUmschalten = (tag: number) => {
    const drin = entwurf.days.includes(tag);
    const neu = drin ? entwurf.days.filter((wert) => wert !== tag) : [...entwurf.days, tag];
    onChange({ ...entwurf, days: neu.sort((a, b) => a - b) });
  };

  return (
    <View style={styles.box}>
      {/* ── Uhrzeit und Lautstärke ────────────────────────────────── */}
      <View style={styles.zeile}>
        <TextInput
          style={styles.uhrzeit}
          value={entwurf.time}
          onChangeText={(wert) => onChange({ ...entwurf, time: wert })}
          placeholder="07:00"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Uhrzeit"
        />
        {[20, 30, 45, 60].map((laut) => (
          <Pressable
            key={laut}
            onPress={() => onChange({ ...entwurf, volume: laut })}
            accessibilityRole="radio"
            accessibilityState={{ selected: entwurf.volume === laut }}
            accessibilityLabel={`${laut} Prozent`}
            style={({ pressed }) => [
              styles.chip,
              entwurf.volume === laut && styles.chipAn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.chipText, entwurf.volume === laut && styles.chipTextAn]}>
              {laut} %
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Tage ──────────────────────────────────────────────────── */}
      <View style={styles.zeile}>
        {TAGE.map((name, tag) => (
          <Pressable
            key={name}
            onPress={() => tagUmschalten(tag)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: entwurf.days.includes(tag) }}
            accessibilityLabel={name}
            style={({ pressed }) => [
              styles.tag,
              entwurf.days.includes(tag) && styles.chipAn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.chipText, entwurf.days.includes(tag) && styles.chipTextAn]}>
              {name}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Woher die Musik kommt ─────────────────────────────────── */}
      {spieler.length > 1 ? (
        <View style={styles.zeile}>
          {spieler.map((entity) => (
            <Pressable
              key={entity.id}
              onPress={() =>
                onChange({
                  ...entwurf,
                  player: entity.id,
                  kind: entity.commands.includes('play_radio') ? 'station' : 'playlist',
                  name: '',
                })
              }
              accessibilityRole="radio"
              accessibilityState={{ selected: entwurf.player === entity.id }}
              style={({ pressed }) => [
                styles.chip,
                entwurf.player === entity.id && styles.chipAn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[styles.chipText, entwurf.player === entity.id && styles.chipTextAn]}
                numberOfLines={1}
              >
                {entity.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.eingabe}
        value={entwurf.name}
        onChangeText={(wert) => onChange({ ...entwurf, name: wert })}
        placeholder={entwurf.kind === 'station' ? 'Sender, z. B. SRF 3' : 'Playlist'}
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={entwurf.kind === 'station' ? 'Sender' : 'Playlist'}
      />
      {namen.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.zeile}>
            {namen.map((name) => (
              <Pressable
                key={name}
                onPress={() => onChange({ ...entwurf, name })}
                accessibilityRole="radio"
                accessibilityState={{ selected: entwurf.name === name }}
                style={({ pressed }) => [
                  styles.chip,
                  entwurf.name === name && styles.chipAn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[styles.chipText, entwurf.name === name && styles.chipTextAn]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {/* ── Auf welcher Box ───────────────────────────────────────── */}
      {boxen.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.zeile}>
            {boxen.map((name) => (
              <Pressable
                key={name}
                onPress={() =>
                  onChange({ ...entwurf, device: entwurf.device === name ? '' : name })
                }
                accessibilityRole="radio"
                accessibilityState={{ selected: entwurf.device === name }}
                style={({ pressed }) => [
                  styles.chip,
                  entwurf.device === name && styles.chipAn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name="volume-medium-outline"
                  size={12}
                  color={entwurf.device === name ? '#FFFFFF' : colors.inkSoft}
                />
                <Text
                  style={[styles.chipText, entwurf.device === name && styles.chipTextAn]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View style={styles.zeile}>
        <Pressable
          onPress={onSave}
          accessibilityRole="button"
          accessibilityLabel="Wecker sichern"
          style={({ pressed }) => [styles.chip, styles.chipAn, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.chipText, styles.chipTextAn]}>Sichern</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Abbrechen"
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.chipText}>Abbrechen</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: { gap: 6, marginTop: 6 },
    zeile: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    uhrzeit: {
      color: colors.ink,
      fontSize: type.value,
      fontWeight: '700',
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
      minWidth: 82,
    },
    eingabe: {
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    tag: {
      paddingVertical: 5,
      width: 38,
      alignItems: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    chipAn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600', maxWidth: 160 },
    chipTextAn: { color: '#FFFFFF' },
  });
