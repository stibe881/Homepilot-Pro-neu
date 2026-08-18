import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings, OneTimePass } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Einmal-Türöffnung für Lieferanten.
 *
 * Der Fall: Das Paket steht vor der Türe, man selbst im Zug. Ein
 * Gastzugang wäre dafür zu viel – der sähe alles und stünde Tage später
 * noch herum. Hier gibt es stattdessen einen Link, der genau ein Gerät,
 * genau einen Befehl, genau einmal und nur wenige Minuten lang auslöst.
 *
 * Nach einem Neustart des Hubs gelten alle Links nicht mehr – das ist die
 * sichere Richtung und Absicht.
 */

const MINUTES = [5, 15, 30, 60];

export function DoorPass({
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
  const [passes, setPasses] = useState<OneTimePass[] | null>(null);
  const [minutes, setMinutes] = useState(15);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Alles, was sich öffnen lässt: Schlösser und Türöffner.
  const doors = entities.filter(
    (entity) =>
      entity.kind === 'lock' &&
      (entity.commands.includes('unlatch') || entity.commands.includes('open_door'))
  );
  const target = doors.find((door) => door.id === chosen) ?? doors[0];

  const load = async () => {
    try {
      const response = await fetch(`${settings.url}/api/passes`, { headers });
      const body = await response.json();
      setPasses(Array.isArray(body.passes) ? body.passes : []);
    } catch {
      setPasses([]);
    }
  };

  useEffect(() => {
    load();
    // Die Restzeit läuft ab – einmal pro Minute nachziehen.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.url, settings.token]);

  const create = async () => {
    if (!target) return;
    setNote(null);
    const command = target.commands.includes('unlatch') ? 'unlatch' : 'open_door';
    try {
      const response = await fetch(`${settings.url}/api/passes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: target.id, command, minutes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
      await load();
      const url = body.pass?.url;
      if (url) {
        Share.share({ message: url }).catch(() => {});
      } else {
        setNote(
          'Link erstellt, aber der Hub kennt seine Adresse von aussen nicht. ' +
            'In der config.yaml unter push.public_url eintragen.'
        );
      }
    } catch (err: any) {
      setNote(String(err.message ?? err));
    }
  };

  if (doors.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Einmal-Türöffnung</Text>
      <Text style={styles.hint}>
        Ein Link, der genau einmal öffnet und danach verfällt – für den
        Paketboten, ohne Gastzugang. Nach einem Neustart des Hubs gilt
        keiner mehr.
      </Text>

      {doors.length > 1 ? (
        <View style={styles.chipRow}>
          {doors.map((door) => (
            <Pressable
              key={door.id}
              onPress={() => setChosen(door.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: door.id === target?.id }}
              style={[styles.chip, door.id === target?.id && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  door.id === target?.id && styles.chipTextActive,
                ]}
              >
                {door.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.chipRow}>
        {MINUTES.map((value) => (
          <Pressable
            key={value}
            onPress={() => setMinutes(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === minutes }}
            style={[styles.chip, value === minutes && styles.chipActive]}
          >
            <Text style={[styles.chipText, value === minutes && styles.chipTextActive]}>
              {value} min
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={create}
        accessibilityRole="button"
        style={({ pressed }) => [styles.create, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="key-outline" size={16} color="#FFFFFF" />
        <Text style={styles.createText}>Link erstellen und teilen</Text>
      </Pressable>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      {(passes ?? []).length > 0 ? (
        <View style={styles.list}>
          {(passes ?? []).map((entry) => (
            <View key={entry.token} style={styles.row}>
              <Ionicons
                name={entry.used_at ? 'checkmark-circle' : 'time-outline'}
                size={18}
                color={entry.used_at ? colors.on : colors.warn}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {entities.find((item) => item.id === entry.entity_id)?.name ??
                    entry.entity_id}
                </Text>
                <Text style={styles.rowDetail}>
                  {entry.used_at
                    ? `benutzt um ${new Date(entry.used_at * 1000).toLocaleTimeString(
                        'de-CH',
                        { hour: '2-digit', minute: '2-digit' }
                      )}`
                    : `noch ${Math.max(1, Math.round(entry.seconds_left / 60))} min gültig`}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  await fetch(`${settings.url}/api/passes/${entry.token}`, {
                    method: 'DELETE',
                    headers,
                  }).catch(() => {});
                  load();
                }}
                accessibilityRole="button"
                accessibilityLabel="Link zurückziehen"
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={colors.inkSoft} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    note: { color: colors.warn, fontSize: 12, lineHeight: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
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
    create: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    createText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    list: { gap: 10, marginTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 12 },
  });
