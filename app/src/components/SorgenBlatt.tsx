import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { BatterieVermerk } from '../lib/batterien';
import { Sorge, SorgenArt, Wartung, sorgen } from '../lib/sorgen';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Ein Blatt: was gerade nicht in Ordnung ist.
 *
 * Zusammengetragen wird in lib/sorgen.ts; hier steht nur die Anzeige und
 * das, was sich von hier aus erledigen lässt. Und das ist genau das, was
 * ohne Umweg geht: eine Batteriewarnung bis morgen stummschalten, eine
 * Wartung quittieren. Für ein verstummtes Gerät gibt es keinen Knopf –
 * dort hilft nur eine neue Batterie oder ein Blick in den Keller.
 */

const SYMBOL: Record<SorgenArt, keyof typeof Ionicons.glyphMap> = {
  offline: 'cloud-offline-outline',
  still: 'radio-outline',
  batterie: 'battery-dead-outline',
  wartung: 'construct-outline',
};

export function SorgenBlatt({
  settings,
  entities,
  offen,
  onClose,
}: {
  settings: HubSettings;
  entities: Entity[];
  offen: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [vermerke, setVermerke] = useState<BatterieVermerk[]>([]);
  const [wartungen, setWartungen] = useState<Wartung[]>([]);
  const [jetzt, setJetzt] = useState(() => Date.now());

  const laden = useCallback(() => {
    // Beide still: Das Blatt ist eine Auskunft, keine Handlung – eine
    // Fehlermeldung darüber, dass die Auskunft nicht kam, hilft weniger
    // als die halbe Auskunft, die da ist.
    hub
      .get<{ batteries?: BatterieVermerk[] } | null>('/api/batteries', {
        fallback: null,
        still: true,
      })
      .then((data) => setVermerke(data?.batteries ?? []));
    hub
      .get<{ items?: Wartung[] } | null>('/api/maintenance', {
        fallback: null,
        still: true,
      })
      .then((data) => setWartungen(data?.items ?? []));
    setJetzt(Date.now());
  }, [hub]);

  useEffect(() => {
    if (offen) laden();
  }, [offen, laden]);

  const liste = useMemo(
    () => sorgen({ entities, vermerke, wartungen, jetzt }),
    [entities, vermerke, wartungen, jetzt]
  );

  const erledigen = async (sorge: Sorge) => {
    try {
      if (sorge.art === 'batterie' && sorge.entityId) {
        await hub.post(
          `/api/batteries/${encodeURIComponent(sorge.entityId)}/ack`,
          undefined,
          { still: true }
        );
      } else if (sorge.art === 'wartung' && sorge.wartungId) {
        await hub.post(`/api/maintenance/${sorge.wartungId}/done`, undefined, {
          still: true,
        });
      }
    } finally {
      // Auch nach einem Fehlschlag nachladen: Dann steht da, was der Hub
      // wirklich weiss, statt was die App gerade hoffte.
      laden();
    }
  };

  return (
    <Modal visible={offen} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>Nicht in Ordnung</Text>
          {liste.length === 0 ? (
            <Text style={styles.hint}>
              Nichts zu tun: Alle Geräte melden sich, keine Batterie ist
              schwach, keine Wartung überfällig.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              {liste.map((sorge) => (
                <View key={sorge.id} style={styles.row}>
                  <Ionicons
                    name={SYMBOL[sorge.art]}
                    size={20}
                    color={sorge.dringend ? colors.danger : colors.warn}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{sorge.name}</Text>
                    <Text style={styles.rowDetail}>
                      {sorge.detail}
                      {sorge.raum ? ` · ${sorge.raum}` : ''}
                    </Text>
                  </View>
                  {sorge.art === 'batterie' || sorge.art === 'wartung' ? (
                    <Pressable
                      onPress={() => void erledigen(sorge)}
                      accessibilityRole="button"
                      style={styles.action}
                    >
                      <Text style={styles.actionText}>
                        {sorge.art === 'wartung' ? 'Erledigt' : 'Bis morgen still'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          )}
          {/* Nur wenn wirklich einer schweigt: Ein Hinweis auf einen
              Fall, den die Liste gerade nicht zeigt, verwirrt mehr als
              er erklärt. */}
          {liste.some((sorge) => sorge.art === 'still') ? (
            <Text style={styles.hint}>
              Ein Melder, der schweigt, meldet keinen Fehler – deshalb steht
              er hier. Die häufigste Ursache ist eine leere Batterie.
            </Text>
          ) : null}
          <Pressable onPress={onClose} style={styles.confirm}>
            <Text style={styles.confirmText}>Schliessen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 520,
      gap: 10,
      padding: 18,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: colors.inkFaint, fontSize: 12 },
    action: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    actionText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    confirm: {
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    confirmText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  });
