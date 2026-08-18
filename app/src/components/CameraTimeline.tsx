import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { Colors, radius, useColors } from '../theme';

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

  useEffect(() => {
    let cancelled = false;
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};
    fetch(`${settings.url}/api/entities/${entity.id}/events?hours=24`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setSupported(body.supported !== false);
        setEvents(Array.isArray(body.events) ? body.events : []);
      })
      .catch(() => {});
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

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.hint}>Letzte 24 Stunden</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.strip}>
          {events.map((event) => {
            const person = event.detected.includes('person');
            const ring = event.type === 'ring';
            return (
              <View
                key={event.id}
                style={[
                  styles.bubble,
                  ring && { borderColor: colors.danger },
                  person && !ring && { borderColor: colors.warn },
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
                  {new Date(event.start).toLocaleTimeString('de-CH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={styles.label} numberOfLines={1}>
                  {event.detected.length > 0 ? detectedLabel(event.detected) : event.label}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    hint: { color: colors.inkFaint, fontSize: 12 },
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
