import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Zwei Werkzeuge für die Geräteliste, die es bisher nur von Hand gab.
 *
 * *Sammelaktion.* Mehrere Geräte markieren und in einem Zug einem Raum
 * oder einer Gruppe zuweisen. Bei fünfzig Geräten ist das der
 * Unterschied zwischen zehn Minuten und einem Abend.
 *
 * *Gerät ersetzen.* Geht eine Lampe kaputt, meldet sich die neue unter
 * einer anderen Kennung – und alle Verweise zeigen ins Leere: Szenen,
 * Abläufe, Favoriten, Raum, zusammengefasste Leuchten. Nichts davon
 * wirft einen Fehler; man merkt es Wochen später, wenn abends ein Licht
 * nicht mehr angeht. Der Hub hängt alles auf einmal um.
 */

export function DeviceTools({
  settings,
  headers,
  entities,
  alle,
  rooms,
  groups,
  onDone,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
  /** Die Geräte der aktuellen Ansicht – die Sammelaktion arbeitet auf
   *  ihnen, und genau das ist ihr Sinn: erst filtern, dann zuweisen. */
  entities: Entity[];
  /** Alle Geräte des Hauses – fürs Ersetzen. Dort wäre die gefilterte
   *  Liste falsch: Das neue Gerät heisst fast nie wie das alte. */
  alle: Entity[];
  rooms: string[];
  groups: string[];
  /** Nach einer Änderung: Liste neu laden. */
  onDone: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState<null | 'sammel' | 'ersetzen'>(null);
  const [gewaehlt, setGewaehlt] = useState<string[]>([]);
  const [alt, setAlt] = useState<string | null>(null);
  const [neu, setNeu] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const schliessen = () => {
    setOffen(null);
    setGewaehlt([]);
    setAlt(null);
    setNeu(null);
  };

  const nameOf = (id: string) => alle.find((e) => e.id === id)?.name ?? id;

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const setzeRaum = async (raum: string | null) => {
    setBusy(true);
    setNote(null);
    try {
      for (const id of gewaehlt) {
        await hub.put(`/api/entities/${encodeURIComponent(id)}/room`, { room: raum }, {
          still: true,
        });
      }
      setNote(
        `${gewaehlt.length} Geräte ${raum ? `nach ${raum}` : 'ohne Raum'} verschoben.`
      );
      schliessen();
      onDone();
    } catch (err: any) {
      setNote(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const setzeGruppe = async (gruppe: string | null) => {
    setBusy(true);
    setNote(null);
    try {
      for (const id of gewaehlt) {
        await hub.put(`/api/entities/${encodeURIComponent(id)}/meta`, { group: gruppe }, {
          still: true,
        });
      }
      setNote(
        `${gewaehlt.length} Geräte ${gruppe ? `in «${gruppe}»` : 'ohne Kategorie'}.`
      );
      schliessen();
      onDone();
    } catch (err: any) {
      setNote(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const ersetzen = async () => {
    if (!alt || !neu) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(
        `${settings.url}/api/entities/${encodeURIComponent(alt)}/replace/${encodeURIComponent(neu)}`,
        { method: 'POST', headers }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
      const stellen = Object.entries(body.changed ?? {});
      setNote(
        stellen.length === 0
          ? `Nichts umzuhängen – auf «${nameOf(alt)}» zeigte nirgends etwas.`
          : `Umgehängt: ${stellen.map(([was, wie]) => `${was} (${wie})`).join(', ')}.`
      );
      schliessen();
      onDone();
    } catch (err: any) {
      setNote(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Werkzeuge</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => setOffen('sammel')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="albums-outline" size={17} color={colors.ink} />
          <Text style={styles.buttonText}>Mehrere zuweisen</Text>
        </Pressable>
        <Pressable
          onPress={() => setOffen('ersetzen')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="swap-horizontal-outline" size={17} color={colors.ink} />
          <Text style={styles.buttonText}>Gerät ersetzen</Text>
        </Pressable>
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Modal visible={offen !== null} animationType="slide" onRequestClose={schliessen}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>
              {offen === 'sammel' ? 'Mehrere zuweisen' : 'Gerät ersetzen'}
            </Text>
            <Pressable onPress={schliessen} accessibilityLabel="Schliessen">
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          </View>

          {offen === 'sammel' ? (
            <>
              <Text style={styles.hint}>
                Antippen wählt aus. Unten gilt die Zuweisung für alle
                Markierten auf einmal.
              </Text>
              <ScrollView contentContainerStyle={styles.chipWrap}>
                {entities.map((entity) => {
                  const aktiv = gewaehlt.includes(entity.id);
                  return (
                    <Pressable
                      key={entity.id}
                      onPress={() =>
                        setGewaehlt((prev) =>
                          prev.includes(entity.id)
                            ? prev.filter((id) => id !== entity.id)
                            : [...prev, entity.id]
                        )
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: aktiv }}
                      style={[styles.chip, aktiv && styles.chipActive]}
                    >
                      {aktiv ? (
                        <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                      ) : null}
                      <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>
                        {entity.name}
                        {entity.room ? ` · ${entity.room}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {gewaehlt.length > 0 ? (
                <View style={styles.footer}>
                  <Text style={styles.footerLabel}>
                    {gewaehlt.length} gewählt – in welchen Raum?
                  </Text>
                  <View style={styles.chipWrap}>
                    {[...rooms, null].map((raum) => (
                      <Pressable
                        key={raum ?? '__kein'}
                        disabled={busy}
                        onPress={() => setzeRaum(raum)}
                        style={[styles.chip, busy && { opacity: 0.5 }]}
                      >
                        <Text style={styles.chipText}>{raum ?? 'Kein Raum'}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {groups.length > 0 ? (
                    <>
                      <Text style={styles.footerLabel}>… oder welche Kategorie?</Text>
                      <View style={styles.chipWrap}>
                        {[...groups, null].map((gruppe) => (
                          <Pressable
                            key={gruppe ?? '__keine'}
                            disabled={busy}
                            onPress={() => setzeGruppe(gruppe)}
                            style={[styles.chip, busy && { opacity: 0.5 }]}
                          >
                            <Text style={styles.chipText}>
                              {gruppe ?? 'Keine Kategorie'}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Für den Lampentausch: Alles, was auf das alte Gerät zeigt –
                Szenen, Abläufe, Favoriten, Raum, zusammengefasste Leuchten –
                hängt danach am neuen. Das alte Gerät bleibt bestehen; wenn
                es weg ist, verschwindet es beim nächsten Start von selbst.
              </Text>
              <ScrollView>
                <Text style={styles.footerLabel}>Altes Gerät</Text>
                <View style={styles.chipWrap}>
                  {alle.map((entity) => (
                    <Pressable
                      key={entity.id}
                      onPress={() => setAlt(entity.id === alt ? null : entity.id)}
                      style={[styles.chip, alt === entity.id && styles.chipActive]}
                    >
                      <Text
                        style={[styles.chipText, alt === entity.id && styles.chipTextActive]}
                      >
                        {entity.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.footerLabel}>Neues Gerät</Text>
                <View style={styles.chipWrap}>
                  {alle
                    .filter((entity) => entity.id !== alt)
                    .map((entity) => (
                      <Pressable
                        key={entity.id}
                        onPress={() => setNeu(entity.id === neu ? null : entity.id)}
                        style={[styles.chip, neu === entity.id && styles.chipActive]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            neu === entity.id && styles.chipTextActive,
                          ]}
                        >
                          {entity.name}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </ScrollView>
              <Pressable
                onPress={ersetzen}
                disabled={!alt || !neu || busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primary,
                  (!alt || !neu || busy || pressed) && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.primaryText}>
                  {alt && neu
                    ? `«${nameOf(alt)}» durch «${nameOf(neu)}» ersetzen`
                    : 'Beide Geräte wählen'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: { flexDirection: 'row', gap: 8 },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      flex: 1,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    buttonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    note: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
    sheet: {
      flex: 1,
      backgroundColor: colors.panel,
      padding: 20,
      paddingTop: 60,
      gap: 12,
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    hint: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    footer: { gap: 6, borderTopWidth: 1, borderTopColor: colors.surfaceBorder, paddingTop: 10 },
    footerLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700', marginTop: 6 },
    primary: {
      alignItems: 'center',
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
