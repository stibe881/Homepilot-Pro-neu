import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { kann } from '../lib/plattform';
import { KNOEPFE_HOECHSTENS } from '../lib/raumkarte';
import { Colors, radius, useColors } from '../theme';

/**
 * Das Foto eines Zimmers wählen – hinter dem langen Druck auf die
 * Raumkachel.
 *
 * Zwei Wege hinein: die Kamera für den Moment, in dem man im Zimmer
 * steht, und die Galerie fürs Nachtragen. Im Browser gibt es nur die
 * Galerie – ein Kameraknopf, der dort nichts tut, ist schlimmer als
 * keiner.
 *
 * **Vor dem Senden verkleinern.** Ein iPhone-Foto in Originalauflösung
 * sind mehrere Megabyte; der Hub nimmt höchstens zwei und der Kopf der
 * Kachel ist 116 Punkte hoch. 1200 Punkte Breite reichen auch auf einem
 * iPad mit dreifacher Auflösung. Scheitert das Verkleinern (ein älterer
 * Build ohne das native Modul), geht das Bild ungekürzt hinaus und der
 * Hub sagt notfalls, dass es zu gross ist – mit einem Satz, den man lesen
 * kann.
 *
 * **Zuschnitt 16:9**, weil der Kopf der Kachel dieses Verhältnis hat: Wer
 * selbst wählt, welcher Teil des Zimmers zu sehen ist, bekommt ein
 * besseres Bild als jeder Zuschnitt im Nachhinein.
 */
export function Raumbild({
  room,
  settings,
  hatBild,
  onClose,
  onChanged,
  knoepfe,
  geraete = [],
  auswahl,
  onAuswahl,
}: {
  /** Das Zimmer – `null` heisst: Das Blatt bleibt zu. */
  room: string | null;
  settings: HubSettings;
  /** Gibt es schon eines? Nur dann steht «Bild entfernen» da. */
  hatBild: boolean;
  onClose: () => void;
  /** Nach dem Setzen oder Entfernen: Der Bildstand des Hauses ist neu. */
  onChanged: (images: Record<string, number>) => void;
  /** Welche Sammelknöpfe dieser Raum überhaupt hergibt - für die Auswahl. */
  knoepfe: { art: string; label: string }[];
  /** Einzelne Geräte des Raums, die ein eigener Knopf sein können -
   *  `art` ist hier die Geräte-Kennung. Ohne Wahl sind sie aus. */
  geraete?: { art: string; label: string }[];
  /** Die getroffene Wahl - undefined heisst: alle Sammelknöpfe. */
  auswahl: string[] | undefined;
  onAuswahl: (arts: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  // Der Satz erscheint erst, wenn jemand an die Grenze stösst - vorher
  // wäre er eine Warnung vor einem Problem, das niemand hat.
  const [voll, setVoll] = useState(false);

  if (!room) return null;

  const adresse = `${settings.url}/api/rooms/${encodeURIComponent(room)}/image`;
  const kopf = {
    ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
    'Content-Type': 'application/json',
  };

  /** Antwort auswerten – der Hub begründet jede Absage im Klartext. */
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

  /** Verkleinern, damit aus dem Telefon kein Vielfaches des Nötigen kommt. */
  const verkleinert = async (asset: {
    uri: string;
    base64?: string | null;
    width?: number;
  }): Promise<string | null> => {
    try {
      if ((asset.width ?? 0) > 1200) {
        // Zur Laufzeit laden statt oben importieren: Auf einem älteren
        // Build ohne dieses native Modul soll die App nicht abstürzen.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
        const kleiner = await manipulateAsync(asset.uri, [{ resize: { width: 1200 } }], {
          compress: 0.65,
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
      quality: 0.65,
      base64: true,
      allowsEditing: true,
      // Dasselbe Verhältnis wie der Kopf der Kachel.
      aspect: [16, 9] as [number, number],
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
        {/* Innen darf das Tippen nicht durchschlagen. */}
        <Pressable style={styles.blatt} onPress={() => {}}>
          <Text style={styles.titel} numberOfLines={1}>
            Bild für {room}
          </Text>
          <Text style={styles.hinweis}>
            Steht auf der Kachel und gilt für alle im Haus.
          </Text>

          {kann.kamera
            ? zeile('camera-outline', 'Foto aufnehmen', () => waehlen('kamera'))
            : null}
          {zeile('images-outline', 'Aus den Fotos wählen', () => waehlen('galerie'))}
          {hatBild
            ? zeile('trash-outline', 'Bild entfernen', () => senden('DELETE'), true)
            : null}

          {/* Welche Knöpfe die Kachel trägt. Die Wahl gilt wie das Bild
              für alle im Haus (house prefs) - abgewählt wird durch
              Antippen, und auch «gar keine» ist eine gültige Wahl.
              Neben den Sammelknöpfen steht jedes schaltbare Gerät des
              Raums zur Wahl - höchstens drei zusammen, mehr trägt die
              Kachel nicht. */}
          {knoepfe.length > 0 || geraete.length > 0 ? (
            <>
              <Text style={styles.abschnitt}>Knöpfe auf der Kachel</Text>
              {/* Die Zahl vor dem Namen ist die einzige Stelle, an der
                  die Reihenfolge sichtbar wird - ohne sie sähe die Wahl
                  aus wie ein Haken, und die Kachel ordnete dann
                  scheinbar willkürlich. Umsortiert wird durch Abwählen
                  und neu Antippen; bei höchstens drei Knöpfen ist das
                  kürzer als jedes Ziehen. */}
              <Text style={styles.hinweis}>
                Die Reihenfolge auf der Kachel ist die des Antippens.
              </Text>
              <View style={styles.chips}>
                {[...knoepfe, ...geraete].map((knopf) => {
                  const jetzt = auswahl ?? knoepfe.map((k) => k.art);
                  const platz = jetzt.indexOf(knopf.art);
                  const aktiv = platz >= 0;
                  const wechseln = () => {
                    if (aktiv) {
                      setVoll(false);
                      onAuswahl(jetzt.filter((art) => art !== knopf.art));
                      return;
                    }
                    if (jetzt.length >= KNOEPFE_HOECHSTENS) {
                      // Nicht stumm verweigern: sagen, warum.
                      setVoll(true);
                      return;
                    }
                    setVoll(false);
                    onAuswahl([...jetzt, knopf.art]);
                  };
                  return (
                    <Pressable
                      key={knopf.art}
                      onPress={wechseln}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: aktiv }}
                      accessibilityLabel={
                        aktiv
                          ? `Knopf ${knopf.label}, Platz ${platz + 1} auf der Kachel`
                          : `Knopf ${knopf.label} auf der Kachel`
                      }
                      style={[styles.chip, aktiv && styles.chipAn]}
                    >
                      <Text style={[styles.chipText, aktiv && styles.chipTextAn]}>
                        {aktiv ? `${platz + 1}. ` : ''}
                        {knopf.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {voll ? (
                <Text style={styles.hinweis}>
                  Höchstens drei Knöpfe passen auf die Kachel – zuerst einen
                  abwählen.
                </Text>
              ) : null}
            </>
          ) : null}

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
    abschnitt: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: 6,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipAn: { backgroundColor: colors.ink, borderColor: colors.ink },
    chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    chipTextAn: { color: colors.surfaceStrong },
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
