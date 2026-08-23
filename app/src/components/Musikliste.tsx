import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { warteTitel, warteschlange } from '../lib/musikliste';
import { Colors, radius, useColors } from '../theme';

/**
 * Was als Nächstes läuft – hinter dem Cover der Musikkarte.
 *
 * Die Karte zeigt den laufenden Titel; «und danach?» stand nirgends,
 * obwohl der Hub die Warteschlange mitschickt. Ein Fenster und keine
 * eigene Seite: Man will kurz nachsehen, ob das nächste Stück passt, und
 * dann weiterhören.
 *
 * Eigene Datei, weil zwei Karten dasselbe zeigen – die grosse in der
 * Seitenspalte und die Kachel auf der Startseite.
 */
export function Musikliste({
  state,
  offen,
  onClose,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any> | undefined;
  offen: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const zeilen = warteschlange(state);

  return (
    <Modal visible={offen} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.grund} onPress={onClose}>
        {/* Innen darf das Tippen nicht durchschlagen, sonst geht das
            Fenster beim Lesen zu. */}
        <Pressable style={styles.blatt} onPress={() => {}}>
          <View style={styles.kopf}>
            <Text style={styles.titel} numberOfLines={1}>
              {warteTitel(state)}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schliessen">
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>
          {zeilen.length === 0 ? (
            <Text style={styles.leer}>Gerade läuft nichts.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              {zeilen.map((zeile) => (
                <View key={zeile.key} style={styles.zeile}>
                  <Text
                    style={[styles.nummer, zeile.laeuft && { color: colors.accent }]}
                    numberOfLines={1}
                  >
                    {zeile.nummer}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.track, zeile.laeuft && { color: colors.accent }]}
                      numberOfLines={1}
                    >
                      {zeile.track}
                    </Text>
                    {zeile.artist ? (
                      <Text style={styles.artist} numberOfLines={1}>
                        {zeile.artist}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
          {/* Spotify gibt nur die nächsten Titel her, nicht die ganze
              Playlist – das gehört dazugesagt, sonst sucht man den Rest. */}
          {zeilen.length > 1 ? (
            <Text style={styles.hinweis}>Die nächsten Titel, so wie sie kommen.</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    grund: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    blatt: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: 20,
      paddingBottom: 32,
      gap: 10,
      maxHeight: '80%',
      // Auf dem iPad zöge sich die Liste sonst über die volle Breite.
      width: '100%',
      maxWidth: 520,
    },
    kopf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    titel: { color: colors.ink, fontSize: 18, fontWeight: '700', flex: 1 },
    leer: { color: colors.inkSoft, fontSize: 14, paddingVertical: 12 },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surfaceBorder,
    },
    // Feste Breite, damit die Titel untereinander stehen und nicht je
    // nach Ziffernzahl verspringen.
    nummer: { color: colors.inkFaint, fontSize: 12, width: 34 },
    track: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    artist: { color: colors.inkSoft, fontSize: 13 },
    hinweis: { color: colors.inkFaint, fontSize: 12 },
  });
