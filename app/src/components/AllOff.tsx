import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { Colors, radius, type, useColors } from '../theme';

/**
 * «Alles aus» – aber erst zeigen, was das heisst.
 *
 * Ohne Rückfrage ist der Knopf gefährlich: Er würde auch den Server im
 * Keller, den Kühlschrank an der Messsteckdose oder die Waschmaschine
 * mitten im Programm abschalten. Deshalb erst die Liste, mit der
 * Möglichkeit, einzelne Geräte auszunehmen – und laufende Haushaltgeräte
 * gar nicht erst angehakt.
 *
 * Der Weg über einzelne Kommandos statt einer Szene ist Absicht: Eine
 * Szene müsste gepflegt werden, und ein neu dazugekommenes Licht wäre
 * dann monatelang nicht dabei, ohne dass es jemandem auffällt.
 */

/** Was gerade an ist und sich ausschalten lässt (rein, testbar). */
export function switchableOn(entities: Entity[], locked: string[]): Entity[] {
  return entities.filter(
    (entity) =>
      !locked.includes(entity.id) &&
      entity.commands.includes('turn_off') &&
      entity.state.state === 'on'
  );
}

/**
 * Was standardmässig *nicht* mit abgeschaltet wird (rein, testbar).
 *
 * Ein laufendes Haushaltgerät mitten im Programm abzuschalten heisst
 * nasse Wäsche. Wer es trotzdem will, hakt es von Hand an.
 */
export function keepRunning(entity: Entity): boolean {
  return entity.kind === 'appliance' || entity.state.state === 'running';
}

export function AllOff({
  entities,
  locked = [],
  onCommand,
}: {
  entities: Entity[];
  /** Gesperrte Geräte – die tauchen hier gar nicht auf. */
  locked?: string[];
  onCommand: (entityId: string, command: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<string[]>([]);

  const on = switchableOn(entities, locked);

  const start = () => {
    setSkip(on.filter(keepRunning).map((entity) => entity.id));
    setOpen(true);
  };

  const run = () => {
    on
      .filter((entity) => !skip.includes(entity.id))
      .forEach((entity) => onCommand(entity.id, 'turn_off'));
    setOpen(false);
  };

  if (on.length === 0) return null;

  return (
    <>
      <Pressable
        onPress={start}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="power-outline" size={18} color={colors.ink} />
        <Text style={styles.buttonText}>Alles aus ({on.length})</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.heading}>Das würde ausgeschaltet</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {on.map((entity) => {
                const mit = !skip.includes(entity.id);
                return (
                  <Pressable
                    key={entity.id}
                    onPress={() =>
                      setSkip((prev) =>
                        mit ? [...prev, entity.id] : prev.filter((id) => id !== entity.id)
                      )
                    }
                    accessibilityRole="switch"
                    accessibilityState={{ checked: mit }}
                    style={styles.row}
                  >
                    <Ionicons
                      name={mit ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={mit ? colors.danger : colors.inkFaint}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, !mit && { color: colors.inkFaint }]}>
                        {entity.name}
                      </Text>
                      <Text style={styles.rowDetail}>
                        {entity.room ?? 'ohne Raum'}
                        {keepRunning(entity) ? ' · läuft gerade' : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.hint}>
              Laufende Haushaltgeräte sind zuerst abgewählt – mitten im
              Programm abschalten heisst nasse Wäsche.
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={() => setOpen(false)} style={styles.cancel}>
                <Text style={styles.cancelText}>Abbrechen</Text>
              </Pressable>
              <Pressable onPress={run} style={styles.confirm}>
                <Text style={styles.confirmText}>
                  {on.length - skip.length} ausschalten
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    buttonText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
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
      backgroundColor: colors.surfaceStrong,
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
      backgroundColor: colors.danger,
    },
    confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
