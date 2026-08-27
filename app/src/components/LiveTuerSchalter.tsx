import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, type, useColors } from '../theme';

/**
 * Der Schalter für die Haustür-Karte auf dem Sperrbildschirm.
 *
 * Wie die Benachrichtigungen: je Person, nicht je Gerät - wer sie
 * abschaltet, schaltet sie auf allen seinen iPhones ab. Den Wert liest
 * auch der Hub (core/liveaktivitaet.py): Abschalten beendet eine gerade
 * liegende Karte sofort, nicht erst beim nächsten Heimkommen.
 */
export function LiveTuerSchalter({
  settings,
  enabled,
  onChange,
}: {
  settings: HubSettings;
  /** Fehlt der Wert in den Einstellungen, gilt an. */
  enabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Ob der Hub überhaupt dafür eingerichtet ist (apns-Block). Ohne ihn
  // ist der Schalter eine Attrappe - das soll dann auch dastehen.
  const [eingerichtet, setEingerichtet] = useState<boolean | null>(null);

  useEffect(() => {
    let weg = false;
    fetch(`${settings.url.replace(/\/+$/, '')}/api/liveactivity`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    })
      .then((antwort) => (antwort.ok ? antwort.json() : null))
      .then((daten) => {
        if (!weg && daten) setEingerichtet(!!daten.configured);
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [settings.url, settings.token]);

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => onChange(!enabled)}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name="key-outline"
          size={22}
          color={enabled ? colors.accent : colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Live-Aktivitäten auf dem Sperrbildschirm</Text>
          <Text style={styles.hint}>
            {enabled
              ? 'Karten, solange etwas läuft: Haustüre wenn du unterwegs bist, Küchen-Timer, Waschmaschine, Grill, Sauger, fällige Erinnerungen und die Alarmanlage.'
              : 'Aus: Es erscheinen keine Karten auf dem Sperrbildschirm.'}
          </Text>
        </View>
        <Ionicons
          name={enabled ? 'toggle' : 'toggle-outline'}
          size={30}
          color={enabled ? colors.accent : colors.inkFaint}
        />
      </Pressable>
      {eingerichtet === false ? (
        <Text style={styles.warn}>
          Der Hub ist dafür noch nicht eingerichtet - es fehlt der
          apns-Block in der config.yaml (Anleitung: deploy/portainer.md).
        </Text>
      ) : null}
      <Text style={styles.hint}>
        Gilt für dich auf allen deinen iPhones (ab iOS 17.2, mit
        TestFlight-Build{Platform.OS === 'ios' ? '' : ' - nicht auf diesem Gerät'}).
        Zusätzlich müssen Live-Aktivitäten in den iOS-Einstellungen der App
        erlaubt sein.
      </Text>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    warn: { color: colors.warn, fontSize: 12, lineHeight: 17 },
  });
