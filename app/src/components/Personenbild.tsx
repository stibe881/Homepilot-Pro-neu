import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { HubSettings } from '../api/types';
import { kann } from '../lib/plattform';
import { Colors, radius, useColors } from '../theme';

/**
 * Das Foto einer Person wählen – für «Wer ist da» (Punkt 415).
 *
 * Fast derselbe Weg wie beim Raumbild (components/Raumbild.tsx): Kamera
 * oder Galerie, vorher verkleinert, als data-URI zum Hub. Zwei
 * Unterschiede: quadratischer Zuschnitt statt 16:9 – ein Gesicht ist
 * rund, kein Kacheltitel –, und keine Knöpfe-Auswahl, die gehört zu
 * einem Zimmer, nicht zu einer Person.
 */
export function Personenbild({
  person,
  settings,
  hatBild,
  onClose,
  onChanged,
}: {
  /** Die Person – `null` heisst: Das Blatt bleibt zu. */
  person: string | null;
  settings: HubSettings;
  /** Gibt es schon eines? Nur dann steht «Bild entfernen» da. */
  hatBild: boolean;
  onClose: () => void;
  /** Nach dem Setzen oder Entfernen: Der Bildstand ist neu. */
  onChanged: (images: Record<string, number>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (!person) return null;

  const adresse = `${settings.url}/api/persons/${encodeURIComponent(person)}/image`;
  const kopf = {
    ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
    'Content-Type': 'application/json',
  };

  const senden = async (methode: 'PUT' | 'DELETE', body?: string) => {
    setLaeuft(true);
    setFehler(null);
    try {
      const antwort = await fetch(adresse, { method: methode, headers: kopf, body });
      const inhalt = await antwort.json().catch(() => ({}));
      if (!antwort.ok) {
        throw new Error(inhalt.detail ?? `Hub antwortet mit ${antwort.status}`);
      }
      onChanged(inhalt.images ?? {});
      onClose();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setLaeuft(false);
    }
  };

  const verkleinert = async (asset: {
    uri: string;
    base64?: string | null;
    width?: number;
  }): Promise<string | null> => {
    try {
      if ((asset.width ?? 0) > 600) {
        // Zur Laufzeit laden statt oben importieren: Auf einem älteren
        // Build ohne dieses native Modul soll die App nicht abstürzen.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
        const kleiner = await manipulateAsync(asset.uri, [{ resize: { width: 600 } }], {
          compress: 0.7,
          format: SaveFormat.JPEG,
          base64: true,
        });
        if (kleiner.base64) return `data:image/jpeg;base64,${kleiner.base64}`;
      }
    } catch {
      // Verkleinern ist eine Zugabe - das Original tut es auch.
    }
    return asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : null;
  };

  const waehlen = async (quelle: 'kamera' | 'galerie') => {
    setFehler(null);
    const optionen = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
    };
    const erlaubnis =
      quelle === 'kamera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!erlaubnis.granted) {
      setFehler(
        quelle === 'kamera'
          ? 'Ohne Zugriff auf die Kamera geht das nicht – in den Einstellungen des Telefons freigeben.'
          : 'Ohne Zugriff auf die Fotos geht das nicht – in den Einstellungen des Telefons freigeben.'
      );
      return;
    }
    const ergebnis =
      quelle === 'kamera'
        ? await ImagePicker.launchCameraAsync(optionen).catch(() => null)
        : await ImagePicker.launchImageLibraryAsync(optionen);
    if (!ergebnis || ergebnis.canceled || !ergebnis.assets?.length) return;
    const bild = await verkleinert(ergebnis.assets[0]);
    if (!bild) {
      setFehler('Das Bild liess sich nicht lesen.');
      return;
    }
    await senden('PUT', JSON.stringify({ image: bild }));
  };

  const zeile = (
    icon: keyof typeof Ionicons.glyphMap,
    text: string,
    onPress: () => void,
    gefahr = false
  ) => (
    <Pressable
      onPress={onPress}
      disabled={laeuft}
      accessibilityRole="button"
      accessibilityLabel={text}
      style={({ pressed }) => [styles.zeile, pressed && !laeuft && styles.gedrueckt]}
    >
      <Ionicons name={icon} size={19} color={gefahr ? colors.danger : colors.ink} />
      <Text style={[styles.zeileText, gefahr && { color: colors.danger }]}>{text}</Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.grund} onPress={laeuft ? undefined : onClose}>
        <Pressable style={styles.blatt} onPress={() => {}}>
          <Text style={styles.titel} numberOfLines={1}>
            Bild für {person}
          </Text>
          <Text style={styles.hinweis}>
            Steht bei «Wer ist da» statt des Symbols.
          </Text>

          {kann.kamera
            ? zeile('camera-outline', 'Foto aufnehmen', () => waehlen('kamera'))
            : null}
          {zeile('images-outline', 'Aus den Fotos wählen', () => waehlen('galerie'))}
          {hatBild
            ? zeile('trash-outline', 'Bild entfernen', () => senden('DELETE'), true)
            : null}

          {laeuft ? <Text style={styles.hinweis}>Einen Moment …</Text> : null}
          {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}

          <Pressable
            onPress={onClose}
            disabled={laeuft}
            accessibilityRole="button"
            style={({ pressed }) => [styles.abbruch, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.abbruchText}>Abbrechen</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    grund: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    blatt: {
      width: 340,
      maxWidth: '100%',
      borderRadius: radius.card,
      padding: 18,
      gap: 6,
      backgroundColor: colors.gradient[1],
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    titel: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    hinweis: { color: colors.inkFaint, fontSize: 12, lineHeight: 18, marginBottom: 4 },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      minHeight: 48,
    },
    gedrueckt: { backgroundColor: colors.surfaceSoft },
    zeileText: { color: colors.ink, fontSize: 15 },
    fehler: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
    abbruch: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
    abbruchText: { color: colors.inkSoft, fontSize: 15, fontWeight: '600' },
  });
