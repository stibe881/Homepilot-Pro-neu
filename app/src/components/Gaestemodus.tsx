import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { Gaestestand, restText } from '../lib/gaeste';
import { Colors, radius, type, useColors } from '../theme';

/**
 * «Besuch kommt» als ein Griff.
 *
 * Sonst tut man jedes Mal dasselbe an vier Orten: WLAN weitergeben, im
 * Eingang Licht machen, die Abläufe anhalten – und am Ende alles wieder
 * zurück. Den letzten Schritt vergisst man, deshalb hat der Modus eine
 * Frist und endet von selbst (hub/core/gaeste.py).
 *
 * Was er nicht anfasst: die Alarmanlage. Ein Gästeknopf, der sie
 * entschärft, wäre kein Komfort mehr, sondern ein Loch.
 */

const STUNDEN = [2, 4, 6, 8];

export function Gaestemodus({
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
  const [stand, setStand] = useState<Gaestestand | null>(null);
  const [lichter, setLichter] = useState<string[]>([]);
  const [stunden, setStunden] = useState(4);
  const [wlan, setWlan] = useState<{ ssid: string; payload: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now());

  const laden = useCallback(() => {
    hub
      .get<Gaestestand | null>('/api/guestmode', { fallback: null, still: true })
      .then((data) => {
        if (!data) return;
        setStand(data);
        setLichter(data.lights ?? []);
        setJetzt(Date.now());
      });
    // Kein Gäste-WLAN eingerichtet sieht gleich aus wie keine Antwort -
    // dann zeigt das Blatt eben keinen Code.
    hub
      .get<{ ssid: string; payload: string } | null>('/api/wifi', {
        fallback: null,
        still: true,
      })
      .then(setWlan);
  }, [hub]);

  useEffect(() => {
    if (offen) laden();
  }, [offen, laden]);

  const lampen = entities.filter(
    (entity) => entity.kind === 'light' && !entity.combined_into
  );

  const starten = async () => {
    setBusy(true);
    try {
      const antwort = await hub.post<Gaestestand | null>(
        '/api/guestmode',
        { hours: stunden, lights: lichter },
        { fallback: null }
      );
      if (antwort) setStand(antwort);
      setJetzt(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const beenden = async () => {
    setBusy(true);
    try {
      const antwort = await hub.del<Gaestestand | null>('/api/guestmode', {
        fallback: null,
      });
      if (antwort) setStand(antwort);
    } finally {
      setBusy(false);
    }
  };

  const laeuft = !!stand?.active;

  return (
    <Modal visible={offen} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>{laeuft ? 'Besuch da' : 'Besuch kommt'}</Text>

          <ScrollView style={{ maxHeight: 460 }}>
            {laeuft ? (
              <Text style={styles.laeuft}>
                Läuft noch {restText(stand, jetzt)}
                {stand?.by ? ` · gestartet von ${stand.by}` : ''}
              </Text>
            ) : (
              <>
                <Text style={styles.label}>Wie lange</Text>
                <View style={styles.chips}>
                  {STUNDEN.map((wert) => (
                    <Pressable
                      key={wert}
                      onPress={() => setStunden(wert)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: stunden === wert }}
                      style={[styles.chip, stunden === wert && styles.chipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          stunden === wert && styles.chipTextActive,
                        ]}
                      >
                        {wert} Std
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Licht zum Empfang</Text>
                <View style={styles.chips}>
                  {lampen.map((entity) => {
                    const an = lichter.includes(entity.id);
                    return (
                      <Pressable
                        key={entity.id}
                        onPress={() =>
                          setLichter((liste) =>
                            an
                              ? liste.filter((id) => id !== entity.id)
                              : [...liste, entity.id]
                          )
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: an }}
                        style={[styles.chip, an && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, an && styles.chipTextActive]}>
                          {entity.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hint}>
                  Solange der Modus läuft, ruhen die Abläufe – damit nicht
                  mitten im Abend die Storen fahren, weil kein Telefon mehr
                  zuhause gemeldet ist. Danach steht alles wieder wie vorher.
                  Die Alarmanlage bleibt unberührt.
                </Text>
              </>
            )}

            {/* Der QR-Code auch vor dem Start: Oft ist er der eigentliche
                Grund, warum jemand dieses Blatt öffnet. */}
            {wlan ? (
              <View style={styles.wlan}>
                <View style={styles.qr}>
                  <QRCode value={wlan.payload} size={150} backgroundColor="#FFFFFF" />
                </View>
                <Text style={styles.hint}>
                  Gäste-WLAN «{wlan.ssid}» – mit der Kamera scannen.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>Schliessen</Text>
            </Pressable>
            <Pressable
              onPress={() => void (laeuft ? beenden() : starten())}
              disabled={busy}
              style={[styles.confirm, busy && { opacity: 0.6 }]}
            >
              <Ionicons
                name={laeuft ? 'stop-outline' : 'people-outline'}
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.confirmText}>
                {laeuft ? 'Beenden' : 'Gästemodus starten'}
              </Text>
            </Pressable>
          </View>
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
      maxWidth: 480,
      gap: 10,
      padding: 18,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    laeuft: { color: colors.on, fontSize: 15, fontWeight: '600', paddingVertical: 6 },
    label: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', marginTop: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    chip: {
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18, marginTop: 8 },
    wlan: { alignItems: 'center', marginTop: 12, gap: 6 },
    qr: { padding: 10, borderRadius: radius.control, backgroundColor: '#FFFFFF' },
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
