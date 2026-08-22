import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { Colors, radius, type, useColors } from '../theme';

/**
 * «Gute Nacht» – der letzte Gang durchs Haus als ein Knopf.
 *
 * Lichter aus (ausser den Nachtlichtern), dann der Bericht: Welche
 * Fenster stehen offen, welche Tür ist nicht abgeschlossen – und auf
 * Wunsch geht die Alarmanlage in den Nachtmodus. Türen werden gemeldet,
 * nie abgeschlossen: Eine Tür, die sich von selbst verriegelt, sperrt
 * irgendwann jemanden aus.
 */

interface GoodNightSettings {
  night_lights: string[];
  arm_alarm: boolean;
}

interface GoodNightResult {
  lights_off: string[];
  kept_on: string[];
  open: string[];
  unlocked: string[];
  alarm: string | null;
  alarm_error: string | null;
}

export function GoodNight({
  settings,
  entities,
  mayEdit,
}: {
  settings: HubSettings;
  entities: Entity[];
  mayEdit: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<GoodNightSettings>({
    night_lights: [],
    arm_alarm: false,
  });
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<GoodNightResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  useEffect(() => {
    // Ohne Antwort gelten die Vorgaben - der Knopf funktioniert trotzdem.
    hub
      .get<any>('/api/goodnight', { fallback: null, still: true })
      .then((data) => {
        if (data) setConfig({ night_lights: data.night_lights ?? [], arm_alarm: !!data.arm_alarm });
      });
  }, [hub]);

  const lights = entities.filter(
    (entity) => entity.kind === 'light' && !entity.combined_into
  );
  const lit = lights.filter(
    (entity) =>
      entity.state.state === 'on' && !config.night_lights.includes(entity.id)
  );
  const hasAlarm = entities.some((entity) => entity.kind === 'alarm');

  const saveConfig = async (next: GoodNightSettings) => {
    setConfig(next);
    // Scheitert es, sagt die Einblendung des Clients warum; beim nächsten
    // Öffnen wird der gespeicherte Stand neu geladen.
    await hub.put('/api/goodnight', next, { fallback: null });
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await hub.post('/api/goodnight/run', undefined, { still: true }));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setResult(null);
    setEditing(false);
    setError(null);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="moon-outline" size={18} color={colors.ink} />
        <Text style={styles.buttonText}>Gute Nacht</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {result == null ? (
              <>
                <Text style={styles.heading}>Gute Nacht</Text>
                <Text style={styles.hint}>
                  Schaltet {lit.length} Licht{lit.length === 1 ? '' : 'er'} aus
                  {config.night_lights.length > 0
                    ? ` (Nachtlichter bleiben an)`
                    : ''}
                  {config.arm_alarm && hasAlarm
                    ? ', stellt die Alarmanlage auf Nacht'
                    : ''}{' '}
                  und meldet offene Fenster und nicht abgeschlossene Türen.
                </Text>

                {mayEdit ? (
                  <Pressable
                    onPress={() => setEditing((value) => !value)}
                    accessibilityRole="button"
                    style={styles.editToggle}
                  >
                    <Ionicons name="options-outline" size={15} color={colors.inkSoft} />
                    <Text style={styles.editToggleText}>
                      {editing ? 'Einstellungen zuklappen' : 'Einstellungen'}
                    </Text>
                  </Pressable>
                ) : null}

                {editing ? (
                  <ScrollView style={{ maxHeight: 300 }}>
                    <Text style={styles.label}>
                      Nachtlichter – bleiben beim Gute-Nacht-Knopf an
                    </Text>
                    <View style={styles.chips}>
                      {lights.map((entity) => {
                        const active = config.night_lights.includes(entity.id);
                        return (
                          <Pressable
                            key={entity.id}
                            onPress={() =>
                              saveConfig({
                                ...config,
                                night_lights: active
                                  ? config.night_lights.filter((id) => id !== entity.id)
                                  : [...config.night_lights, entity.id],
                              })
                            }
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: active }}
                            style={[styles.chip, active && styles.chipActive]}
                          >
                            <Text
                              style={[styles.chipText, active && styles.chipTextActive]}
                            >
                              {entity.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {hasAlarm ? (
                      <Pressable
                        onPress={() => saveConfig({ ...config, arm_alarm: !config.arm_alarm })}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: config.arm_alarm }}
                        style={styles.check}
                      >
                        <Ionicons
                          name={config.arm_alarm ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={config.arm_alarm ? colors.accent : colors.inkSoft}
                        />
                        <Text style={styles.checkText}>
                          Alarmanlage in den Nachtmodus stellen
                        </Text>
                      </Pressable>
                    ) : null}
                  </ScrollView>
                ) : null}

                {error ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text> : null}

                <View style={styles.actions}>
                  <Pressable onPress={close} style={styles.cancel}>
                    <Text style={styles.cancelText}>Abbrechen</Text>
                  </Pressable>
                  <Pressable
                    onPress={run}
                    disabled={busy}
                    style={[styles.confirm, busy && { opacity: 0.6 }]}
                  >
                    <Text style={styles.confirmText}>
                      {busy ? 'Läuft …' : 'Gute Nacht'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.heading}>Gute Nacht ✓</Text>
                <Text style={styles.hint}>
                  {result.lights_off.length > 0
                    ? `${result.lights_off.length} Licht${
                        result.lights_off.length === 1 ? '' : 'er'
                      } ausgeschaltet.`
                    : 'Es brannte kein Licht mehr.'}
                  {result.kept_on.length > 0
                    ? ` Nachtlicht bleibt: ${result.kept_on.join(', ')}.`
                    : ''}
                </Text>
                {result.alarm ? (
                  <Text style={styles.okLine}>Alarmanlage ist im Nachtmodus.</Text>
                ) : null}
                {result.alarm_error ? (
                  <Text style={styles.warnLine}>Alarm: {result.alarm_error}</Text>
                ) : null}
                {result.open.length > 0 ? (
                  <Text style={styles.warnLine}>
                    Noch offen: {result.open.join(', ')}
                  </Text>
                ) : (
                  <Text style={styles.okLine}>Alle Fenster und Türen sind zu.</Text>
                )}
                {result.unlocked.length > 0 ? (
                  <Text style={styles.warnLine}>
                    Nicht abgeschlossen: {result.unlocked.join(', ')}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  <Pressable onPress={close} style={styles.confirm}>
                    <Text style={styles.confirmText}>Schlaf gut</Text>
                  </Pressable>
                </View>
              </>
            )}
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
      backgroundColor: colors.gradient[1],
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    label: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 6,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
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
    check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    checkText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    editToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    editToggleText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    okLine: { color: colors.on, fontSize: 13, lineHeight: 19 },
    warnLine: { color: colors.warn, fontSize: 13, lineHeight: 19, fontWeight: '600' },
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
