import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../../api/types';
import { CameraLive } from '../../components/CameraLive';
import { CameraTimeline } from '../../components/CameraTimeline';
import { ClipArchiv } from '../../components/ClipArchiv';
import { useTakt } from '../../hooks/useTakt';
import { bildschichten, kameraSatz } from '../../lib/kamerabild';
import { Colors } from '../../theme';
import { DashboardStile } from './stile';

/**
 * Kamera im Vollbild: ein Tipp auf eine Kamerakachel macht das Standbild
 * gross und holt es alle drei Sekunden neu – die Kachel selbst bleibt bei
 * einem Bild pro Minute, damit die Übersicht nicht ständig lädt.
 *
 * **Warum das Standbild trotz Livestrom bleibt.** Gemeldet als «es geht
 * zum Teil lange, bis das Bild kommt»: Vorher zeigte das Vollbild
 * *entweder* den Strom *oder* das Standbild, und wenn die Kamera einen
 * Strom kann, gewann der - also stand man vor einem schwarzen Rechteck,
 * bis er lief. Das dauert, und zwar aus gutem Grund: Der Hub zapft die
 * Kamera erst an, wenn jemand zuschaut (core/streams.py, on-demand), und
 * bis mediamtx oder ffmpeg das erste Häppchen liefern, vergehen
 * Sekunden. Das Standbild ist in dieser Zeit längst da - ein Bild statt
 * einer schwarzen Fläche.
 *
 * Jetzt liegt es unter dem Strom und bleibt sichtbar, bis der wirklich
 * läuft (`onReady`). Danach hört auch der Drei-Sekunden-Takt auf: Ein
 * Standbild hinter einem laufenden Video kostet nur Bandbreite.
 */
export function CameraFullscreen({
  camera,
  uri,
  streamUri,
  settings,
  onClose,
  colors,
  styles,
}: {
  camera: Entity;
  uri?: string;
  streamUri?: string;
  settings: HubSettings;
  onClose: () => void;
  colors: Colors;
  styles: DashboardStile;
}) {
  const [tick, setTick] = useState(0);
  // Klappt der Livestrom nicht, bleibt das Standbild – lieber ein Bild alle
  // drei Sekunden als ein schwarzes Rechteck. Der Grund wird angezeigt,
  // sonst lässt sich aus der Ferne nichts diagnostizieren.
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  // Das Clip-Archiv (Punkt 256 der Werkbank): Die dauerhaften
  // Alarm-Mitschnitte wohnen bei den Kameras, weil man sie hier sucht –
  // die Zeitleiste darunter zeigt nur die flüchtigen 24 Stunden.
  const [archivOffen, setArchivOffen] = useState(false);
  // Läuft der Strom, ist das Standbild darunter nicht mehr nötig - und
  // sein Takt auch nicht.
  const [liveLaeuft, setLiveLaeuft] = useState(false);
  // Welche Schicht wann sichtbar ist, entscheidet lib/kamerabild.ts -
  // dort steht auch, warum (und ein Test, der die leere Fläche kennt).
  const stand = {
    online: camera.state.state === 'online',
    standbildDa: !!uri,
    liveMoeglich: !liveFailed && !!streamUri && camera.state.stream === true,
    liveLaeuft,
  };
  const schichten = bildschichten(stand);
  useTakt(() => setTick((value) => value + 1), schichten.standbild ? 3000 : null);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.doorbellRoot}>
        <Text style={styles.doorbellTitle}>{camera.name}</Text>
        <View style={styles.videoBox}>
          {schichten.standbild ? (
            <Image
              source={{ uri: `${uri}&t=${tick}` }}
              style={styles.doorbellImage}
              resizeMode="contain"
            />
          ) : schichten.leer ? (
            <View
              style={[
                styles.doorbellImage,
                { alignItems: 'center', justifyContent: 'center' },
              ]}
            >
              <Ionicons name="videocam-off-outline" size={40} color="#FFFFFF" />
              <Text style={styles.doorbellCloseText}>
                {schichten.leer === 'offline'
                  ? 'Kamera ist offline'
                  : 'Kein Bild verfügbar'}
              </Text>
            </View>
          ) : null}
          {/* Der Strom liegt darüber und ist durchsichtig, solange er
              noch anläuft - eingehängt muss er trotzdem sein, sonst
              beginnt er gar nicht zu laden. */}
          {schichten.live ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { justifyContent: 'center' },
                !schichten.liveSichtbar && { opacity: 0 },
              ]}
            >
              <CameraLive
                uri={streamUri!}
                label={`Live-Bild ${camera.name}`}
                style={styles.videoFrame}
                onFailed={(message) => {
                  setLiveFailed(message);
                  // Bricht der Strom nach dem Anlaufen ab, muss das
                  // Standbild zurückkommen - sonst bliebe die Fläche
                  // leer, weil beides ausgeblendet wäre.
                  setLiveLaeuft(false);
                }}
                onReady={() => setLiveLaeuft(true)}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.timelineBox}>
          <CameraTimeline
            entity={camera}
            settings={settings}
            refreshKey={String(camera.state.last_motion ?? '')}
          />
        </View>
        <View style={styles.doorbellButtons}>
          <Text
            style={[styles.doorbellCloseText, liveLaeuft ? { color: colors.danger } : null]}
          >
            {kameraSatz(stand, liveFailed, camera.state.motion === 'on')}
          </Text>
          <Pressable
            onPress={() => setArchivOffen(true)}
            accessibilityRole="button"
            accessibilityLabel="Archivierte Aufnahmen zeigen"
            style={styles.doorbellClose}
          >
            <Text style={styles.doorbellCloseText}>Aufnahmen</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.doorbellClose}>
            <Text style={styles.doorbellCloseText}>Schliessen</Text>
          </Pressable>
        </View>
        {archivOffen ? (
          <ClipArchiv settings={settings} onClose={() => setArchivOffen(false)} />
        ) : null}
      </View>
    </Modal>
  );
}
