/**
 * Was neben Play und Pause noch an eine Musikkachel gehört.
 *
 * Vier Dinge, die vorher fehlten: Man sah nicht, dass eine Kachel eine
 * ganze Gruppe ist; man konnte innerhalb einer Gruppe keine einzelne Box
 * leiser stellen; man sah nicht, was als Nächstes kommt, ohne die Liste
 * zu öffnen; und Musik zum Einschlafen musste man selbst abstellen.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { hubClient } from '../../api/client';
import { Entity } from '../../api/types';
import { useEntities, useSettings } from '../../hooks/HubContext';
import { einzelBoxen } from '../../lib/hausmusik';
import { warteschlange } from '../../lib/musikliste';
import { useColors } from '../../theme';
import { Bar } from '../Bar';

import { makeStyles } from './stil';

/**
 * «Das ist eine Gruppe» – und die Lautstärke der einzelnen Boxen darin.
 *
 * Google stellt beim Abspielen in einer Gruppe alle Boxen gleich laut.
 * Im Kinderzimmer darf es aber leiser sein als in der Küche. Welche
 * Boxen zu einer Gruppe gehören, weiss der Hub nicht – sie teilen sich
 * die Adresse mit einer ihrer Boxen –, deshalb stehen hier alle
 * Einzelboxen des Hauses.
 */
