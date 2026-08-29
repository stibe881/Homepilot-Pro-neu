import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { epochAgo } from '../lib/zeit';
import { LogSpan, reichweiteText } from '../lib/verlauf';
import {
  VerlaufEreignis,
  verlaufAbschnitte,
  zeilenText,
  zustandName,
} from '../lib/verlaufliste';
import { Fehlschlag, Laedt, Leer } from './Zustand';
import { Colors, radius, type, useColors } from '../theme';
import { hubClient } from '../api/client';

/**
 * Verlauf eines einzelnen Geräts: wann schaltete es, und wer war es.
 *
 * Die Antwort auf «warum ging die Lampe um drei Uhr an?» – ohne Scrollen
 * durch den Gesamtverlauf. Jede Zeile trägt ihre Quelle: ein Benutzer,
 * ein Ablauf, eine Szene, die Anwesenheitssimulation – oder das Gerät
 * selbst (Wandschalter, Hersteller-App, Zeitschaltung ausserhalb des Hubs).
 *
 * Nach Tagen geteilt und mit Dauer: «14:19» und «14:19» können derselbe
 * Nachmittag sein oder zwei verschiedene Tage, und die eigentlich
 * interessante Zahl ist ohnehin nicht, wann das Licht anging, sondern wie
 * lange es an war. Gerechnet wird das in lib/verlaufliste.ts.
 */

type HistoryEvent = VerlaufEreignis;

/** Wer war es – als lesbarer Satzteil (rein, testbar). */
export function sourceLabel(source: HistoryEvent['source']): string {
  const kind = source?.kind ?? '';
  const label = source?.label ?? '';
  if (kind === 'user') return label || 'Benutzer';
  if (kind === 'automation') return `Ablauf «${label}»`;
  if (kind === 'scene') return `Szene «${label}»`;
  if (kind === 'simulation') return label || 'Anwesenheitssimulation';
  // Ohne Quelle kam der Wechsel nicht über den Hub: Wandschalter,
  // Hersteller-App oder eine Zeitschaltung im Gerät selbst.
  return 'am Gerät / von aussen';
}

/** Nur die Uhrzeit – das Datum steht im Abschnittstitel. */
function uhrzeit(at: number): string {
  if (!at || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EntityHistory({
  entity,
  settings,
  onClose,
}: {
  entity: Entity;
  settings: HubSettings;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [span, setSpan] = useState<LogSpan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hubClient(settings.url, settings.token)
      .get<{ events?: never[]; log?: never } & Record<string, unknown>>(`/api/entities/${encodeURIComponent(entity.id)}/log`, { still: true })
      .then((data) => {
        setEvents(data.events ?? []);
        setSpan(data.log ?? null);
      })
      .catch((err) => setError(String(err instanceof Error ? err.message : err)));
  }, [entity.id, settings.url, settings.token]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Ionicons name="time-outline" size={18} color={colors.inkSoft} />
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
              {entity.name}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Schliessen">
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>

          {error ? <Fehlschlag text={`Nicht abrufbar: ${error}`} /> : null}
          {events == null && !error ? <Laedt was="Verlauf" klein /> : null}
          {events != null && events.length === 0 ? (
            <Leer
              icon="time-outline"
              titel="Noch nichts aufgezeichnet"
              hinweis={
                reichweiteText(span) ||
                'Sobald dieses Gerät schaltet, steht es hier – der Verlauf übersteht Neustarts und Updates.'
              }
            />
          ) : null}

          <ScrollView style={{ maxHeight: 420 }}>
            {verlaufAbschnitte(events ?? []).map((abschnitt) => (
              <View key={abschnitt.titel}>
                <Text style={styles.tag}>{abschnitt.titel}</Text>
                {abschnitt.zeilen.map((zeile, index) => (
                  <View key={`${abschnitt.titel}-${index}`} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.state}>{zustandName(zeile.state)}</Text>
                      <Text style={styles.detail}>
                        {zeilenText(zeile, sourceLabel(zeile.source))}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.time}>{uhrzeit(zeile.at)}</Text>
                      <Text style={styles.detail}>{epochAgo(zeile.at)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>

          {events != null && events.length > 0 ? (
            <>
              <Text style={styles.hint}>{reichweiteText(span)}</Text>
              <Text style={styles.hint}>
                «Am Gerät / von aussen» heisst: Der Wechsel kam nicht über den
                Hub – Wandschalter, Hersteller-App oder eine Zeitschaltung im
                Gerät selbst.
              </Text>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 440,
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: 16,
      gap: 10,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Der Tagestitel trennt, ohne selbst gelesen werden zu wollen.
    tag: {
      color: colors.inkFaint,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      marginTop: 10,
      marginBottom: 2,
    },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    state: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    time: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
