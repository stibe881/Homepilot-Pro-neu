/**
 * Die Musik des Hauses an einem Ort.
 *
 * Fünf Fragen, die eine einzelne Kachel nicht beantworten kann:
 *
 *  - Läuft irgendwo noch etwas? (Eine stille Box sieht aus wie eine, die
 *    man noch nicht gefunden hat.)
 *  - Wie hiess das Lied vorhin?
 *  - Wo ist die Playlist von gestern Abend?
 *  - Soll die Musik nachts leiser sein?
 *  - Und: Weck mich morgen mit Radio statt mit Piepsen.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { hausSatz, laufendeMusik, zustandName } from '../lib/hausmusik';
import { tageSatz } from '../lib/weckertage';
import { Colors, radius, type, useColors } from '../theme';

import { Card } from './Card';

interface Favorit {
  id: string;
  kind: string;
  name: string;
  player?: string;
  device?: string;
}

interface VerlaufZeile {
  track: string;
  artist?: string;
  player?: string;
  at?: number;
}

interface Nachtruhe {
  on: boolean;
  from: string;
  to: string;
  max: number;
}

interface Wecker {
  id: string;
  on: boolean;
  time: string;
  days: number[];
  player: string;
  device?: string;
  kind: string;
  name: string;
  volume: number;
}

export function Musikzentrale({
  settings,
  entities,
}: {
  settings: HubSettings;
  entities: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);

  const [favoriten, setFavoriten] = useState<Favorit[]>([]);
  const [verlauf, setVerlauf] = useState<VerlaufZeile[]>([]);
  const [nacht, setNacht] = useState<Nachtruhe | null>(null);
  const [duck, setDuck] = useState(true);
  const [wecker, setWecker] = useState<Wecker[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [neuerWecker, setNeuerWecker] = useState<{ time: string; name: string } | null>(null);

  const laden = useCallback(async () => {
    const [f, v, e, w] = await Promise.all([
      hub.get<{ favorites?: Favorit[] } | null>('/api/media/favorites', {
        fallback: null,
        still: true,
      }),
      hub.get<{ history?: VerlaufZeile[] } | null>('/api/media/history', {
        fallback: null,
        still: true,
      }),
      hub.get<{ night?: Nachtruhe; duck?: boolean } | null>('/api/media/settings', {
        fallback: null,
        still: true,
      }),
      hub.get<{ alarms?: Wecker[] } | null>('/api/media/alarms', {
        fallback: null,
        still: true,
      }),
    ]);
    setFavoriten(f?.favorites ?? []);
    setVerlauf(v?.history ?? []);
    if (e?.night) setNacht(e.night);
    if (typeof e?.duck === 'boolean') setDuck(e.duck);
    setWecker(w?.alarms ?? []);
  }, [hub]);

  useEffect(() => {
    laden();
  }, [laden]);

  const laufend = laufendeMusik(entities);

  /**
   * Was sich gerade merken liesse.
   *
   * Ein Favorit ist kein Titel, sondern eine Quelle: der Sender oder die
   * Playlist, aus der gespielt wird. Ein einzelnes Lied zu merken hiesse,
   * beim nächsten Antippen genau dieses eine Lied zu hören - das will
   * fast nie jemand.
   */
  const merkbar = entities
    .filter((entity) => ['playing', 'buffering'].includes(String(entity.state?.state)))
    .map((entity) => {
      const station = String(entity.state?.station ?? '').trim();
      const playlist = String(entity.state?.playlist ?? '').trim();
      if (station) return { entity, kind: 'station', name: station };
      if (playlist) return { entity, kind: 'playlist', name: playlist };
      return null;
    })
    .filter(
      (eintrag): eintrag is { entity: Entity; kind: string; name: string } =>
        eintrag !== null && !favoriten.some((favorit) => favorit.name === eintrag.name),
    );

  const merken = async (eintrag: { entity: Entity; kind: string; name: string }) => {
    try {
      await hub.post(
        '/api/media/favorites',
        {
          kind: eintrag.kind,
          name: eintrag.name,
          player: eintrag.entity.id,
          device: String(eintrag.entity.state?.device ?? ''),
        },
        { still: true },
      );
      setNote(`«${eintrag.name}» gemerkt.`);
      laden();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  const spielen = async (favorit: Favorit) => {
    try {
      await hub.post(
        `/api/media/favorites/${encodeURIComponent(favorit.id)}/play`,
        {},
        { still: true },
      );
      setNote(`«${favorit.name}» läuft.`);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  const vergessen = async (favorit: Favorit) => {
    await hub
      .del(`/api/media/favorites/${encodeURIComponent(favorit.id)}`, { still: true })
      .catch(() => undefined);
    laden();
  };

  const nachtSetzen = async (werte: Partial<Nachtruhe> & { duck?: boolean }) => {
    try {
      const antwort = await hub.put<{ night: Nachtruhe; duck: boolean }>(
        '/api/media/settings',
        {
          ...(werte.on !== undefined ? { on: werte.on } : {}),
          ...(werte.from !== undefined ? { start: werte.from } : {}),
          ...(werte.to !== undefined ? { end: werte.to } : {}),
          ...(werte.max !== undefined ? { max: werte.max } : {}),
          ...(werte.duck !== undefined ? { duck: werte.duck } : {}),
        },
        { still: true },
      );
      setNacht(antwort.night);
      setDuck(antwort.duck);
      setNote(null);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  const weckerLoeschen = async (eintrag: Wecker) => {
    await hub
      .del(`/api/media/alarms/${encodeURIComponent(eintrag.id)}`, { still: true })
      .catch(() => undefined);
    laden();
  };

  const weckerSpeichern = async () => {
    if (!neuerWecker) return;
    // Die erste Box, die einen Sender abspielen kann - meistens gibt es
    // genau eine, und dann ist eine Auswahl ein Schritt zu viel.
    const spieler = entities.find((entity) => entity.commands.includes('play_radio'));
    if (!spieler) {
      setNote('Dafür bräuchte es Radio - im Haus ist nichts eingerichtet.');
      return;
    }
    try {
      await hub.put(
        '/api/media/alarms',
        {
          time: neuerWecker.time.trim(),
          player: spieler.id,
          kind: 'station',
          name: neuerWecker.name.trim(),
          days: [0, 1, 2, 3, 4],
          volume: 30,
        },
        { still: true },
      );
      setNeuerWecker(null);
      setNote(null);
      laden();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  return (
    <Card>
      <Text style={styles.titel}>Musik im Haus</Text>

      {/* ── Was läuft gerade ─────────────────────────────────────── */}
      <Text style={styles.satz}>{hausSatz(laufend)}</Text>
      {laufend.map((zeile) => (
        <View key={zeile.id} style={styles.zeile}>
          <Ionicons
            name={zeile.laedt ? 'ellipsis-horizontal' : 'musical-notes'}
            size={14}
            color={colors.accent}
          />
          <Text style={styles.zeileText} numberOfLines={1}>
            {zeile.name}
            {zeile.track ? ` · ${zeile.track}` : ` · ${zustandName(zeile.laedt ? 'buffering' : 'playing')}`}
          </Text>
        </View>
      ))}

      {/* ── Merken, was gerade läuft ─────────────────────────────── */}
      {merkbar.map((eintrag) => (
        <Pressable
          key={eintrag.name}
          onPress={() => merken(eintrag)}
          accessibilityRole="button"
          accessibilityLabel={`${eintrag.name} merken`}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="star-outline" size={13} color={colors.inkSoft} />
          <Text style={styles.chipText} numberOfLines={1}>
            «{eintrag.name}» merken
          </Text>
        </Pressable>
      ))}

      {/* ── Favoriten ────────────────────────────────────────────── */}
      {favoriten.length > 0 ? (
        <>
          <Text style={styles.abschnitt}>Favoriten</Text>
          <View style={styles.chips}>
            {favoriten.map((favorit) => (
              <Pressable
                key={favorit.id}
                onPress={() => spielen(favorit)}
                onLongPress={() => vergessen(favorit)}
                accessibilityRole="button"
                accessibilityLabel={`${favorit.name} abspielen`}
                style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name={favorit.kind === 'station' ? 'radio' : 'musical-note'}
                  size={13}
                  color={colors.inkSoft}
                />
                <Text style={styles.chipText} numberOfLines={1}>
                  {favorit.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hinweis}>Lange drücken entfernt einen Favoriten.</Text>
        </>
      ) : null}

      {/* ── Was lief zuletzt ─────────────────────────────────────── */}
      {verlauf.length > 0 ? (
        <>
          <Text style={styles.abschnitt}>Zuletzt gehört</Text>
          {verlauf.slice(0, 5).map((zeile, index) => (
            <Text key={`${zeile.track}-${index}`} style={styles.verlaufText} numberOfLines={1}>
              {zeile.track}
              {zeile.artist ? ` · ${zeile.artist}` : ''}
              {zeile.player ? ` · ${zeile.player}` : ''}
            </Text>
          ))}
        </>
      ) : null}

      {/* ── Nachtruhe und Dämpfen ────────────────────────────────── */}
      <Text style={styles.abschnitt}>Leise, wenn es sein muss</Text>
      <Pressable
        onPress={() => nachtSetzen({ on: !(nacht?.on ?? false) })}
        accessibilityRole="switch"
        accessibilityState={{ checked: nacht?.on ?? false }}
        style={({ pressed }) => [styles.schalter, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name={nacht?.on ? 'moon' : 'moon-outline'}
          size={16}
          color={nacht?.on ? colors.accent : colors.inkSoft}
        />
        <Text style={styles.schalterText}>
          {nacht?.on
            ? `Nachtruhe: ab ${nacht.from} bis ${nacht.to} höchstens ${nacht.max} %`
            : 'Nachtruhe aus – nachts geht es so laut wie tagsüber'}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => nachtSetzen({ duck: !duck })}
        accessibilityRole="switch"
        accessibilityState={{ checked: duck }}
        style={({ pressed }) => [styles.schalter, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name={duck ? 'notifications' : 'notifications-off-outline'}
          size={16}
          color={duck ? colors.accent : colors.inkSoft}
        />
        <Text style={styles.schalterText}>
          {duck
            ? 'Beim Klingeln wird die Musik kurz leiser'
            : 'Beim Klingeln bleibt die Musik, wie sie ist'}
        </Text>
      </Pressable>

      {/* ── Musikwecker ──────────────────────────────────────────── */}
      <Text style={styles.abschnitt}>Musikwecker</Text>
      {wecker.map((eintrag) => (
        <Pressable
          key={eintrag.id}
          onLongPress={() => weckerLoeschen(eintrag)}
          accessibilityRole="button"
          accessibilityLabel={`Wecker ${eintrag.time}, lange drücken zum Löschen`}
          style={styles.zeile}
        >
          <Ionicons name="alarm-outline" size={14} color={colors.inkSoft} />
          <Text style={styles.zeileText} numberOfLines={1}>
            {eintrag.time} · {tageSatz(eintrag.days)}
            {eintrag.name ? ` · ${eintrag.name}` : ''}
          </Text>
        </Pressable>
      ))}
      {neuerWecker ? (
        <View style={styles.formular}>
          <TextInput
            style={styles.eingabe}
            value={neuerWecker.time}
            onChangeText={(wert) => setNeuerWecker({ ...neuerWecker, time: wert })}
            placeholder="07:15"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Uhrzeit"
          />
          <TextInput
            style={[styles.eingabe, { flex: 1 }]}
            value={neuerWecker.name}
            onChangeText={(wert) => setNeuerWecker({ ...neuerWecker, name: wert })}
            placeholder="Sender, z. B. SRF 3"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Sender"
          />
          <Pressable
            onPress={weckerSpeichern}
            accessibilityRole="button"
            accessibilityLabel="Wecker sichern"
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.chipText}>Sichern</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setNeuerWecker({ time: '07:15', name: '' })}
          accessibilityRole="button"
          accessibilityLabel="Musikwecker stellen"
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="add" size={14} color={colors.inkSoft} />
          <Text style={styles.chipText}>Wecker stellen (Mo–Fr)</Text>
        </Pressable>
      )}
      <Text style={styles.hinweis}>
        Der Wecker blendet ein statt zu piepsen. Lange drücken löscht ihn.
      </Text>

      {note ? <Text style={styles.hinweis}>{note}</Text> : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    satz: { color: colors.ink, fontSize: 15, marginTop: 4 },
    abschnitt: {
      color: colors.inkFaint,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      marginTop: 12,
    },
    zeile: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
    zeileText: { color: colors.inkSoft, fontSize: 13, flex: 1 },
    verlaufText: { color: colors.inkSoft, fontSize: 13, paddingVertical: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    chip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
      marginTop: 4,
    },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600', maxWidth: 180 },
    schalter: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    schalterText: { color: colors.inkSoft, fontSize: 13, flex: 1 },
    formular: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    eingabe: {
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
      minWidth: 70,
    },
    hinweis: { color: colors.inkFaint, fontSize: 11, marginTop: 4 },
  });
