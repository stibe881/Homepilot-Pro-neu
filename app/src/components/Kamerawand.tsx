/**
 * Alle Kameras nebeneinander, gross.
 *
 * Die Kameraseite zeigt Kacheln – gut zum Suchen, schlecht zum Schauen.
 * Wer wissen will, ob draussen jemand steht, will nicht sechsmal
 * antippen, sondern einmal hinsehen. Fürs Tablet im Flur und für den
 * Fernseher ist das die einzige sinnvolle Ansicht.
 *
 * Bewusst Standbilder und kein Video: Sechs Live-Ströme gleichzeitig
 * bringen jedes Tablet zum Schwitzen und die Kameras zum Drosseln. Die
 * Bilder werden regelmässig neu geholt; wer eines gross und live will,
 * tippt es an – dann öffnet sich die Vollbildansicht, die es schon gibt.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Entity } from '../api/types';
import { spalten } from '../lib/kamerawand';
import { Colors, radius, type, useColors } from '../theme';

/** Wie oft die Bilder neu geholt werden. */
const TAKT_MS = 8000;

export function Kamerawand({
  kameras,
  bildUrl,
  onOeffnen,
  onClose,
}: {
  kameras: Entity[];
  bildUrl: (entity: Entity) => string | undefined;
  /** Eine Kamera gross und live – die Vollbildansicht, die es schon gibt. */
  onOeffnen: (entity: Entity) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  // Der Zähler hängt an den Bildadressen: Ohne ihn zeigt das Telefon das
  // Bild aus seinem Zwischenspeicher, und die Wand steht still.
  const [runde, setRunde] = useState(0);

  useEffect(() => {
    const takt = setInterval(() => setRunde((wert) => wert + 1), TAKT_MS);
    return () => clearInterval(takt);
  }, []);

  const anzahl = kameras.length;
  const je = spalten(width, anzahl);
  const kachelBreite = (width - 24 - (je - 1) * 8) / je;
  const zeilen = Math.ceil(anzahl / je);
  // Höhe so, dass alles auf den Schirm passt: Eine Wand, für die man
  // scrollen muss, ist keine Wand.
  const kachelHoehe = Math.max(120, (height - 120 - (zeilen - 1) * 8) / zeilen);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.grund}>
        <View style={styles.kopf}>
          <Text style={styles.titel}>
            {anzahl === 1 ? '1 Kamera' : `${anzahl} Kameras`}
          </Text>
          <Pressable onPress={onClose} accessibilityLabel="Schliessen" hitSlop={10}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={styles.wand}>
          {kameras.map((kamera) => {
            const uri = bildUrl(kamera);
            return (
              <Pressable
                key={kamera.id}
                onPress={() => onOeffnen(kamera)}
                accessibilityRole="button"
                accessibilityLabel={`${kamera.name} gross zeigen`}
                style={({ pressed }) => [
                  styles.kachel,
                  { width: kachelBreite, height: kachelHoehe },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {uri ? (
                  <Image
                    source={{ uri: `${uri}&r=${runde}` }}
                    style={styles.bild}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.bild, styles.ohneBild]}>
                    <Ionicons name="videocam-off-outline" size={22} color="#8A8A8E" />
                  </View>
                )}
                <View style={styles.leiste}>
                  <Text style={styles.name} numberOfLines={1}>
                    {kamera.name}
                  </Text>
                  {kamera.state?.motion === 'on' ? (
                    <View style={styles.bewegung}>
                      <Ionicons name="walk" size={12} color="#FFFFFF" />
                    </View>
                  ) : null}
                  {!kamera.available ? (
                    <Text style={styles.weg}>weg</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (_colors: Colors) =>
  StyleSheet.create({
    // Schwarz, unabhängig vom Thema: Ein Bild liest sich vor Schwarz
    // besser, und für eine Wand aus Kameras ist das der Zweck.
    grund: { flex: 1, backgroundColor: '#000000', paddingHorizontal: 12 },
    kopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 52,
      paddingBottom: 10,
    },
    titel: { color: '#FFFFFF', fontSize: type.cardTitle, fontWeight: '700' },
    wand: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    kachel: {
      borderRadius: radius.card,
      overflow: 'hidden',
      backgroundColor: '#111113',
    },
    bild: { width: '100%', height: '100%' },
    ohneBild: { alignItems: 'center', justifyContent: 'center' },
    leiste: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    name: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', flex: 1 },
    bewegung: {
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: '#E5484D',
    },
    weg: { color: '#8A8A8E', fontSize: 11 },
  });
