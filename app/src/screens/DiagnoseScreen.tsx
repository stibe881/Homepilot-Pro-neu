/**
 * Die Prüfwerkzeuge des Hubs, aus der App aufrufbar (Punkt 344).
 *
 * Fünf kleine Kommandozeilen-Programme (storencheck, livecheck, tvcheck,
 * saugercheck, pushcheck - die Fragen dazu stehen in der Werkbank-
 * Tabelle) brauchten bisher `docker exec` auf dem Rechner im Haus. Diese
 * Seite ruft dieselben Programme über /api/diagnose auf und zeigt ihre
 * Textausgabe unverändert - wer sie vom Terminal kennt, sieht hier
 * wortwörtlich dasselbe, nur ohne Terminal.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Fehlschlag, Umriss } from '../components/Zustand';
import { Colors, radius, space, useColors } from '../theme';

// Kein Font, den der Hub mitliefert - der plattformeigene reicht für
// eine Ausgabe, die man nur lesen, nicht gestalten will.
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

interface Werkzeug {
  key: string;
  satz: string;
  flags: string[];
}

/** Für welches Werkzeug welches Flag was heisst - nur für die
 *  Beschriftung, die Freigabe steht beim Hub (api/routes/diagnose.py). */
const FLAG_LABEL: Record<string, string> = {
  funk: 'Jede Store zusätzlich über Funk fragen',
  kalt: 'Mit kaltem Kamerastart messen',
};

export function DiagnoseScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const [werkzeuge, setWerkzeuge] = useState<Werkzeug[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Welches Werkzeug (mit welchem Flag) gerade läuft - `null` heisst keines.
  const [laeuft, setLaeuft] = useState<string | null>(null);
  // Ergebnis je "werkzeug" oder "werkzeug:flag" - mehrere Läufe bleiben
  // nebeneinander stehen, bis man wegnavigiert.
  const [ergebnisse, setErgebnisse] = useState<
    Record<string, { text: string; exitCode: number }>
  >({});

  useEffect(() => {
    hub
      .get<{ werkzeuge?: Werkzeug[] } | null>('/api/diagnose', {
        fallback: null,
        still: true,
      })
      .then((antwort) => {
        setWerkzeuge(antwort?.werkzeuge ?? []);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof HubFehler ? err.message : String(err))
      );
  }, [hub]);

  const starten = async (werkzeug: string, flag?: string) => {
    const schluessel = flag ? `${werkzeug}:${flag}` : werkzeug;
    setLaeuft(schluessel);
    try {
      const antwort = await hub.get<{ text: string; exit_code: number }>(
        `/api/diagnose/${encodeURIComponent(werkzeug)}` + (flag ? `?flag=${flag}` : '')
      );
      setErgebnisse((vorher) => ({
        ...vorher,
        [schluessel]: { text: antwort.text, exitCode: antwort.exit_code },
      }));
    } catch (err) {
      setErgebnisse((vorher) => ({
        ...vorher,
        [schluessel]: {
          text: err instanceof HubFehler ? err.message : String(err),
          exitCode: -1,
        },
      }));
    } finally {
      setLaeuft(null);
    }
  };

  if (error) {
    return <Fehlschlag text={`Prüfwerkzeuge nicht abrufbar: ${error}`} />;
  }
  if (werkzeuge === null) {
    return <Umriss was="Prüfwerkzeuge" zeilen={5} hoehe={64} />;
  }

  return (
    <ScrollView style={styles.stack} contentContainerStyle={{ gap: space.gap }}>
      <Text style={styles.hinweis}>
        Dieselben fünf Programme, die vorher nur per «docker exec» auf dem
        Rechner im Haus liefen - hier laufen sie im Hub und die Ausgabe
        kommt unverändert hierher.
      </Text>
      {werkzeuge.map((werkzeug) => (
        <Card key={werkzeug.key} style={styles.card}>
          <Text style={styles.titel}>{werkzeug.key}</Text>
          <Text style={styles.satz}>{werkzeug.satz}</Text>
          <View style={styles.knopfReihe}>
            <Pressable
              onPress={() => starten(werkzeug.key)}
              disabled={laeuft !== null}
              accessibilityRole="button"
              accessibilityLabel={`${werkzeug.key} prüfen`}
              style={({ pressed }) => [
                styles.knopf,
                pressed && { opacity: 0.7 },
                laeuft !== null && { opacity: 0.5 },
              ]}
            >
              {laeuft === werkzeug.key ? (
                <Text style={styles.knopfText}>Läuft …</Text>
              ) : (
                <>
                  <Ionicons name="play-outline" size={15} color={colors.on} />
                  <Text style={styles.knopfText}>Prüfen</Text>
                </>
              )}
            </Pressable>
            {werkzeug.flags.map((flag) => (
              <Pressable
                key={flag}
                onPress={() => starten(werkzeug.key, flag)}
                disabled={laeuft !== null}
                accessibilityRole="button"
                accessibilityLabel={FLAG_LABEL[flag] ?? flag}
                style={({ pressed }) => [
                  styles.knopfZart,
                  pressed && { opacity: 0.7 },
                  laeuft !== null && { opacity: 0.5 },
                ]}
              >
                <Text style={styles.knopfZartText}>
                  {laeuft === `${werkzeug.key}:${flag}`
                    ? 'Läuft …'
                    : FLAG_LABEL[flag] ?? `--${flag}`}
                </Text>
              </Pressable>
            ))}
          </View>
          {[werkzeug.key, ...werkzeug.flags.map((flag) => `${werkzeug.key}:${flag}`)].map(
            (schluessel) => {
              const ergebnis = ergebnisse[schluessel];
              if (!ergebnis) return null;
              return (
                <View key={schluessel} style={styles.ausgabeBox}>
                  <View style={styles.ausgabeKopf}>
                    <Text style={styles.ausgabeTitel}>
                      {ergebnis.exitCode === 0 ? 'Ergebnis' : `Ergebnis (Code ${ergebnis.exitCode})`}
                    </Text>
                    <Pressable
                      onPress={() => Share.share({ message: ergebnis.text }).catch(() => {})}
                      accessibilityRole="button"
                      accessibilityLabel="Ausgabe teilen"
                      hitSlop={6}
                    >
                      <Ionicons name="share-outline" size={16} color={colors.inkSoft} />
                    </Pressable>
                  </View>
                  <ScrollView horizontal style={styles.ausgabeScroll}>
                    <Text style={styles.ausgabeText} selectable>
                      {ergebnis.text || '(keine Ausgabe)'}
                    </Text>
                  </ScrollView>
                </View>
              );
            }
          )}
        </Card>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { flex: 1 },
    hinweis: { color: colors.onGradientSoft, fontSize: 13, lineHeight: 19 },
    card: { gap: 8 },
    titel: { color: colors.ink, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
    satz: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
    knopfReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    knopfText: { color: colors.on, fontSize: 13, fontWeight: '700' },
    knopfZart: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfZartText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    ausgabeBox: {
      marginTop: 4,
      borderRadius: radius.control,
      backgroundColor: colors.panel,
      padding: 10,
      gap: 6,
    },
    ausgabeKopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    ausgabeTitel: { color: colors.inkSoft, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
    ausgabeScroll: { maxHeight: 320 },
    ausgabeText: {
      color: colors.ink,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: MONO,
    },
  });
