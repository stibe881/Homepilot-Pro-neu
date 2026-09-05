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
/** Die Kartenarten, die der Hub kennt (core/livekarten.py und die
 *  Haustür-Karte). Die Schlüssel sind die Vorsilben der Karten-IDs. */
const KARTEN: { key: string; label: string }[] = [
  { key: 'tuer', label: 'Haustüre, wenn du unterwegs bist' },
  { key: 'timer', label: 'Küchen-Timer' },
  { key: 'geraet', label: 'Waschmaschine & Geschirrspüler' },
  { key: 'grill', label: 'Grill' },
  { key: 'sauger', label: 'Saugroboter' },
  { key: 'tv', label: 'Fernbedienung, solange der Fernseher läuft' },
  { key: 'erinnerung', label: 'Fällige Erinnerungen' },
  { key: 'alarm', label: 'Alarmanlage' },
];

export function LiveTuerSchalter({
  settings,
  enabled,
  onChange,
  aus,
  onAus,
  tuerKnopf,
  onTuerKnopf,
}: {
  settings: HubSettings;
  /** Fehlt der Wert in den Einstellungen, gilt an. */
  enabled: boolean;
  onChange: (on: boolean) => void;
  /** Abbestellte Kartenarten - die Feinregelung darunter. */
  aus: string[];
  onAus: (keys: string[]) => void;
  /** Der Öffnen-Knopf auf der Haustür-Karte, der ohne Entsperren
   *  funktioniert. Standard aus - siehe UserPrefs.tuerKnopf. */
  tuerKnopf: boolean;
  onTuerKnopf: (on: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Ob der Hub überhaupt dafür eingerichtet ist (apns-Block). Ohne ihn
  // ist der Schalter eine Attrappe - das soll dann auch dastehen.
  const [eingerichtet, setEingerichtet] = useState<boolean | null>(null);
  // Warum gerade keine Karte da ist - der Hub weiss es, und ohne diesen
  // Satz war es dreimal Raten: Zwischen «Schalter an» und «Karte liegt
  // da» hängen acht Glieder, und die meisten schweigen, wenn sie fehlen.
  const [grund, setGrund] = useState<string | null>(null);
  const [telefone, setTelefone] = useState<string[]>([]);
  const [neuGeladen, setNeuGeladen] = useState(0);

  useEffect(() => {
    let weg = false;
    fetch(`${settings.url.replace(/\/+$/, '')}/api/liveactivity`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    })
      .then((antwort) => (antwort.ok ? antwort.json() : null))
      .then((daten) => {
        if (weg || !daten) return;
        setEingerichtet(!!daten.configured);
        setGrund(typeof daten.reason === 'string' ? daten.reason : null);
        setTelefone(Array.isArray(daten.phones) ? daten.phones : []);
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [settings.url, settings.token, neuGeladen]);

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
              ? 'Karten auf dem Sperrbildschirm, solange etwas läuft - darunter wählst du, welche.'
              : 'Aus: Es erscheinen keine Karten auf dem Sperrbildschirm.'}
          </Text>
        </View>
        <Ionicons
          name={enabled ? 'toggle' : 'toggle-outline'}
          size={30}
          color={enabled ? colors.accent : colors.inkFaint}
        />
      </Pressable>
      {enabled ? (
        <View style={styles.liste}>
          {KARTEN.map((karte) => {
            const an = !aus.includes(karte.key);
            return (
              <Pressable
                key={karte.key}
                onPress={() =>
                  onAus(
                    an
                      ? [...aus, karte.key]
                      : aus.filter((key) => key !== karte.key)
                  )
                }
                accessibilityRole="switch"
                accessibilityState={{ checked: an }}
                accessibilityLabel={`Karte: ${karte.label}`}
                style={({ pressed }) => [styles.zeile, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.zeileText, !an && { color: colors.inkFaint }]}>
                  {karte.label}
                </Text>
                <Ionicons
                  name={an ? 'toggle' : 'toggle-outline'}
                  size={26}
                  color={an ? colors.accent : colors.inkFaint}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* Der Knopf ohne Entsperren - bewusst unter der Kartenliste und
          mit Warntext: Wer ihn setzt, soll wissen, was er eintauscht.
          Nur sichtbar, solange die Haustür-Karte überhaupt kommt. */}
      {enabled && !aus.includes('tuer') ? (
        <>
          <Pressable
            onPress={() => onTuerKnopf(!tuerKnopf)}
            accessibilityRole="switch"
            accessibilityState={{ checked: tuerKnopf }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name="flash-outline"
              size={22}
              color={tuerKnopf ? colors.warn : colors.inkSoft}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Öffnen ohne Entsperren</Text>
              <Text style={styles.hint}>
                Der Öffnen-Knopf auf der Haustür-Karte wirkt direkt vom
                Sperrbildschirm. Braucht den neuesten TestFlight-Build -
                auf älteren führt der Knopf weiter in die App, mit
                Rückfrage.
              </Text>
            </View>
            <Ionicons
              name={tuerKnopf ? 'toggle' : 'toggle-outline'}
              size={30}
              color={tuerKnopf ? colors.warn : colors.inkFaint}
            />
          </Pressable>
          {tuerKnopf ? (
            <Text style={styles.warn}>
              Achtung: Jede Person mit diesem iPhone in der Hand kann damit
              die Haustüre öffnen - ohne Code, ohne Face ID, ohne Rückfrage.
              Geht das Telefon verloren, den Schalter sofort auf einem
              anderen Gerät ausschalten oder den Zugang unter
              Benutzerverwaltung sperren.
            </Text>
          ) : null}
        </>
      ) : null}
      {eingerichtet === false ? (
        <Text style={styles.warn}>
          Der Hub ist dafür noch nicht eingerichtet - es fehlt der
          apns-Block in der config.yaml (Anleitung: deploy/portainer.md).
        </Text>
      ) : null}
      {/* Die Auskunft des Hubs. Sie steht auch dann da, wenn alles
          stimmt («Die Karte müsste jetzt kommen») - eine Zeile, die nur
          bei Störung erscheint, lässt einen im Zweifel, ob sie
          überhaupt funktioniert. */}
      {enabled && grund ? (
        <Pressable
          onPress={() => setNeuGeladen((n) => n + 1)}
          accessibilityRole="button"
          accessibilityLabel="Stand der Haustür-Karte neu abfragen"
          style={({ pressed }) => [styles.stand, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.inkFaint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.hint}>{grund}</Text>
            {telefone.length > 0 ? (
              <Text style={styles.hint}>
                Angemeldet: {telefone.join(', ')} · zum Auffrischen tippen
              </Text>
            ) : null}
          </View>
        </Pressable>
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
    liste: { gap: 2, marginLeft: 34 },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 3,
    },
    zeileText: { color: colors.inkSoft, fontSize: 13, flexShrink: 1 },
    stand: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingTop: 2,
    },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    warn: { color: colors.warn, fontSize: 12, lineHeight: 17 },
  });
