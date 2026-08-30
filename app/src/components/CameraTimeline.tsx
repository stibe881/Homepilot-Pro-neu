import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { gefiltert, FilterLage } from '../lib/ereignisfilter';
import { uhr } from '../lib/format';
import { Colors, radius, useColors } from '../theme';
import { hubClient } from '../api/client';
import { Aufnahme } from './Aufnahme';
import { aufnahmeUrl } from '../lib/aufnahmeurl';

/**
 * Was an dieser Kamera über den Tag los war.
 *
 * «Letzte Bewegung um 16:45» beantwortet nur die halbe Frage. Die
 * Zeitleiste zeigt die Ereignisse der letzten 24 Stunden – und
 * unterscheidet dabei «da war was» von «da stand jemand», weil Protect
 * das selbst erkennt.
 */

export interface CameraEvent {
  id: string;
  type: string;
  label: string;
  start: string;
  end?: string | null;
  detected: string[];
  score?: number | null;
}

/** «person, vehicle» lesbar machen (rein, testbar). */
export function detectedLabel(detected: string[]): string {
  const names: Record<string, string> = {
    person: 'Person',
    vehicle: 'Fahrzeug',
    package: 'Paket',
    animal: 'Tier',
    licensePlate: 'Kennzeichen',
  };
  return detected.map((entry) => names[entry] ?? entry).join(', ');
}

