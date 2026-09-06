import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings, User } from '../api/types';
import { Card } from './Card';
import { EINFUEHRUNG_STAND, schritteFuer, zeigtEinfuehrung } from '../lib/einfuehrung';
import { persoenlichSetzen } from '../lib/persoenlich';
import { giltAlsNeuGeoeffnet } from '../lib/wiederkehr';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Die Einführung beim ersten Öffnen - ein blätterbares Blatt, keine Tour.
 *
 * Kein Overlay, das mit Pfeilen auf echte Bedienelemente zeigt: Die
 * Leiste liegt auf dem Telefon unten, auf dem iPad links, im Browser je
 * nach Fenster - ein Pfeil, der überall die richtige Stelle träfe,
 * müsste jedes Layout kennen und bräche beim nächsten Umbau still,
 * mitten auf dem Bildschirm des einen Geräts, das niemand prüft. Ein
 * Blatt mit kurzen Texten erklärt dasselbe und überlebt jeden Umbau
 * (die Schritte samt Begründung: lib/einfuehrung.ts).
 *
 * Der «einmal pro Person»-Mechanismus ist derselbe wie bei «Was ist neu»
 * (WhatsNew.tsx, lib/wiederkehr.ts): Das Gesehen-Sein liegt als
 * Schlüssel `einfuehrungGesehen` in den persönlichen Hub-Prefs
 * (lib/persoenlich.ts) - einmal gesehen heisst überall gesehen, und die
 * Neuinstallation fängt nicht von vorne an. Gelesen wird der Stand
 * direkt vom Hub statt über usePrefs: Das Blatt hängt am obersten
 * Bildschirm, und ein weiteres Prop-Paar durch den Dashboard wäre genau
 * die Schleppe, für die lib/persoenlich.ts der kurze Weg ist.
 *
 * Für Gäste und Babysitter zeigt dasselbe Blatt die kurze «So
 * funktioniert das hier»-Fassung - wer entscheidet, steht in
 * lib/einfuehrung.ts (fassungFuer).
 */
export function Einfuehrung({
  settings,
  user,
  erzwungen = false,
  onErzwungenZu,
}: {
  settings: HubSettings;
  /** Der angemeldete Benutzer - entscheidet über die Fassung. */
  user: User | null;
  /** Aus der Hilfe heraus: «Einführung erneut zeigen». */
  erzwungen?: boolean;
  onErzwungenZu?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Welche Fassung schon weggeklickt wurde - undefined heisst «nie»,
  // aber erst, wenn `geladen` das bestätigt. Ohne Antwort vom Hub gibt
  // es keine Aussage und darum kein Blatt: Lieber gar nicht zeigen als
  // jemandem, der sie längst kennt, die Begrüssung noch einmal.
  const [gesehen, setGesehen] = useState<number | undefined>(undefined);
  const [geladen, setGeladen] = useState(false);
  const [zurueckgestellt, setZurueckgestellt] = useState(false);
  const [schritt, setSchritt] = useState(0);

  const laden = useCallback(() => {
    hubClient(settings.url, settings.token)
      .get<{ prefs?: { einfuehrungGesehen?: unknown } } | null>('/api/prefs', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (!data) return;
        const wert = data.prefs?.einfuehrungGesehen;
        setGesehen(typeof wert === 'number' ? wert : undefined);
        setGeladen(true);
      });
  }, [settings.url, settings.token]);

  useEffect(laden, [laden]);

  // Zurück aus dem Hintergrund ist ein Öffnen (lib/wiederkehr.ts) - dann
  // ist auch das Weggetippt-Sein von vorhin verbraucht. Neu geladen wird
  // ebenfalls: Vielleicht wurde die Einführung inzwischen auf dem
  // anderen Gerät zu Ende gelesen.
  const wegSeit = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (naechster) => {
      if (naechster !== 'active') {
        wegSeit.current = wegSeit.current ?? Date.now();
        return;
      }
      const weg = wegSeit.current;
      wegSeit.current = null;
      if (!giltAlsNeuGeoeffnet(weg, Date.now())) return;
      setZurueckgestellt(false);
      laden();
    });
    return () => sub.remove();
  }, [laden]);

  const schritte = schritteFuer(user);
  const zeigen =
    erzwungen || zeigtEinfuehrung({ geladen, gesehen, zurueckgestellt });

  // Beim Aufgehen wieder vorne anfangen - auch beim «erneut zeigen».
  useEffect(() => {
    if (zeigen) setSchritt(0);
  }, [zeigen]);

  if (!zeigen) return null;

  const aktuell = schritte[Math.min(schritt, schritte.length - 1)];
  const letzter = schritt >= schritte.length - 1;

  const fertig = () => {
    // Fertig gelesen heisst gesehen - für diese Person, überall.
    persoenlichSetzen(settings, 'einfuehrungGesehen', EINFUEHRUNG_STAND);
    setGesehen(EINFUEHRUNG_STAND);
    onErzwungenZu?.();
  };

  const wegtippen = () => {
    // Nur für diesen Besuch weg: Wegtippen ist kein Gelesen-Haben -
    // beim nächsten Öffnen ist das Blatt wieder da (wie bei WhatsNew).
    setZurueckgestellt(true);
    onErzwungenZu?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={wegtippen}>
      {/* Der Tipp neben das Blatt schliesst es - «jederzeit wegtippbar»
          heisst: kein Zwang, erst vier Seiten durchzublättern. */}
      <Pressable style={styles.backdrop} onPress={wegtippen}>
        <Pressable onPress={() => {}}>
          <Card style={styles.card}>
            <View style={styles.head}>
              <Ionicons name={aktuell.icon} size={22} color={colors.accent} />
              <Text style={styles.title}>{aktuell.titel}</Text>
            </View>
            <ScrollView style={{ flexGrow: 0 }}>
              <Text style={styles.text}>{aktuell.text}</Text>
            </ScrollView>

            {schritte.length > 1 ? (
              <View style={styles.dots} accessibilityLabel={`Schritt ${schritt + 1} von ${schritte.length}`}>
                {schritte.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.dot, index === schritt && styles.dotAktiv]}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.buttons}>
              {schritt > 0 ? (
                <Pressable
                  onPress={() => setSchritt((n) => Math.max(0, n - 1))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.buttonText}>Zurück</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={wegtippen}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.buttonText}>Später</Text>
                </Pressable>
              )}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={letzter ? fertig : () => setSchritt((n) => n + 1)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonPrimary,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>
                  {letzter ? 'Alles klar' : 'Weiter'}
                </Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: 20,
    },
    // Deckend wie bei WhatsNew: colors.surface ist durchscheinend, und
    // über dem abgedunkelten Hintergrund würde der Text unlesbar.
    card: {
      minHeight: 0,
      gap: 12,
      maxHeight: '80%',
      backgroundColor: colors.panel,
      alignSelf: 'center',
      width: '100%',
      maxWidth: 440,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700', flex: 1 },
    text: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
    dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.surfaceBorder,
    },
    dotAktiv: { backgroundColor: colors.accent },
    buttons: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    buttonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  });
