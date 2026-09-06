/**
 * Die Aufnahmen: das Clip-Archiv der Kameras (Punkt 256 der Werkbank).
 *
 * Der Hub legt Alarm-Mitschnitte dauerhaft ab und räumt sie nach der
 * Aufbewahrungsfrist weg. Dieses Blatt zeigt die Liste – Kamera, Anlass,
 * Zeitpunkt, Grösse –, spielt einen Clip auf Antippen und lässt ihn
 * löschen, wer Geräte bearbeiten darf. Die Frist stellt ein, wer die
 * Konfiguration ändern darf.
 *
 * Was jemand sieht, entscheidet der Hub: Die Liste ist bereits nach der
 * Kamera-Sichtbarkeit gefiltert, wie beim Livebild. Aufbereitet wird in
 * lib/cliparchiv.ts; hier steht nur, wie es aussieht.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { uhr } from '../lib/format';
import {
  Clip,
  FRIST_WAHL,
  anlassName,
  clipAbschnitte,
  clipLeerbild,
  clipUrl,
  fristText,
  groesseText,
} from '../lib/cliparchiv';
import { Colors, radius, type, useColors } from '../theme';
import { Aufnahme } from './Aufnahme';
import { Leerzustand } from './Leerzustand';
import { Laedt } from './Zustand';

export function ClipArchiv({
  settings,
  onClose,
}: {
  settings: HubSettings;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const [clips, setClips] = useState<Clip[] | null>(null);
  const [frist, setFrist] = useState<number | null>(null);
  const [fehler, setFehler] = useState(false);
  const [offen, setOffen] = useState<Clip | null>(null);
  // Zwei-Tipp-Rückfrage wie beim Türöffner (Klingelvollbild): Sie
  // funktioniert auch im Browser, wo Alert.alert ins Leere liefe.
  const [loeschfrage, setLoeschfrage] = useState<string | null>(null);
  // Rechte einmal selbst nachfragen – das Blatt bekommt den Benutzer
  // nicht als Prop, und ein Löschknopf, den der Hub ablehnt, wäre nur
  // eine Enttäuschung mit Verzögerung.
  const [darfLoeschen, setDarfLoeschen] = useState(false);
  const [darfFrist, setDarfFrist] = useState(false);

  const laden = useCallback(() => {
    hub
      .get<{ clips?: Clip[]; retention_days?: number } | null>('/api/clips', {
        fallback: null,
        still: true,
      })
      .then((daten) => {
        if (daten === null) {
          setFehler(true);
          setClips([]);
          return;
        }
        setFehler(false);
        setClips(Array.isArray(daten.clips) ? daten.clips : []);
        setFrist(typeof daten.retention_days === 'number' ? daten.retention_days : null);
      });
  }, [hub]);

  useEffect(laden, [laden]);

  useEffect(() => {
    let weg = false;
    hub
      .get<{ capabilities?: string[] } | null>('/api/me', { fallback: null, still: true })
      .then((ich) => {
        if (weg) return;
        const faehigkeiten = ich?.capabilities ?? [];
        setDarfLoeschen(faehigkeiten.includes('edit_devices'));
        setDarfFrist(faehigkeiten.includes('edit_config'));
      });
    return () => {
      weg = true;
    };
  }, [hub]);

  const loeschen = async (clip: Clip) => {
    // Sofort aus der Liste, der Hub bestätigt hinterher – wie beim
    // optimistischen Speichern der Alarmanlage.
    setClips((alt) => (alt ? alt.filter((eintrag) => eintrag.id !== clip.id) : alt));
    setLoeschfrage(null);
    await hub.del(`/api/clips/${encodeURIComponent(clip.id)}`, {
      fallback: null,
      still: true,
    });
    laden();
  };

  const fristSetzen = async (tage: number) => {
    setFrist(tage);
    await hub.put(
      '/api/clips/einstellungen',
      { retention_days: tage },
      { fallback: null, still: true }
    );
    laden();
  };

  const abschnitte = useMemo(() => clipAbschnitte(clips ?? []), [clips]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.grund}>
        <View style={styles.kopf}>
          <Ionicons name="film-outline" size={20} color={colors.inkSoft} />
          <Text style={styles.titel}>Aufnahmen</Text>
          <Pressable onPress={onClose} accessibilityLabel="Schliessen" hitSlop={10}>
            <Ionicons name="close" size={26} color={colors.inkSoft} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.inhalt}>
          {clips === null ? <Laedt was="Aufnahmen" /> : null}
          {fehler ? (
            <Text style={styles.hinweis}>
              Der Hub liefert noch kein Clip-Archiv. Ist er auf dem neusten
              Stand?
            </Text>
          ) : null}

          {clips !== null && !fehler && clips.length === 0 ? (
            <Leerzustand bild={clipLeerbild()} />
          ) : null}

          {abschnitte.map((abschnitt) => (
            <View key={abschnitt.titel}>
              <Text style={styles.tag}>{abschnitt.titel}</Text>
              {abschnitt.clips.map((clip) => {
                const gefragt = loeschfrage === clip.id;
                return (
                  <View key={clip.id} style={styles.zeile}>
                    <Pressable
                      onPress={() => setOffen(clip)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        `Aufnahme ${clip.name}, ${anlassName(clip.anlass)}, ` +
                        `${uhr(clip.at * 1000)} abspielen`
                      }
                      style={({ pressed }) => [styles.zeileLinks, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="play-circle-outline" size={26} color={colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>
                          {clip.name}
                          {clip.room ? ` · ${clip.room}` : ''}
                        </Text>
                        <Text style={styles.detail} numberOfLines={1}>
                          {anlassName(clip.anlass)} · {uhr(clip.at * 1000)}
                          {groesseText(clip.bytes) ? ` · ${groesseText(clip.bytes)}` : ''}
                        </Text>
                      </View>
                    </Pressable>
                    {darfLoeschen ? (
                      <Pressable
                        onPress={() => (gefragt ? loeschen(clip) : setLoeschfrage(clip.id))}
                        accessibilityRole="button"
                        accessibilityLabel={
                          gefragt ? 'Wirklich löschen' : `Aufnahme ${clip.name} löschen`
                        }
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.loeschen,
                          gefragt && styles.loeschenGefragt,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        {gefragt ? (
                          <Text style={styles.loeschenText}>Wirklich?</Text>
                        ) : (
                          <Ionicons name="trash-outline" size={20} color={colors.inkSoft} />
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}

          {/* Die Frist als kleine Einstellung daneben – nicht als eigene
              Seite: Sie wird einmal gestellt und dann vergessen. */}
          {frist !== null ? (
            darfFrist ? (
              <View style={styles.fristBlock}>
                <Text style={styles.fristTitel}>Aufbewahrung</Text>
                <View style={styles.fristReihe}>
                  {FRIST_WAHL.map((tage) => {
                    const on = frist === tage;
                    return (
                      <Pressable
                        key={tage}
                        onPress={() => fristSetzen(tage)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`Aufnahmen ${fristText(tage)} aufbewahren`}
                        style={({ pressed }) => [
                          styles.fristChip,
                          on && styles.fristChipAn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text style={[styles.fristChipText, on && { color: '#FFFFFF' }]}>
                          {fristText(tage)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hinweis}>
                  Ältere Aufnahmen räumt der Hub von selbst weg. Kurz genug,
                  dass kein Bewegungsprofil des Hauses entsteht – lang genug,
                  um nach den Ferien nachzusehen.
                </Text>
              </View>
            ) : (
              <Text style={styles.hinweis}>
                Aufnahmen werden {fristText(frist)} aufbewahrt, dann räumt der
                Hub sie von selbst weg.
              </Text>
            )
          ) : null}
        </ScrollView>

        {offen ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setOffen(null)}>
            <Pressable
              style={styles.clipGrund}
              onPress={() => setOffen(null)}
              accessibilityLabel="Aufnahme schliessen"
            >
              <Text style={styles.clipTitel}>
                {offen.name} · {anlassName(offen.anlass)} · {uhr(offen.at * 1000)}
              </Text>
              {/* Token in der Adresse wie beim Livebild – Videoplayer
                  schicken keine eigenen Kopfzeilen (lib/cliparchiv.ts). */}
              <Aufnahme
                uri={clipUrl(settings.url, settings.token, offen.id)}
                style={styles.clipVideo}
              />
              <Text style={styles.clipHinweis}>Tippen zum Schliessen</Text>
            </Pressable>
          </Modal>
        ) : null}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // `panel` wie bei den anderen Vollbild-Blättern: deckend, damit der
    // Verlauf dahinter den Kontrast nicht kippt.
    grund: { flex: 1, backgroundColor: colors.panel },
    kopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 52,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700', flex: 1 },
    inhalt: { paddingHorizontal: 16, paddingBottom: 32 },
    tag: {
      color: colors.inkFaint,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      marginTop: 14,
      marginBottom: 2,
    },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    zeileLinks: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    loeschen: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    loeschenGefragt: { backgroundColor: colors.danger },
    loeschenText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    hinweis: { color: colors.inkFaint, fontSize: 11, marginTop: 12, lineHeight: 16 },
    fristBlock: { marginTop: 18, gap: 6 },
    fristTitel: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    fristReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    fristChip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    fristChipAn: { backgroundColor: colors.accent, borderColor: colors.accent },
    fristChipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    clipGrund: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 14,
      gap: 10,
    },
    clipTitel: { color: '#E9EDF4', fontSize: 15, fontWeight: '700' },
    clipVideo: { width: '100%', height: '60%' },
    clipHinweis: { color: '#97A2B6', fontSize: 12 },
  });
