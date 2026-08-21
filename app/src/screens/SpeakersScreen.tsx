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
  /** Eindeutig – Adresse allein reicht nicht: Eine Gruppe läuft auf der
   *  IP eines ihrer Mitglieder, nur mit eigenem Port. */
  uuid?: string;
  name: string;
  host: string;
  port?: number;
  model?: string;
  group: boolean;
  entity_id?: string | null;
}

/** Kennung einer Box für Listen und Nachschlagewerke (rein, testbar). */
function keyOf(entry: Speaker): string {
  return entry.uuid || `${entry.host}:${entry.port ?? 8009}`;
}

export function SpeakersScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [speakers, setSpeakers] = useState<Speaker[] | null>(null);
  const [configured, setConfigured] = useState<string[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Was gerade eingetragen wird, und was ein Neustart noch braucht.
  const [adopting, setAdopting] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);

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
  const loadMembers = async (entry: Speaker) => {
    const id = keyOf(entry);
    try {
      const response = await fetch(
        `${settings.url}/api/speakers/members?host=${encodeURIComponent(entry.host)}` +
          `&port=${entry.port ?? 8009}`,
        { headers }
      );
      const data = await response.json();
      setMembers((prev) => ({ ...prev, [id]: data.members ?? [] }));
    } catch {
      setMembers((prev) => ({ ...prev, [id]: [] }));
    }
  };

  /** Fehlertexte des Hubs lesbar machen – bei Eingabefehlern liefert
   *  FastAPI eine Liste von Objekten statt eines Satzes. */
  const detailText = (data: any, status: number): string => {
    const detail = data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((entry: any) => entry?.msg ?? JSON.stringify(entry)).join(', ');
    }
    return `Hub antwortet mit ${status}`;
  };

  /** Eine gefundene Box in die config.yaml eintragen – der Hub ergänzt dort
   *  zwei Zeilen und lässt den Rest der Datei in Ruhe. */
  const adopt = async (entry: Speaker) => {
    if (!entry.host) {
      // Kommt bei Gruppen vor, deren Adresse das Netz gerade nicht meldet –
      // ohne Adresse gibt es nichts einzutragen.
      setError(
        `Für «${entry.name}» meldet das Netz keine Adresse. Die Gruppe in der ` +
          'Google-Home-App einmal kurz bespielen, dann hier erneut suchen.'
      );
      return;
    }
    setAdopting(keyOf(entry));
    setError(null);
    try {
      const response = await fetch(`${settings.url}/api/speakers/adopt`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: entry.name,
          host: entry.host,
          port: entry.port ?? 8009,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(detailText(data, response.status));
      }
      setPending((prev) => (prev.includes(entry.name) ? prev : [...prev, entry.name]));
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    } finally {
      setAdopting(null);
    }
  };

  /** Hub neu starten, damit frisch eingetragene Boxen erscheinen. */
  const [restarting, setRestarting] = useState(false);
  const restartNow = async () => {
    setRestarting(true);
    try {
      await fetch(`${settings.url}/api/system/restart`, { method: 'POST', headers });
    } catch {
      // Die Verbindung reisst beim Neustart sowieso ab – kein Fehler.
    }
  };

  /** Der Zustand rechts in der Zeile: schon eingebunden, gerade eingetragen
   *  (dann fehlt nur noch der Neustart) oder ein Knopf zum Übernehmen. */
  const Badge = ({ entry }: { entry: Speaker }) => {
    if (entry.entity_id) return <Text style={styles.badgeOk}>eingebunden</Text>;
    if (pending.includes(entry.name)) {
      return <Text style={styles.badgeWait}>nach Neustart</Text>;
    }
    return (
      <Pressable
        onPress={() => adopt(entry)}
        accessibilityRole="button"
        accessibilityLabel={`${entry.name} übernehmen`}
        disabled={adopting != null}
        style={({ pressed }) => [styles.adopt, pressed && { opacity: 0.8 }]}
      >
        <Ionicons
          name={adopting === keyOf(entry) ? 'hourglass-outline' : 'add'}
          size={14}
          color={colors.accent}
        />
        <Text style={styles.adoptText}>übernehmen</Text>
      </Pressable>
    );
  };

  // Nur wenn schon die erste Suche scheitert, gibt es nichts zu zeigen.
  // Fehler bei einer Aktion erscheinen als Banner über der Liste – vorher
  // ersetzten sie die ganze Seite, und ein Fehlschlag sah aus wie «nichts
  // passiert».
  if (error && speakers == null) {
    return <Text style={styles.note}>Lautsprecher nicht abrufbar: {error}</Text>;
  }

  const groups = (speakers ?? []).filter((entry) => entry.group);
  const singles = (speakers ?? []).filter((entry) => !entry.group);
  const missing = configured.filter(
    (name) => !(speakers ?? []).some((entry) => entry.name === name)
  );

  return (
    <View style={styles.list}>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      {pending.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.wait}>
            Eingetragen: {pending.join(', ')}. Sichtbar als Gerät wird das erst
            nach einem Neustart des Hubs.
          </Text>
          <Pressable
            onPress={restartNow}
            accessibilityRole="button"
            disabled={restarting}
            style={({ pressed }) => [styles.button, (pressed || restarting) && { opacity: 0.7 }]}
          >
            <Ionicons name="refresh-circle-outline" size={16} color="#FFFFFF" />
            <Text style={styles.buttonText}>
              {restarting ? 'Hub startet neu …' : 'Jetzt neu starten'}
            </Text>
          </Pressable>
          {restarting ? (
            <Text style={styles.hint}>
              Die Verbindung reisst dabei kurz ab und kommt von selbst wieder.
            </Text>
          ) : null}
        </Card>
      ) : null}
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
            <View key={keyOf(entry)} style={styles.row}>
              <Ionicons name="people" size={20} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{entry.name}</Text>
                <Text style={styles.rowDetail}>
                  {members[keyOf(entry)]
                    ? members[keyOf(entry)].length > 0
                      ? members[keyOf(entry)].join(', ')
                      : 'Mitglieder nicht lesbar'
                    : entry.host}
                </Text>
              </View>
              <Badge entry={entry} />
              {!members[keyOf(entry)] ? (
                <Pressable
                  onPress={() => loadMembers(entry)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Mitglieder von ${entry.name} zeigen`}
                >
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
            <View key={keyOf(entry)} style={styles.row}>
              <Ionicons name="volume-medium-outline" size={20} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{entry.name}</Text>
                <Text style={styles.rowDetail}>
                  {entry.host}
                  {entry.model ? ` · ${entry.model}` : ''}
                </Text>
              </View>
              <Badge entry={entry} />
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
          «Übernehmen» trägt die Box mit Namen und Adresse in die config.yaml
          ein – der Hub ergänzt dort zwei Zeilen und lässt den Rest der Datei
          samt Kommentaren, wie er ist. Wirksam wird der Eintrag beim nächsten
          Neustart des Hubs; bis dahin steht «nach Neustart» daneben. Eine
          Gruppe wird genauso eingetragen wie eine einzelne Box – für den Hub
          ist sie ein Gerät.
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
    wait: { color: colors.warn, fontSize: 12, lineHeight: 18, fontWeight: '600' },
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
    badgeWait: { color: colors.warn, fontSize: 11, fontWeight: '700' },
    adopt: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    adoptText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
    errorBanner: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 19,
    },
    badgeOk: { color: colors.on, fontSize: 11, fontWeight: '700' },
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
