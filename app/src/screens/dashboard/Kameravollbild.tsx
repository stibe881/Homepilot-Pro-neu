import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';

import { Entity, HubSettings } from '../../api/types';
import { CameraLive } from '../../components/CameraLive';
import { CameraTimeline } from '../../components/CameraTimeline';
import { useTakt } from '../../hooks/useTakt';
import { Colors } from '../../theme';
import { DashboardStile } from './stile';

/**
 * Kamera im Vollbild: ein Tipp auf eine Kamerakachel macht das Standbild
 * gross und holt es alle drei Sekunden neu – die Kachel selbst bleibt bei
 * einem Bild pro Minute, damit die Übersicht nicht ständig lädt.
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
  useTakt(() => setTick((value) => value + 1), 3000);
  const online = camera.state.state === 'online';
  const live = online && !liveFailed && !!streamUri && camera.state.stream === true;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.doorbellRoot}>
        <Text style={styles.doorbellTitle}>{camera.name}</Text>
        {live ? (
          <View style={styles.videoBox}>
            <CameraLive
              uri={streamUri!}
              label={`Live-Bild ${camera.name}`}
              style={styles.videoFrame}
              onFailed={(message) => setLiveFailed(message)}
            />
          </View>
        ) : uri && online ? (
          <Image
            source={{ uri: `${uri}&t=${tick}` }}
            style={styles.doorbellImage}
            resizeMode="contain"
          />
        ) : (
          <View
            style={[
              styles.doorbellImage,
              { alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            <Ionicons name="videocam-off-outline" size={40} color="#FFFFFF" />
            <Text style={styles.doorbellCloseText}>
              {online ? 'Kein Bild verfügbar' : 'Kamera ist offline'}
            </Text>
          </View>
        )}
        <View style={styles.timelineBox}>
          <CameraTimeline
            entity={camera}
            settings={settings}
            refreshKey={String(camera.state.last_motion ?? '')}
          />
        </View>
        <View style={styles.doorbellButtons}>
          <Text style={[styles.doorbellCloseText, live ? { color: colors.danger } : null]}>
            {live
              ? '● Live'
              : liveFailed
                ? `Live-Bild nicht verfügbar (${liveFailed}) – Standbild alle 3 Sekunden`
                : 'Standbild alle 3 Sekunden'}
            {camera.state.motion === 'on' ? ' · Bewegung erkannt' : ''}
          </Text>
          <Pressable onPress={onClose} style={styles.doorbellClose}>
            <Text style={styles.doorbellCloseText}>Schliessen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
