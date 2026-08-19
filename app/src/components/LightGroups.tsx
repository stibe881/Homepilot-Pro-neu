import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Mehrere Lampen zu einer Leuchte zusammenfassen.
 *
 * Der Fall: Eine Deckenlampe besteht aus fünf Spots, und die Bridge
 * meldet fünf Lichter. Bedienen will man sie als eines – niemand
 * schaltet Spot 3 allein ein.
 *
 * Die Mitglieder verschwinden danach aus Räumen, Suche und der Zählung
 * oben. Unter Geräte bleiben sie sichtbar und einzeln bedienbar: Beim
 * Ausrichten nach dem Einbau braucht man genau das.
 *
 * Nicht zu verwechseln mit der Kategorie an einem Gerät – die sortiert
 * nur Kacheln innerhalb eines Raums und fasst nichts zusammen.
 */

interface LightGroup {
  id: string;
  name: string;
  members: string[];
  kind?: string;
  hide_members?: boolean;
}

export function LightGroups({
  settings,
  headers,
  entities,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
  entities: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [groups, setGroups] = useState<LightGroup[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  // Vorgabe: ausblenden. Das ist der Fall, für den es die Zusammenfassung
  // gibt - fünf Spots als ein Licht. Wer zwei Stehlampen meist gemeinsam
  // und manchmal einzeln schaltet, nimmt den Haken weg.
  const [hideMembers, setHideMembers] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Nur was sich zusammenfassen lässt: echte Lampen und Schalter, keine
  // Leuchte in einer Leuchte.
  const candidates = entities.filter(
    (entity) =>
      (entity.kind === 'light' || entity.kind === 'switch') &&
      entity.integration !== 'group'
  );

  const load = async () => {
    try {
      const response = await fetch(`${settings.url}/api/lightgroups`, { headers });
      const body = await response.json();
      setGroups(Array.isArray(body.groups) ? body.groups : []);
    } catch {
      setGroups([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.url, settings.token]);

  const nameOf = (id: string) => entities.find((item) => item.id === id)?.name ?? id;

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = async () => {
    setNote(null);
    setBusy(true);
    try {
      const response = await fetch(`${settings.url}/api/lightgroups`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          members: picked,
          hide_members: hideMembers,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
      setName('');
      setPicked([]);
      setHideMembers(true);
      setOpen(false);
      setNote(`«${name.trim()}» angelegt.`);
      await load();
    } catch (err: any) {
      setNote(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const dissolve = async (group: LightGroup) => {
    try {
      const response = await fetch(`${settings.url}/api/lightgroups/${group.id}`, {
        method: 'DELETE',
        headers,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
      setNote(`«${group.name}» aufgelöst – die Lampen sind wieder einzeln da.`);
      await load();
    } catch (err: any) {
      setNote(String(err.message ?? err));
    }
  };

  if (candidates.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Lampen zusammenfassen</Text>
      <Text style={styles.hint}>
        Eine Deckenlampe mit mehreren Spots soll ein Licht sein, nicht fünf.
        Zusammengefasste Lampen verschwinden aus den Räumen und aus der
        Zählung oben; hier unter Geräte bleiben sie einzeln bedienbar.
      </Text>

      {(groups ?? []).map((group) => (
        <View key={group.id} style={styles.row}>
          <Ionicons name="bulb-outline" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{group.name}</Text>
            <Text style={styles.rowDetail} numberOfLines={2}>
              {group.members.map(nameOf).join(' · ')}
              {group.hide_members === false ? ' · einzeln sichtbar' : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => dissolve(group)}
            accessibilityRole="button"
            accessibilityLabel={`${group.name} auflösen`}
            hitSlop={8}
          >
            <Ionicons name="unlink-outline" size={18} color={colors.inkSoft} />
          </Pressable>
        </View>
      ))}

      {open ? (
        <View style={styles.form}>
          <Text style={styles.label}>Name der Leuchte</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Deckenlampe Wohnzimmer"
            placeholderTextColor={colors.inkFaint}
          />
          <Text style={styles.label}>
            Welche Lampen gehören dazu? {picked.length > 0 ? `(${picked.length})` : ''}
          </Text>
          <View style={styles.chipRow}>
            {candidates.map((entity) => {
              const active = picked.includes(entity.id);
              const taken = !!entity.combined_into;
              return (
                <Pressable
                  key={entity.id}
                  onPress={() => !taken && toggle(entity.id)}
                  disabled={taken}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active, disabled: taken }}
                  style={[
                    styles.chip,
                    active && styles.chipActive,
                    taken && { opacity: 0.4 },
                  ]}
                >
                  {active ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {entity.name}
                    {entity.room ? ` · ${entity.room}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => setHideMembers((prev) => !prev)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: hideMembers }}
            style={({ pressed }) => [styles.check, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={hideMembers ? 'checkbox' : 'square-outline'}
              size={20}
              color={hideMembers ? colors.accent : colors.inkSoft}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkTitle}>Einzelne Lampen ausblenden</Text>
              <Text style={styles.checkHint}>
                {hideMembers
                  ? 'Sie verschwinden aus Räumen, Suche und der Zählung oben – hier unter Geräte bleiben sie einzeln bedienbar.'
                  : 'Sie bleiben überall sichtbar und lassen sich weiterhin einzeln schalten. Die Zählung oben zählt sie dann mit.'}
              </Text>
            </View>
          </Pressable>

          <View style={styles.buttons}>
            <Pressable
              onPress={() => {
                setOpen(false);
                setPicked([]);
                setName('');
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={create}
              disabled={busy || picked.length < 2 || !name.trim()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                (pressed || busy || picked.length < 2 || !name.trim()) && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.primaryText}>
                {picked.length < 2 ? 'Mindestens zwei wählen' : 'Zusammenfassen'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={styles.newButton}>
          <Ionicons name="git-merge-outline" size={17} color={colors.ink} />
          <Text style={styles.newButtonText}>Lampen zusammenfassen</Text>
        </Pressable>
      )}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    note: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
    form: { gap: 8 },
    label: { color: colors.inkSoft, fontSize: 12, fontWeight: '700', marginTop: 4 },
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
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    check: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 8,
      paddingVertical: 4,
    },
    checkTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    checkHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 2 },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 4 },
    primary: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    secondary: {
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    secondaryText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    newButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  });
