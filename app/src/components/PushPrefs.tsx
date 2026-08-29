import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import { nachGruppen } from '../lib/pushgruppen';
import { epochTime } from '../lib/zeit';
import { Colors, type, useColors } from '../theme';

/**
 * Welche Push-Nachrichten dieser Benutzer bekommen will.
 *
 * Je Person, nicht global: Wen die schwache Batterie im Keller nicht
 * interessiert, der soll deswegen nicht den Alarm mit abschalten. Und
 * bewusst als «abbestellen» statt «bestellen» – eine neue Nachrichtenart
 * kommt damit erst einmal an, statt unbemerkt zu fehlen.
 */

interface Category {
  key: string;
  label: string;
  /** Unterkategorie, wie der Hub sie vergibt (core/push.py). */
  group?: string;
}

/** Die Kategorien in ihre Unterkategorien, wie der Hub sie vergibt.
 *
 * «test» absichtlich nirgends: Der Test kommt immer an, ein Schalter
 * dafür wäre eine Attrappe. Das Sortieren selbst steht in
 * lib/pushgruppen.ts – dieselbe Einteilung braucht die Liste unter
 * «Abläufe → Push». */
export function groupCategories(
  categories: Category[],
  order: string[] = []
): { title: string; items: Category[] }[] {
  return nachGruppen(
    categories.filter((category) => category.key !== 'test'),
    order
  );
}

