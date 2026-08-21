import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Colors, radius, useColors } from '../theme';
import { kann } from '../lib/plattform';

/** Was der Hub in den QR-Code schreibt. */
export interface ScannedSetup {
  url: string;
  token: string;
  name?: string;
}

export function parseSetup(raw: string): ScannedSetup | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data?.url === 'string' && typeof data?.token === 'string') {
      return { url: data.url, token: data.token, name: data.name };
    }
  } catch {
    // Kein JSON – dann war es ein fremder QR-Code.
  }
  return null;
}

/**
 * Scanner für den Einrichtungs-Code, den der Hub beim Start ausgibt.
 *
 * IP-Adresse und Token von Hand abzutippen ist der unschönste Moment der
 * App – ausgerechnet der erste.
 */
export function QrScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (setup: ScannedSetup) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // Ohne Sperre feuert die Kamera denselben Code mehrfach hintereinander.
  const [handled, setHandled] = useState(false);

  const handleScan = (raw: string) => {
    if (handled) return;
    const setup = parseSetup(raw);
    if (!setup) {
      setError('Das war kein HomePilot-Code. Der Hub zeigt ihn beim Start im Terminal.');
      return;
    }
    setHandled(true);
    onScanned(setup);
    onClose();
  };

  const body = () => {
    if (!kann.qrScan) {
      return (
        <Text style={styles.note}>
          Das Scannen funktioniert in der App auf iPhone und iPad. Im Browser
          bitte Adresse und Token von Hand eintragen.
        </Text>
      );
    }
    if (!permission) {
      return <Text style={styles.note}>Kamera wird vorbereitet …</Text>;
    }
    if (!permission.granted) {
      return (
        <View style={styles.center}>
          <Text style={styles.note}>
            Zum Scannen braucht die App Zugriff auf die Kamera.
          </Text>
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Kamera erlauben</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrapper}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => handleScan(data)}
        />
        <View style={styles.frame} pointerEvents="none" />
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>QR-Code scannen</Text>
          <Pressable onPress={onClose} accessibilityLabel="Scannen abbrechen">
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>
        {body()}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>
          Der Hub gibt den Code beim Start aus. Er enthält Adresse, Token und
          deinen Namen.
        </Text>
      </View>
    </Modal>
  );
}

/** Übernimmt die gescannten Werte in die Einstellungen. */
export function applySetup(current: HubSettings | null, setup: ScannedSetup): HubSettings {
  return {
    ...(current ?? { url: '', token: '' }),
    url: setup.url.replace(/\/+$/, ''),
    token: setup.token,
    name: setup.name || current?.name,
  };
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.gradient[1],
      padding: 22,
      gap: 18,
      paddingTop: 60,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    cameraWrapper: {
      flex: 1,
      borderRadius: radius.card,
      overflow: 'hidden',
      backgroundColor: '#000',
    },
    camera: { flex: 1 },
    frame: {
      position: 'absolute',
      top: '20%',
      left: '15%',
      right: '15%',
      bottom: '20%',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.85)',
      borderRadius: radius.card,
    },
    center: { alignItems: 'flex-start', gap: 14 },
    note: { color: colors.inkSoft, fontSize: 15, lineHeight: 22 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
    button: {
      backgroundColor: colors.ink,
      borderRadius: radius.control,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    buttonText: { color: colors.surfaceStrong, fontWeight: '700', fontSize: 15 },
  });
