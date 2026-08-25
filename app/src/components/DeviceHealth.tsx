import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import { Card } from './Card';
import {
  BATTERY_SOON,
  BatterieVermerk,
  HealthRow,
  batteryRows,
  stummBis,
} from '../lib/batterien';
import { epochAgo } from '../lib/zeit';
import { Colors, radius, type, useColors } from '../theme';

export type { BatterieVermerk, HealthRow };
export { batteryRows, stummBis };

/**
 * Geräte-Gesundheit: alle Batteriegeräte auf einen Blick.
 *
 * Der Wächter meldet erst, wenn eine Batterie schwach ist – die Übersicht
 * davor fehlte: Wer vor den Ferien wissen will, welche Melder demnächst
 * dran sind, musste jedes Gerät einzeln antippen. Sortiert nach
 * Dringlichkeit: leere zuerst, volle zuletzt.
 */

export function DeviceHealth({
  entities,
  offen,
  onOffen,
}: {
  entities: Entity[];
  /** Von aussen aufgeklappt – so kommt die Batteriewarnung aus der
   *  Push-Nachricht direkt hierher. Ohne die Angabe entscheidet die
   *  Karte selbst. */
  offen?: boolean;
  onOffen?: (offen: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useSettings();
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);
  const [eigenOffen, setEigenOffen] = useState(false);
  const open = offen ?? eigenOffen;
  const setOpen = useCallback(
    (wert: boolean) => {
      setEigenOffen(wert);
      onOffen?.(wert);
    },
    [onOffen]
  );

  const [vermerke, setVermerke] = useState<BatterieVermerk[]>([]);
  const [jetzt, setJetzt] = useState(() => Date.now());
  const laden = useCallback(() => {
    hub
      .get<{ batteries?: BatterieVermerk[] } | null>('/api/batteries', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (data) setVermerke(data.batteries ?? []);
        setJetzt(Date.now());
      });
  }, [hub]);
  // Nur wenn die Liste offen ist: Zugeklappt braucht niemand die
  // Vermerke, und die Karte steht auf einer Seite, die man oft öffnet.
  useEffect(() => {
    if (open) laden();
  }, [open, laden]);

  const quittieren = async (entityId: string, stumm: boolean) => {
    try {
      if (stumm) {
        await hub.del(`/api/batteries/${encodeURIComponent(entityId)}/ack`, {
          still: true,
        });
      } else {
        await hub.post(
          `/api/batteries/${encodeURIComponent(entityId)}/ack`,
          undefined,
          { still: true }
        );
      }
    } finally {
      // Auch nach einem Fehlschlag nachladen: Dann steht da, was der Hub
      // wirklich weiss, statt was die App gerade hoffte.
      laden();
    }
  };

  const rows = batteryRows(entities);
  if (rows.length === 0) return null;

  const urgent = rows.filter(
    (row) => row.low || (row.percent !== null && row.percent <= BATTERY_SOON)
  );

  const tone = (row: HealthRow) =>
    row.low || (row.percent !== null && row.percent <= 10)
      ? colors.danger
      : row.percent !== null && row.percent <= BATTERY_SOON
        ? colors.warn
        : colors.on;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Ionicons
          name="battery-half-outline"
          size={18}
          color={urgent.length > 0 ? colors.warn : colors.inkSoft}
        />
        <Text style={[styles.heading, { flex: 1 }]}>Batterien</Text>
        <Text style={styles.count}>
          {urgent.length > 0 ? `${urgent.length} bald leer · ` : ''}
          {rows.length} Geräte
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>

      {open ? (
        <>
          {rows.map((row) => {
            const stumm = stummBis(vermerke, row.entity.id, jetzt) !== null;
            // Quittieren gibt es nur, wo es auch eine Warnung gibt. Bei
            // einer vollen Batterie wäre der Knopf eine Attrappe.
            const warnt =
              row.low || (row.percent !== null && row.percent <= BATTERY_SOON);
            return (
              <View key={row.entity.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.entity.name}</Text>
                  <Text style={styles.detail}>
                    {row.entity.room ?? 'Ohne Raum'}
                    {epochAgo(row.entity.last_seen)
                      ? ` · zuletzt gesehen ${epochAgo(row.entity.last_seen)}`
                      : ''}
                  </Text>
                </View>
                {warnt ? (
                  <Pressable
                    onPress={() => quittieren(row.entity.id, stumm)}
                    accessibilityRole="button"
                    accessibilityState={{ checked: stumm }}
                    accessibilityLabel={
                      stumm
                        ? `${row.entity.name}: doch wieder melden`
                        : `${row.entity.name}: bis morgen stumm`
                    }
                    style={({ pressed }) => [
                      styles.quittieren,
                      stumm && styles.quittiertAktiv,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons
                      name={stumm ? 'notifications-off' : 'notifications-off-outline'}
                      size={13}
                      color={stumm ? '#FFFFFF' : colors.inkSoft}
                    />
                    <Text
                      style={[styles.quittierenText, stumm && { color: '#FFFFFF' }]}
                    >
                      {stumm ? 'bis morgen still' : 'bis morgen'}
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={[styles.value, { color: tone(row) }]}>
                  {row.percent !== null ? `${row.percent} %` : 'schwach'}
                </Text>
              </View>
            );
          })}
          <Text style={styles.hint}>
            Dringendste zuerst. «Schwach» ohne Prozentzahl heisst: Das Gerät
            meldet nur noch, dass es bald leer ist – danach ist es still,
            ohne sich abzumelden.
          </Text>
          <Text style={styles.hint}>
            «Bis morgen» nimmt die Push-Meldung zur Kenntnis und schaltet sie
            bis morgen früh stumm. Es ist ein Aufschub, kein Ausschalten:
            Ist die Batterie dann noch schwach, erinnert der Hub noch einmal.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    count: { color: colors.inkFaint, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    quittieren: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    quittiertAktiv: { backgroundColor: colors.accent, borderColor: colors.accent },
    quittierenText: { fontSize: 11, fontWeight: '700', color: colors.inkSoft },
    name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    value: { fontSize: 14, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