export function CameraTimeline({
  entity,
  settings,
  /** Neue Bewegung lädt die Leiste nach – sonst hinkt sie dem Bild nach. */
  refreshKey,
}: {
  entity: Entity;
  settings: HubSettings;
  refreshKey?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [events, setEvents] = useState<CameraEvent[] | null>(null);
  const [supported, setSupported] = useState(true);
  // Ob der Hub zu den Ereignissen auch Aufnahmen liefern kann - nur dann
  // werden die Kacheln antippbar. Und welche gerade offen ist.
  const [clips, setClips] = useState(false);
  const [offen, setOffen] = useState<CameraEvent | null>(null);
  // Die beiden Filter: nur Personen, nur tagsüber (lib/ereignisfilter).
  // Flüchtig mit Absicht - ein Filter, der kleben bleibt, ist morgen
  // die Leiste, auf der scheinbar nichts war.
  const [filter, setFilter] = useState<FilterLage>({
    nurPersonen: false,
    nurTagsueber: false,
  });

  useEffect(() => {
    let cancelled = false;
    // Ohne Antwort bleibt die Zeitleiste leer - das Kamerabild darüber
    // funktioniert unabhängig davon.
    hubClient(settings.url, settings.token)
      .get<{ supported?: boolean; events?: unknown; clips?: boolean } | null>(
        `/api/entities/${entity.id}/events?hours=24`,
        { fallback: null, still: true }
      )
      .then((body) => {
        if (cancelled || !body) return;
        setSupported(body.supported !== false);
        setClips(body.clips === true);
        setEvents(Array.isArray(body.events) ? body.events : []);
      });
    return () => {
      cancelled = true;
    };
  }, [entity.id, settings.url, settings.token, refreshKey]);

  if (!supported) return null;
  if (events === null) {
    return <Text style={styles.hint}>Ereignisse werden geladen …</Text>;
  }
  if (events.length === 0) {
    return <Text style={styles.hint}>In den letzten 24 Stunden war nichts.</Text>;
  }

  const { sichtbar, verborgen } = gefiltert(events, filter);
  // Anbieten nur, wo er etwas täte: Ohne erkannte Personen wäre der
  // Personen-Chip ein Knopf, der die Leiste bloss leert.
  const kenntPersonen = events.some((event) => event.detected.includes('person'));

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.filterZeile}>
        <Text style={[styles.hint, { flex: 1 }]}>
          Letzte 24 Stunden
          {verborgen > 0 ? ` · ${verborgen} ausgeblendet` : ''}
        </Text>
        {kenntPersonen ? (
          <Pressable
            onPress={() => setFilter((alt) => ({ ...alt, nurPersonen: !alt.nurPersonen }))}
            accessibilityRole="switch"
            accessibilityState={{ checked: filter.nurPersonen }}
            style={[styles.filterChip, filter.nurPersonen && styles.filterChipAktiv]}
          >
            <Text
              style={[styles.filterText, filter.nurPersonen && styles.filterTextAktiv]}
            >
              nur Personen
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setFilter((alt) => ({ ...alt, nurTagsueber: !alt.nurTagsueber }))}
          accessibilityRole="switch"
          accessibilityState={{ checked: filter.nurTagsueber }}
          style={[styles.filterChip, filter.nurTagsueber && styles.filterChipAktiv]}
        >
          <Text
            style={[styles.filterText, filter.nurTagsueber && styles.filterTextAktiv]}
          >
            nur tagsüber
          </Text>
        </Pressable>
      </View>
      {sichtbar.length === 0 ? (
        <Text style={styles.hint}>
          Der Filter lässt nichts übrig – {verborgen} Ereignis
          {verborgen === 1 ? '' : 'se'} ausgeblendet.
        </Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.strip}>
          {sichtbar.map((event) => {
            const person = event.detected.includes('person');
            const ring = event.type === 'ring';
            const url = clips
              ? aufnahmeUrl(settings.url, settings.token, entity.id, event)
              : null;
            return (
              <Pressable
                key={event.id}
                onPress={url ? () => setOffen(event) : undefined}
                disabled={!url}
                accessibilityRole={url ? 'button' : undefined}
                accessibilityLabel={
                  url ? `Aufnahme von ${uhr(new Date(event.start))} ansehen` : undefined
                }
                style={({ pressed }) => [
                  styles.bubble,
                  ring && { borderColor: colors.danger },
                  person && !ring && { borderColor: colors.warn },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={
                    ring
                      ? 'notifications-outline'
                      : person
                        ? 'person-outline'
                        : 'walk-outline'
                  }
                  size={14}
                  color={ring ? colors.danger : person ? colors.warn : colors.inkSoft}
                />
                <Text style={styles.time}>
                  {uhr(new Date(event.start))}
                </Text>
                <Text style={styles.label} numberOfLines={1}>
                  {event.detected.length > 0 ? detectedLabel(event.detected) : event.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {offen ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOffen(null)}>
          <Pressable
            style={styles.clipGrund}
            onPress={() => setOffen(null)}
            accessibilityLabel="Aufnahme schliessen"
          >
            {/* Der Hub exportiert die Aufnahme beim ersten Abruf aus
                Protect - ein paar Sekunden Ladezeit sind normal. */}
            <Text style={styles.clipTitel}>
              {uhr(new Date(offen.start))}
              {offen.detected.length > 0 ? ` · ${detectedLabel(offen.detected)}` : ''}
            </Text>
            <Aufnahme
              uri={aufnahmeUrl(settings.url, settings.token, entity.id, offen)!}
              style={styles.clipVideo}
            />
            <Text style={styles.clipHinweis}>Tippen zum Schliessen</Text>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    clipGrund: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 14,
      gap: 10,
    },
    clipTitel: { color: '#E9EDF4', fontSize: 16, fontWeight: '700' },
    clipVideo: { width: '100%', height: '60%' },
    clipHinweis: { color: '#97A2B6', fontSize: 12 },
    hint: { color: colors.inkFaint, fontSize: 12 },
    filterZeile: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    filterChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    filterChipAktiv: { backgroundColor: colors.accent, borderColor: colors.accent },
    filterText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    filterTextAktiv: { color: '#FFFFFF' },
    strip: { flexDirection: 'row', gap: 6 },
    bubble: {
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      minWidth: 74,
    },
    time: {
      color: colors.ink,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    label: { color: colors.inkSoft, fontSize: 10, maxWidth: 84 },
  });
