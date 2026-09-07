import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { TagesGriff, tagesGriffe } from '../lib/tageszeile';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Die tageszeitliche Schnellzeile der Startseite (Punkt 257 der
 * Werkbank): morgens «Storen auf», abends «Licht aus» und «Storen zu».
 *
 * Welche Griffe wann erscheinen, entscheidet lib/tageszeile.ts - hier
 * steht nur die Zeile. Sie verschwindet von selbst, sobald nichts mehr
 * zu tun ist: Die Griffe hängen am gemeldeten Zustand, und der ändert
 * sich mit dem Ausführen.
 *
 * Der Tipp schaltet nicht sofort, sondern öffnet ein Blatt mit den
 * betroffenen Geräten. «4 Lichter aus» sagt nämlich nicht, *welche*
 * vier - und wer erst nach dem Tippen merkt, dass das Kinderzimmer
 * dabei war, hat ein Kind im Dunkeln. Dieselbe Rückfrage und dieselben
 * Häkchen wie bei «Alles aus» (AllOff.tsx), nur ohne dessen
 * Sonderregel für laufende Haushaltgeräte: Hier stehen ohnehin nur
 * Lichter und Storen.
 */
export function TagesZeile({
  entities,
  now,
  onCommand,
}: {
  entities: Entity[];
  now: Date;
  onCommand: (entityId: string, command: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Den Griff selbst muss nichts mehr dämpfen: Er schickt keinen Befehl
  // mehr, er öffnet nur das Blatt. Gedämpft wurde er früher, weil er
  // sofort schaltete und für die Sekunden der Funkfahrt zum
  // Doppeltippen einlud - jede Store bekam den Befehl dann zweimal. Das
  // Schalten liegt jetzt hinter dem Knopf im Blatt, und der schliesst
  // es im selben Zug.
  const [offen, setOffen] = useState<TagesGriff | null>(null);
  // Die Ausgenommenen je Blatt. Beim Öffnen leer: Der Griff meint, was
  // er sagt - das Häkchen ist zum Ausnehmen da, nicht zum Auswählen.
  const [ohne, setOhne] = useState<string[]>([]);
  const griffe = tagesGriffe(entities, now);

  // Das offene Blatt lebt vom frisch gerechneten Griff und nicht von
  // dem, der beim Tippen galt: Geht währenddessen ein Licht aus,
  // verschwindet es aus der Liste, statt als Leiche stehen zu bleiben.
  const blatt = offen ? griffe.find((griff) => griff.key === offen.key) ?? null : null;
  const dran = blatt ? blatt.befehle.filter((b) => !ohne.includes(b.entityId)) : [];

  const ausfuehren = () => {
    if (!blatt) return;
    setOffen(null);
    for (const befehl of dran) onCommand(befehl.entityId, befehl.command);
  };

  if (griffe.length === 0) return null;

  return (
    <View style={styles.zeile}>
      {griffe.map((griff) => (
        <Pressable
          key={griff.key}
          onPress={() => {
            setOhne([]);
            setOffen(griff);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${griff.label} – zeigt zuerst, was betroffen ist`}
          style={({ pressed }) => [styles.griff, pressed && { opacity: 0.5 }]}
        >
          <Ionicons name={griff.icon} size={15} color={colors.accent} />
          <Text style={styles.text}>{griff.label}</Text>
        </Pressable>
      ))}

      <Modal
        visible={blatt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOffen(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.heading}>{blatt?.titel}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(blatt?.befehle ?? []).map((befehl) => {
                const mit = !ohne.includes(befehl.entityId);
                return (
                  <Pressable
                    key={befehl.entityId}
                    onPress={() =>
                      setOhne((bisher) =>
                        mit
                          ? [...bisher, befehl.entityId]
                          : bisher.filter((id) => id !== befehl.entityId)
                      )
                    }
                    accessibilityRole="switch"
                    accessibilityState={{ checked: mit }}
                    style={styles.row}
                  >
                    <Ionicons
                      name={mit ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={mit ? colors.accent : colors.inkFaint}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, !mit && { color: colors.inkFaint }]}>
                        {befehl.name}
                      </Text>
                      <Text style={styles.rowDetail}>{befehl.room ?? 'ohne Raum'}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.hint}>
              Antippen nimmt ein Gerät aus – der Rest wird geschaltet.
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={() => setOffen(null)} style={styles.cancel}>
                <Text style={styles.cancelText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                onPress={ausfuehren}
                disabled={dran.length === 0}
                accessibilityState={{ disabled: dran.length === 0 }}
                style={[styles.confirm, dran.length === 0 && { opacity: 0.4 }]}
              >
                <Text style={styles.confirmText}>
                  {dran.length} {blatt?.tunWort}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    griff: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    text: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 460,
      gap: 10,
      padding: 18,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: colors.inkFaint, fontSize: 12 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    cancelText: { color: colors.inkSoft, fontSize: 15, fontWeight: '700' },
    confirm: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