export function GruppenBoxen({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const alle = useEntities();
  const settings = useSettings();
  const [offen, setOffen] = useState(false);
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);
  const boxen = useMemo(() => einzelBoxen(alle, entity.id), [alle, entity.id]);
  // Erst nach allen Hooks aussteigen - die Reihenfolge der Hooks muss
  // in jedem Durchlauf dieselbe sein.
  if (entity.state.is_group !== true) return null;

  return (
    <>
      <Pressable
        onPress={() => (boxen.length > 0 ? setOffen(true) : undefined)}
        accessibilityRole="button"
        accessibilityLabel="Lautstärke je Box"
        style={({ pressed }) => [styles.gruppenChip, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="layers-outline" size={13} color={colors.inkSoft} />
        <Text style={styles.gruppenChipText}>
          Gruppe{boxen.length > 0 ? ` · ${boxen.length} Boxen einzeln` : ''}
        </Text>
      </Pressable>

      <Modal visible={offen} animationType="slide" onRequestClose={() => setOffen(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Lautstärke je Box</Text>
            <Pressable onPress={() => setOffen(false)} accessibilityLabel="Schliessen" hitSlop={8}>
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={styles.hint}>
            «{entity.name}» spielt auf mehreren Boxen gleich laut. Hier stellst
            du jede einzeln – die Gruppe läuft weiter.
          </Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {boxen.map((box) => (
              <View key={box.id} style={styles.boxZeile}>
                <Text style={styles.boxName} numberOfLines={1}>
                  {box.name}
                </Text>
                <View style={styles.volumeBar}>
                  <Bar
                    height={28}
                    value={typeof box.state.volume === 'number' ? box.state.volume : 0}
                    onChange={(wert) =>
                      hub
                        .post(
                          `/api/entities/${encodeURIComponent(box.id)}/command`,
                          { command: 'set_volume', data: { volume: wert } },
                          { still: true },
                        )
                        .catch(() => undefined)
                    }
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/**
 * Was als Nächstes läuft – eine Zeile auf der Karte.
 *
 * Die ganze Liste gibt es beim Antippen; hier steht nur der nächste
 * Titel. Genau der ist die Frage, die man sich stellt, bevor man zum
 * Überspringen greift.
 */
export function NaechsterTitel({ state }: { state: Entity['state'] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const zeilen = warteschlange(state);
  const naechste = zeilen.find((zeile) => !zeile.laeuft);
  if (!naechste) return null;
  return (
    <View style={styles.naechsterRow}>
      <Ionicons name="arrow-forward" size={12} color={colors.inkFaint} />
      <Text style={styles.naechsterText} numberOfLines={1}>
        Danach: {naechste.track}
        {naechste.artist ? ` · ${naechste.artist}` : ''}
      </Text>
    </View>
  );
}

/** Die Minuten, die ein Schlummer-Timer anbietet. */
const SCHLUMMER_MINUTEN = [15, 30, 45, 60, 90];

/**
 * Musik, die von selbst aufhört.
 *
 * Der Hub blendet die letzten dreissig Sekunden aus – Musik, die mitten
 * im Takt abbricht, weckt eher, als dass sie einschlafen lässt.
 */
export function Schlummer({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useSettings();
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);
  const [endetUm, setEndetUm] = useState<number | null>(null);
  const [jetzt, setJetzt] = useState(Date.now() / 1000);

  useEffect(() => {
    let abgebrochen = false;
    hub
      .get<{ timers?: { entity_id: string; ends_at: number }[] } | null>('/api/media/sleep', {
        fallback: null,
        still: true,
      })
      .then((daten) => {
        if (abgebrochen) return;
        const meiner = daten?.timers?.find((zeile) => zeile.entity_id === entity.id);
        setEndetUm(meiner ? meiner.ends_at : null);
      });
    return () => {
      abgebrochen = true;
    };
  }, [hub, entity.id]);

  // Nur ticken, solange ein Timer läuft.
  useEffect(() => {
    if (endetUm === null) return undefined;
    const takt = setInterval(() => setJetzt(Date.now() / 1000), 10000);
    return () => clearInterval(takt);
  }, [endetUm]);

  const restMinuten = endetUm === null ? 0 : Math.max(0, Math.round((endetUm - jetzt) / 60));

  const setzen = async (minuten: number) => {
    try {
      const antwort = await hub.post<{ ends_at: number }>(
        `/api/media/${encodeURIComponent(entity.id)}/sleep`,
        { minutes: minuten },
        { still: true },
      );
      setEndetUm(antwort.ends_at);
      setJetzt(Date.now() / 1000);
    } catch {
      // Still: Der Timer ist eine Zugabe, kein Bedienweg, der klemmt.
    }
  };

  const abbrechen = async () => {
    await hub.del(`/api/media/${encodeURIComponent(entity.id)}/sleep`, { still: true }).catch(
      () => undefined,
    );
    setEndetUm(null);
  };

  if (endetUm !== null) {
    return (
      <Pressable
        onPress={abbrechen}
        accessibilityRole="button"
        accessibilityLabel="Schlummer abbrechen"
        style={({ pressed }) => [styles.schlummerAktiv, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="moon" size={13} color={colors.accent} />
        <Text style={styles.schlummerAktivText}>
          Hört in {restMinuten} Min. auf · antippen zum Abbrechen
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.modeRow}>
      <Ionicons name="moon-outline" size={14} color={colors.inkFaint} />
      {SCHLUMMER_MINUTEN.map((minuten) => (
        <Pressable
          key={minuten}
          onPress={() => setzen(minuten)}
          accessibilityRole="button"
          accessibilityLabel={`Nach ${minuten} Minuten aufhören`}
          style={({ pressed }) => [styles.schlummerChip, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.schlummerChipText}>{minuten}′</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * «Woanders weiterhören».
 *
 * Für Boxen ohne eigene Zielwahl. Wer Spotify oder Radio steuert, hat
 * die Boxenzeile schon; eine Cast-Box hat sie nicht, obwohl die
 * Wiedergabe umziehen kann - umziehen tut sie nämlich nicht die Box,
 * sondern der Player, der auf sie spielt. Den sucht der Hub.
 */
export function Umziehen({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const alle = useEntities();
  const settings = useSettings();
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);
  const [offen, setOffen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ziele = useMemo(() => einzelBoxen(alle, entity.id), [alle, entity.id]);

  // Wer eine eigene Boxenzeile hat, braucht diesen Knopf nicht - zwei
  // Wege zum selben Ziel untereinander sind einer zu viel.
  if (entity.commands.includes('play_on')) return null;
  if (!['playing', 'buffering'].includes(String(entity.state.state))) return null;
  if (ziele.length === 0) return null;

  const umziehen = async (ziel: string) => {
    try {
      await hub.post(
        `/api/media/${encodeURIComponent(entity.id)}/move`,
        { to: ziel },
        { still: true },
      );
      setOffen(false);
      setNote(null);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOffen(true)}
        accessibilityRole="button"
        accessibilityLabel="Woanders weiterhören"
        style={({ pressed }) => [styles.gruppenChip, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="swap-horizontal" size={13} color={colors.inkSoft} />
        <Text style={styles.gruppenChipText}>Woanders weiterhören</Text>
      </Pressable>

      <Modal visible={offen} animationType="slide" onRequestClose={() => setOffen(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Woanders weiterhören</Text>
            <Pressable onPress={() => setOffen(false)} accessibilityLabel="Schliessen" hitSlop={8}>
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          </View>
          {note ? <Text style={styles.warnHint}>{note}</Text> : null}
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {ziele.map((ziel) => (
              <Pressable
                key={ziel.id}
                onPress={() => umziehen(ziel.name)}
                accessibilityRole="button"
                accessibilityLabel={`Auf ${ziel.name} weiterhören`}
                style={({ pressed }) => [styles.boxZeile, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="volume-medium-outline" size={16} color={colors.inkSoft} />
                <Text style={styles.boxName} numberOfLines={1}>
                  {ziel.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/**
 * Zufall und Wiederholung gab es schon; hier kommt das Spulen dazu, das
 * ohne Fortschritt keinen Sinn ergäbe – deshalb steht es dort und nicht
 * in dieser Reihe.
 */
export function MedienExtras({ entity }: { entity: Entity }) {
  const spielt = ['playing', 'buffering'].includes(String(entity.state.state));
  return (
    <>
      <GruppenBoxen entity={entity} />
      <Umziehen entity={entity} />
      <NaechsterTitel state={entity.state} />
      {spielt && entity.commands.includes('pause') ? <Schlummer entity={entity} /> : null}
    </>
  );
}