export function PushPrefs({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Der Test gehört zu den Benachrichtigungen - wer hier einstellt, will
  // gleich wissen, ob überhaupt etwas ankommt, ohne zum System-Screen zu
  // wechseln.
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  // Zu: Die Karte listet dreizehn Schalter, die man einmal einstellt und
  // dann jahrelang nicht anfasst. Aufgeklappt schiebt sie alles darunter
  // aus dem Bild - unter «Konto & Verbindung» sucht man aber meist die
  // Hub-Adresse, nicht die Batteriewarnung.
  const [offen, setOffen] = useState(false);
  // Der Nachlese-Zettel: die letzten Meldungen, auch die weggewischten.
  const [logOffen, setLogOffen] = useState(false);
  const [log, setLog] = useState<
    { title: string; body: string; at: number; category?: string | null }[] | null
  >(null);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Die Karte zeigt Fehler selbst an - deshalb «still».
    hub
      .get<{
        categories?: Category[];
        groups?: string[];
        muted?: string[];
      }>('/api/push/categories', { still: true })
      .then((data) => {
        setCategories(data.categories ?? []);
        setGroupOrder(data.groups ?? []);
        setMuted(data.muted ?? []);
      })
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [hub]);

  // Erst laden, wenn jemand hinsieht: Zugeklappt ist die Antwort des
  // Hubs nichts wert, und beim Öffnen der Einstellungen laufen ohnehin
  // schon genug Abfragen los.
  useEffect(() => {
    if (offen) load();
  }, [offen, load]);

  const toggle = async (key: string) => {
    const next = muted.includes(key)
      ? muted.filter((entry) => entry !== key)
      : [...muted, key];
    // Sofort umschalten, damit das Antippen nicht hakt; der Hub bestätigt.
    setMuted(next);
    try {
      const data = await hub.put<{ muted?: string[] }>(
        '/api/push/categories',
        { muted: next },
        { still: true }
      );
      setMuted(data.muted ?? next);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      const data = await hub.post<{ sent?: number; errors?: string[] }>(
        '/api/push/test',
        undefined,
        { still: true }
      );
      const problems: string[] = Array.isArray(data.errors) ? data.errors : [];
      if (problems.length > 0) {
        setTestNote(problems.join(' '));
      } else if (Number(data.sent ?? 0) > 0) {
        setTestNote(`Zugestellt an ${data.sent} Gerät(e).`);
      } else {
        setTestNote('Kein Gerät angemeldet – die App auf dem Telefon einmal öffnen.');
      }
    } catch (err) {
      setTestNote(String(err instanceof Error ? err.message : err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOffen((war) => !war)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        style={({ pressed }) => [styles.headRow, pressed && { opacity: 0.8 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Benachrichtigungen</Text>
          <Text style={styles.hint}>
            Was auf dein Telefon kommt – gilt nur für dich.
          </Text>
        </View>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.inkFaint}
        />
      </Pressable>

      {!offen ? null : (
      <>
      <View style={styles.headRow}>
        <Text style={styles.hint}>
          Gilt nur für dich – andere im Haushalt stellen es für sich ein.
        </Text>
        <Pressable
          onPress={runTest}
          disabled={testing}
          accessibilityRole="button"
          style={({ pressed }) => [styles.testButton, (pressed || testing) && { opacity: 0.7 }]}
        >
          <Ionicons name="paper-plane-outline" size={14} color={colors.ink} />
          <Text style={styles.testText}>{testing ? 'Sendet …' : 'Push testen'}</Text>
        </Pressable>
      </View>
      {testNote ? <Text style={styles.hint}>{testNote}</Text> : null}

      {/* Was zuletzt gemeldet wurde - eine weggewischte Mitteilung war
          bisher unauffindbar, und «was hat vorhin gebrummt?» ist genau
          die Frage, die man mit dem Telefon in der Jacke hatte. */}
      <Pressable
        onPress={() => {
          const jetzt = !logOffen;
          setLogOffen(jetzt);
          if (jetzt && log == null) {
            hub
              .get<{ log?: typeof log } | null>('/api/push/log', {
                fallback: null,
                still: true,
              })
              .then((data) => setLog(data?.log ?? []));
          }
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: logOffen }}
        style={styles.logKopf}
      >
        <Ionicons name="time-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.logTitel}>Zuletzt gemeldet</Text>
        <Ionicons
          name={logOffen ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.inkSoft}
        />
      </Pressable>
      {logOffen ? (
        log == null ? (
          <Text style={styles.hint}>Wird geladen …</Text>
        ) : log.length === 0 ? (
          <Text style={styles.hint}>In den letzten Tagen kam nichts.</Text>
        ) : (
          log.slice(0, 20).map((eintrag, index) => (
            <View key={index} style={styles.logZeile}>
              <Text style={styles.logZeit}>{epochTime(eintrag.at)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {eintrag.title}
                </Text>
                {eintrag.body ? (
                  <Text style={styles.hint} numberOfLines={2}>
                    {eintrag.body}
                  </Text>
                ) : null}
              </View>
            </View>
          ))
        )
      ) : null}

      {error ? (
        <Text style={styles.hint}>Nicht abrufbar: {error}</Text>
      ) : categories == null ? (
        <Text style={styles.hint}>Wird geladen …</Text>
      ) : (
        groupCategories(categories, groupOrder).map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {/* flexWrap: Auf dem Telefon eine Spalte, auf dem breiten
                Schirm zwei bis drei - dieselbe Liste, ohne Sonderfall. */}
            <View style={styles.sectionRows}>
              {section.items.map((category) => {
                const on = !muted.includes(category.key);
                return (
                  <Pressable
                    key={category.key}
                    onPress={() => toggle(category.key)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    style={styles.row}
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={on ? colors.on : colors.inkFaint}
                    />
                    <Text
                      style={[styles.rowTitle, !on && { color: colors.inkFaint }]}
                      numberOfLines={1}
                    >
                      {category.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
      </>
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18, flexShrink: 1 },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    testButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    testText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    section: { gap: 2 },
    sectionTitle: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 4,
    },
    sectionRows: { flexDirection: 'row', flexWrap: 'wrap' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
      paddingRight: 16,
      // Breit genug für die längste Beschriftung, schmal genug, dass auf
      // einem breiten Schirm zwei bis drei nebeneinander stehen.
      minWidth: 290,
      flexGrow: 1,
      flexBasis: 290,
      maxWidth: 420,
    },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    logKopf: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    logTitel: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', flex: 1 },
    logZeile: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    logZeit: { color: colors.inkFaint, fontSize: 12, minWidth: 92, paddingTop: 1 },
  });
