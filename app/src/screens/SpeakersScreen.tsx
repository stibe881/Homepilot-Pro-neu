import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Lautsprecher: was im Netz steht, was der Hub kennt, und welche davon
 * Gruppen sind.
 *
 * Zur Einordnung, weil es die Kernfrage ist: Mehrere Boxen spielen nur
 * dann wirklich gleichzeitig, wenn sie eine echte Google-Lautsprecher-
 * gruppe bilden. Google gleicht darin die Uhren der Boxen ab; von aussen
 * an mehrere Boxen zu senden ergäbe hörbaren Versatz. Eine solche Gruppe
 * entsteht einmalig in der Google-Home-App und meldet sich danach im Netz
 * als ein einzelnes Gerät – der Hub kann sie benutzen, aber nicht selbst
 * herstellen.
 */

interface Speaker {
  name: string;
  host: string;
  model?: string;
  group: boolean;
  entity_id?: string | null;
}

export function SpeakersScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [speakers, setSpeakers] = useState<Speaker[] | null>(null);
  const [configured, setConfigured] = useState<string[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  const load = useCallback(() => {
    setBusy(true);
    setError(null);
    fetch(`${settings.url}/api/speakers`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setSpeakers(data.speakers ?? []);
        setConfigured(data.configured ?? []);
      })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setBusy(false));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  /** Mitglieder einer Gruppe nachladen – nur auf Wunsch, das kostet
   *  jeweils eine Verbindung zur Box. */
  const loadMembers = async (host: string) => {
    try {
      const response = await fetch(
        `${settings.url}/api/speakers/members?host=${encodeURIComponent(host)}`,
        { headers }
      );
      const data = await response.json();
      setMembers((prev) => ({ ...prev, [host]: data.members ?? [] }));
    } catch {
      setMembers((prev) => ({ ...prev, [host]: [] }));
    }
  };

  if (error) {
    return <Text style={styles.note}>Lautsprecher nicht abrufbar: {error}</Text>;
  }

  const groups = (speakers ?? []).filter((entry) => entry.group);
  const singles = (speakers ?? []).filter((entry) => !entry.group);
  const missing = configured.filter(
    (name) => !(speakers ?? []).some((entry) => entry.name === name)
  );

  return (
    <View style={styles.list}>
      <Card style={styles.card}>
        <Text style={styles.heading}>Gruppen</Text>
        <Text style={styles.hint}>
          Eine Gruppe spielt auf allen Boxen gleichzeitig – Google gleicht
          dafür die Uhren der Boxen ab. Genau deshalb entsteht sie in der
          Google-Home-App und nicht hier: Von aussen an mehrere Boxen zu
          senden ergäbe hörbaren Versatz.
        </Text>
        {speakers == null ? (
          <Text style={styles.hint}>Wird gesucht …</Text>
        ) : groups.length === 0 ? (
          <Text style={styles.hint}>
            Keine Lautsprechergruppe gefunden. In der Google-Home-App:
            «Hinzufügen» → «Lautsprechergruppe erstellen», Boxen auswählen und
            benennen. Danach hier neu suchen – die Gruppe erscheint dann wie
            eine einzelne Box und lässt sich im Player auswählen.
          </Text>
        ) : (
          groups.map((entry) => (
            <View key={entry.host} style={styles.row}>
              <Ionicons name="people" size={20} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{entry.name}</Text>
                <Text style={styles.rowDetail}>
                  {members[entry.host]
                    ? members[entry.host].length > 0
                      ? members[entry.host].join(', ')
                      : 'Mitglieder nicht lesbar'
                    : entry.host}
                </Text>
              </View>
              {entry.entity_id ? (
                <Text style={styles.badgeOk}>eingebunden</Text>
              ) : (
                <Text style={styles.badge}>nicht in config</Text>
              )}
              {!members[entry.host] ? (
                <Pressable onPress={() => loadMembers(entry.host)} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={20} color={colors.inkSoft} />
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.heading}>Einzelne Boxen</Text>
        {speakers == null ? (
          <Text style={styles.hint}>Wird gesucht …</Text>
        ) : singles.length === 0 ? (
          <Text style={styles.hint}>Keine Boxen im Netz gefunden.</Text>
        ) : (
          singles.map((entry) => (
            <View key={entry.host} style={styles.row}>
              <Ionicons name="volume-medium-outline" size={20} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{entry.name}</Text>
                <Text style={styles.rowDetail}>
                  {entry.host}
                  {entry.model ? ` · ${entry.model}` : ''}
                </Text>
              </View>
              {entry.entity_id ? (
                <Text style={styles.badgeOk}>eingebunden</Text>
              ) : (
                <Text style={styles.badge}>nicht in config</Text>
              )}
            </View>
          ))
        )}
      </Card>

      {missing.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Eingebunden, aber nicht gefunden</Text>
          {missing.map((name) => (
            <Text key={name} style={styles.rowTitle}>
              {name}
            </Text>
          ))}
          <Text style={styles.hint}>
            Diese Boxen kennt der Hub aus der config.yaml, die Suche hat sie
            aber nicht gesehen – sie sind aus oder in einem anderen Netz.
          </Text>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.heading}>Einbinden</Text>
        <Text style={styles.hint}>
          Was hier als «nicht in config» steht, kennt der Hub noch nicht. Unter
          Einstellungen → System → Konfiguration eintragen, mit dem Namen und
          der Adresse von oben:
        </Text>
        <Text style={styles.code}>
          {'  - integration: google_cast\n    devices:\n      - host: 10.10.1.225\n        name: Terrasse'}
        </Text>
        <Text style={styles.hint}>
          Eine Gruppe wird genauso eingetragen wie eine einzelne Box – für den
          Hub ist sie ein Gerät.
        </Text>
        <Pressable
          onPress={load}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.buttonText}>{busy ? 'Sucht …' : 'Erneut suchen'}</Text>
        </Pressable>
      </Card>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    note: { color: colors.onGradientSoft, fontSize: 14, marginTop: 20 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 12 },
    badge: { color: colors.inkFaint, fontSize: 11 },
    badgeOk: { color: colors.on, fontSize: 11, fontWeight: '700' },
    code: {
      color: colors.ink,
      fontSize: 12,
      fontFamily: 'monospace',
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      padding: 12,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 12,
    },
    buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
