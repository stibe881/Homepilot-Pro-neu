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
import { useTakt } from '../hooks/useTakt';
import { Entity, HubSettings } from '../api/types';
import { hausSatz, laufendeMusik, zustandName } from '../lib/hausmusik';
import { WeckerEntwurf, ersterEntwurf } from '../lib/weckerentwurf';
import { tageSatz } from '../lib/weckertage';
import { Nachtragzeile, nachtragSatz } from '../lib/tonnachtrag';
import {
  Plan,
  Stufe,
  VORLAGE,
  boxAn,
  boxenSatz,
  boxenUmschalten,
  freieBoxen,
  planBoxen,
  type Planbox,
  vorauswahl,
  geordnet,
  minuten,
  neueStufe,
  stufeJetzt,
  stufenSatz,
} from '../lib/lautplan';
import { Colors, radius, type, useColors } from '../theme';

import { Card } from './Card';
import { WeckerFormular } from './WeckerFormular';

interface Favorit {
  id: string;
  kind: string;
  name: string;
  player?: string;
  device?: string;
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
  const [nacht, setNacht] = useState<Nachtruhe | null>(null);
  const [duck, setDuck] = useState(true);
  // Nicht in laufende Musik hineinstellen - und was deswegen wartet.
  const [warten, setWarten] = useState(true);
  const [nachtrag, setNachtrag] = useState<Nachtragzeile[]>([]);
  // Lautstärke nach Tageszeit - eine Liste, weil ein Plan je Bereich
  // erst den Sinn ergibt: «alle Boxen auf 70 %» ist selten das, was man
  // will, sobald ein Kinderzimmer dabei ist. Der Hub trägt bis zu acht.
  const [plaene, setPlaene] = useState<Plan[]>([]);
  // Welche Stufe gerade gilt, wird hervorgehoben - dafür braucht es die
  // Uhrzeit. Im Minutentakt und nicht öfter: Feiner löst der Plan nicht
  // auf, und der Takt schweigt im Hintergrund (hooks/useTakt.ts).
  const [jetztMinuten, setJetztMinuten] = useState(() => {
    const jetzt = new Date();
    return jetzt.getHours() * 60 + jetzt.getMinutes();
  });
  useTakt(() => {
    const jetzt = new Date();
    setJetztMinuten(jetzt.getHours() * 60 + jetzt.getMinutes());
  }, 30_000);
  const [wecker, setWecker] = useState<Wecker[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [neuerWecker, setNeuerWecker] = useState<WeckerEntwurf | null>(null);
  // Welcher Favorit gerade eine Box zugewiesen bekommt.
  const [ziel, setZiel] = useState<Favorit | null>(null);
  const [pausiert, setPausiert] = useState(false);

  const laden = useCallback(async () => {
    const [f, e, w, l] = await Promise.all([
      hub.get<{ favorites?: Favorit[] } | null>('/api/media/favorites', {
        fallback: null,
        still: true,
      }),
      hub.get<{
        night?: Nachtruhe;
        duck?: boolean;
        wait?: boolean;
        pending?: Nachtragzeile[];
      } | null>('/api/media/settings', {
        fallback: null,
        still: true,
      }),
      hub.get<{ alarms?: Wecker[] } | null>('/api/media/alarms', {
        fallback: null,
        still: true,
      }),
      hub.get<{ plans?: Plan[] } | null>('/api/media/volumeplan', {
        fallback: null,
        still: true,
      }),
    ]);
    setFavoriten(f?.favorites ?? []);
    if (e?.night) setNacht(e.night);
    if (typeof e?.duck === 'boolean') setDuck(e.duck);
    if (typeof e?.wait === 'boolean') setWarten(e.wait);
    setNachtrag(e?.pending ?? []);
    setWecker(w?.alarms ?? []);
    setPlaene(l?.plans ?? []);
  }, [hub]);

  useEffect(() => {
    laden();
  }, [laden]);

  const laufend = laufendeMusik(entities);

  // Kennung → Name, damit der Nachtrag-Satz «Nest Badezimmer» sagen kann
  // und nicht «test.speaker_bath».
  // Was ein Lautstärkeplan überhaupt stellen kann - dieselbe Liste, die
  // auch der Hub bildet (lib/lautplan.ts erklärt, warum das wichtig
  // ist). Gruppen und Fernseher stehen mit dabei und tragen ihre
  // Beschriftung, statt still zu fehlen.
  const waehlbareBoxen = useMemo(() => planBoxen(entities), [entities]);

  const namenNachId = useMemo(
    () => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])),
    [entities],
  );

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

  const nachtSetzen = async (
    werte: Partial<Nachtruhe> & { duck?: boolean; wait?: boolean },
  ) => {
    try {
      const antwort = await hub.put<{
        night: Nachtruhe;
        duck: boolean;
        wait: boolean;
        pending?: Nachtragzeile[];
      }>(
        '/api/media/settings',
        {
          ...(werte.on !== undefined ? { on: werte.on } : {}),
          ...(werte.from !== undefined ? { start: werte.from } : {}),
          ...(werte.to !== undefined ? { end: werte.to } : {}),
          ...(werte.max !== undefined ? { max: werte.max } : {}),
          ...(werte.duck !== undefined ? { duck: werte.duck } : {}),
          ...(werte.wait !== undefined ? { wait: werte.wait } : {}),
        },
        { still: true },
      );
      setNacht(antwort.night);
      setDuck(antwort.duck);
      setWarten(antwort.wait);
      setNachtrag(antwort.pending ?? []);
      setNote(null);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  /**
   * Den Plan als Ganzes sichern.
   *
   * Nicht Stufe für Stufe: Ein halb gespeicherter Plan (zwei Stufen
   * weg, die neue noch nicht da) wäre stundenlang in Kraft, ohne dass
   * ihn jemand so gemeint hätte.
   */
  const plaeneSichern = async (naechste: Plan[]) => {
    setPlaene(naechste);
    try {
      const antwort = await hub.put<{ plans: Plan[] }>(
        '/api/media/volumeplan',
        { plans: naechste },
        { still: true },
      );
      setPlaene(antwort.plans ?? []);
      setNote(null);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
      // Zurück auf den Stand des Hubs: Sonst stünde in der Liste etwas,
      // das dort gar nicht angekommen ist.
      laden();
    }
  };

  /** Einen Plan ersetzen - oder herausnehmen, wenn er leer wird. */
  const planSichern = (index: number, naechster: Plan | null) =>
    plaeneSichern(
      naechster === null
        ? plaene.filter((_, i) => i !== index)
        : plaene.map((alt, i) => (i === index ? naechster : alt)),
    );

  const weckerLoeschen = async (eintrag: Wecker) => {
    await hub
      .del(`/api/media/alarms/${encodeURIComponent(eintrag.id)}`, { still: true })
      .catch(() => undefined);
    laden();
  };

  const weckerSpeichern = async () => {
    if (!neuerWecker) return;
    if (!neuerWecker.player) {
      setNote('Dafür bräuchte es Radio oder Spotify - im Haus ist nichts eingerichtet.');
      return;
    }
    try {
      await hub.put(
        '/api/media/alarms',
        {
          time: neuerWecker.time.trim(),
          player: neuerWecker.player,
          device: neuerWecker.device,
          kind: neuerWecker.kind,
          name: neuerWecker.name.trim(),
          days: neuerWecker.days,
          volume: neuerWecker.volume,
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

  /**
   * Überall Pause.
   *
   * Nicht «aus»: Eine Box, die pausiert, weiss noch, wo sie war. Wer
   * gleich weiterhören will, drückt Play - wer nicht, hat Ruhe.
   */
  const ueberallPause = async () => {
    setPausiert(true);
    for (const zeile of laufend) {
      await hub
        .post(
          `/api/entities/${encodeURIComponent(zeile.id)}/command`,
          { command: 'pause' },
          { still: true },
        )
        .catch(() => undefined);
    }
    setPausiert(false);
  };

  /** Einem Favoriten die Box zuweisen, auf der er laufen soll. */
  const zielSetzen = async (favorit: Favorit, box: string) => {
    try {
      await hub.post(
        '/api/media/favorites',
        { ...favorit, device: favorit.device === box ? '' : box },
        { still: true },
      );
      setZiel(null);
      laden();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  /** Die Boxen, die ein Favorit ansteuern kann. */
  const boxenFuer = (favorit: Favorit): string[] => {
    const spieler = entities.find((entity) => entity.id === favorit.player);
    const liste = spieler?.state?.devices;
    return Array.isArray(liste) ? liste.map(String) : [];
  };

  return (
    <Card>
      <Text style={styles.titel}>Musik im Haus</Text>

      {/* ── Was läuft gerade ─────────────────────────────────────── */}
      <Text style={styles.satz}>{hausSatz(laufend)}</Text>
      {laufend.length > 0 ? (
        <Pressable
          onPress={ueberallPause}
          disabled={pausiert}
          accessibilityRole="button"
          accessibilityLabel="Überall Pause"
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="pause" size={13} color={colors.inkSoft} />
          <Text style={styles.chipText}>
            {pausiert ? 'Einen Moment …' : 'Überall Pause'}
          </Text>
        </Pressable>
      ) : null}
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
                  {favorit.device ? ` · ${favorit.device}` : ''}
                </Text>
                {boxenFuer(favorit).length > 0 ? (
                  <Pressable
                    onPress={() => setZiel(ziel?.id === favorit.id ? null : favorit)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Box für ${favorit.name} wählen`}
                  >
                    <Ionicons name="chevron-down" size={13} color={colors.inkFaint} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </View>
          {ziel ? (
            <View style={styles.chips}>
              <Text style={styles.hinweis}>«{ziel.name}» läuft auf:</Text>
              {boxenFuer(ziel).map((box) => (
                <Pressable
                  key={box}
                  onPress={() => zielSetzen(ziel, box)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: ziel.device === box }}
                  style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={ziel.device === box ? 'volume-high' : 'volume-medium-outline'}
                    size={13}
                    color={ziel.device === box ? colors.accent : colors.inkSoft}
                  />
                  <Text style={styles.chipText}>{box}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.hinweis}>
            Lange drücken entfernt einen Favoriten. Ohne Box läuft er dort, wo
            zuletzt gespielt wurde.
          </Text>
        </>
      ) : null}

      {/* «Zuletzt gehört» stand hier einmal. Es beantwortete keine
          Frage, die jemand hatte - und bei einer Durchsage stand statt
          eines Titels die Adresse der erzeugten Tondatei in der Liste.
          Der Hub schreibt den Verlauf weiter mit (core/musik.py); er
          wird hier bloss nicht mehr gezeigt. */}

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
      {/* Der dritte Schalter derselben Frage: Wann darf eine Lautstärke
          von aussen kommen? Nachts gedeckelt, beim Klingeln gedämpft -
          und in laufende Musik gar nicht erst hinein. */}
      <Pressable
        onPress={() => nachtSetzen({ wait: !warten })}
        accessibilityRole="switch"
        accessibilityState={{ checked: warten }}
        style={({ pressed }) => [styles.schalter, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name={warten ? 'hourglass' : 'hourglass-outline'}
          size={16}
          color={warten ? colors.accent : colors.inkSoft}
        />
        <Text style={styles.schalterText}>
          {warten
            ? 'Abläufe stellen eine spielende Box erst um, wenn die Musik aus ist'
            : 'Abläufe stellen die Lautstärke sofort, auch mitten in der Musik'}
        </Text>
      </Pressable>
      {/* Der Box sieht man zwischendurch nichts an - sie steht einfach
          noch auf dem alten Wert. Ohne diese Zeile wäre die naheliegende
          Erklärung «der Ablauf ist kaputt». */}
      {warten && nachtragSatz(nachtrag, namenNachId) ? (
        <Text style={styles.hinweis}>{nachtragSatz(nachtrag, namenNachId)}</Text>
      ) : null}

      {/* ── Lautstärke nach Tageszeit ────────────────────────────── */}
      <Text style={styles.abschnitt}>Lautstärke nach Tageszeit</Text>
      {plaene.map((plan, index) => (
        <Planblock
          key={plan.id ?? index}
          plan={plan}
          boxen={waehlbareBoxen}
          namen={namenNachId}
          jetztMinuten={jetztMinuten}
          onAendern={(naechster) => planSichern(index, naechster)}
          styles={styles}
          colors={colors}
        />
      ))}
      {plaene.length === 0 ? (
        <Pressable
          onPress={() =>
            plaeneSichern([
              {
                name: 'Lautsprecher',
                steps: VORLAGE,
                entities: vorauswahl(waehlbareBoxen),
              },
            ])
          }
          accessibilityRole="button"
          accessibilityLabel="Lautstärke nach Tageszeit einrichten"
          style={({ pressed }) => [styles.schalter, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
          <Text style={styles.schalterText}>
            Einrichten – morgens leise, tagsüber laut, nachts fast aus
          </Text>
        </Pressable>
      ) : (
        <>
          {/* Ein zweiter Plan nur, solange es Boxen gibt, die noch
              keiner abdeckt. Zwei Pläne für dieselbe Box wären ein
              Widerspruch, den der Hub nach der Reihenfolge auflöst - und
              eine Reihenfolge, die man nicht sieht, ist keine
              Erklärung. */}
          {freieBoxen(plaene, waehlbareBoxen.map((box) => box.id)).length > 0 ? (
            <Pressable
              onPress={() =>
                plaeneSichern([
                  ...plaene,
                  {
                    name: 'Weitere Boxen',
                    steps: VORLAGE,
                    entities: freieBoxen(
                      plaene,
                      waehlbareBoxen.map((box) => box.id),
                    ),
                  },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel="Weiteren Plan für andere Boxen anlegen"
              style={({ pressed }) => [styles.schalter, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
              <Text style={styles.schalterText}>
                Eigener Plan für andere Boxen
              </Text>
            </Pressable>
          ) : null}
          <Text style={styles.hinweis}>
            Gilt für stille Boxen. Läuft Musik oder Radio, bleibt die Box, wie sie
            ist – und bekommt ihren Wert, sobald die Wiedergabe endet.
          </Text>
        </>
      )}

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
        <WeckerFormular
          entities={entities}
          entwurf={neuerWecker}
          onChange={setNeuerWecker}
          onSave={weckerSpeichern}
          onCancel={() => setNeuerWecker(null)}
        />
      ) : (
        <Pressable
          onPress={() => setNeuerWecker(ersterEntwurf(entities))}
          accessibilityRole="button"
          accessibilityLabel="Musikwecker stellen"
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="add" size={14} color={colors.inkSoft} />
          <Text style={styles.chipText}>Wecker stellen</Text>
        </Pressable>
      )}
      <Text style={styles.hinweis}>
        Der Wecker blendet ein statt zu piepsen. Lange drücken löscht ihn.
      </Text>

      {note ? <Text style={styles.hinweis}>{note}</Text> : null}
    </Card>
  );
}

/**
 * Ein Lautstärkeplan: für welche Boxen, und ab wann wie laut.
 *
 * Eigene Komponente, seit es mehrere sein dürfen. Der Name kommt aus
 * der Boxenauswahl und nicht aus einem Feld: «Nest Badezimmer und 2
 * weitere» sagt mehr als jeder selbst getippte Titel, und ein
 * Textfeld mehr wäre ein Handgriff mehr für nichts.
 */
function Planblock({
  plan,
  boxen,
  namen,
  jetztMinuten,
  onAendern,
  styles,
  colors,
}: {
  plan: Plan;
  boxen: Planbox[];
  namen: Record<string, string>;
  jetztMinuten: number;
  /** `null` heisst: Plan löschen. */
  onAendern: (naechster: Plan | null) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const [offen, setOffen] = useState(false);
  const stufen = geordnet(plan.steps);

  return (
    <View style={styles.planblock}>
      {/* Die Kopfzeile ist zugleich der Weg zur Auswahl. Sie stand hier
          als blosse Zeile mit einem Pfeil ganz rechts - und wurde
          prompt übersehen: Der Pfeil klebte am Papierkorb und las sich
          wie Zierat. Jetzt ist es ein Knopf mit Rand, der Pfeil steht
          direkt hinter dem Text, und «Gilt für» sagt, worum es geht. */}
      <View style={styles.zeile}>
        <Pressable
          onPress={() => setOffen((auf) => !auf)}
          accessibilityRole="button"
          accessibilityState={{ expanded: offen }}
          accessibilityLabel={`Boxen wählen – gilt für ${boxenSatz(plan.entities, namen)}`}
          style={({ pressed }) => [
            styles.planKopf,
            offen && { borderColor: colors.accent },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="volume-medium-outline" size={14} color={colors.inkSoft} />
          <Text style={styles.planKopfText} numberOfLines={1}>
            Gilt für {boxenSatz(plan.entities, namen)}
          </Text>
          <Ionicons
            name={offen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.accent}
          />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => onAendern(null)}
          accessibilityRole="button"
          accessibilityLabel={`Plan für ${boxenSatz(plan.entities, namen)} löschen`}
          hitSlop={8}
        >
          <Ionicons name="trash-outline" size={14} color={colors.inkFaint} />
        </Pressable>
      </View>

      {offen ? (
        <View style={styles.boxenreihe}>
          {boxen.map((box) => {
            const dabei = boxAn(plan.entities, box.id, box.bildschirm);
            return (
              <Pressable
                key={box.id}
                onPress={() =>
                  onAendern({
                    ...plan,
                    // Was gerade gilt, falls der Plan noch «alle» sagt -
                    // erst ausschreiben, dann umschalten.
                    entities: boxenUmschalten(
                      plan.entities,
                      box.id,
                      vorauswahl(boxen),
                    ),
                  })
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: dabei }}
                accessibilityLabel={`${box.name} in diesem Plan`}
                style={({ pressed }) => [
                  styles.boxchip,
                  dabei && { borderColor: colors.accent },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[styles.boxchipText, dabei && { color: colors.accent, fontWeight: '700' }]}
                  numberOfLines={1}
                >
                  {box.name}
                </Text>
                {/* Was für ein Gerät das ist. Ein Fernseher gehört
                    selten in einen Lautstärkeplan, eine Gruppe stellt
                    ihre Mitglieder mit - beides sollte man sehen, bevor
                    man tippt, und nicht danach. */}
                {box.bildschirm || box.gruppe ? (
                  <Text style={styles.boxchipArt}>
                    {box.bildschirm ? 'Fernseher' : 'Gruppe'}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
          {boxen.length === 0 ? (
            <Text style={styles.hinweis}>Keine Box gefunden, die eine Lautstärke annimmt.</Text>
          ) : null}
        </View>
      ) : null}

      {stufen.map((stufe, index) => {
        const gilt = stufeJetzt(plan.steps, jetztMinuten)?.at === stufe.at;
        return (
          <View key={stufe.at} style={styles.zeile}>
            <Ionicons
              name={gilt ? 'time' : 'time-outline'}
              size={14}
              color={gilt ? colors.accent : colors.inkSoft}
            />
            <Text
              style={[styles.zeileText, gilt && { color: colors.accent, fontWeight: '700' }]}
              numberOfLines={1}
            >
              ab {stufe.at} · {stufenSatz(plan.steps, index)}
            </Text>
            <Pressable
              onPress={() =>
                onAendern({
                  ...plan,
                  steps: plan.steps.filter((andere) => andere.at !== stufe.at),
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Stufe ${stufe.at} löschen`}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={14} color={colors.inkFaint} />
            </Pressable>
          </View>
        );
      })}
      <StufenFormular
        styles={styles}
        colors={colors}
        vorschlag={neueStufe(plan.steps)}
        onSichern={(stufe) =>
          onAendern({ ...plan, steps: geordnet([...plan.steps, stufe]) })
        }
      />
    </View>
  );
}

/**
 * Eine Stufe hinzufügen: Uhrzeit und Prozent, sonst nichts.
 *
 * Eigene Komponente, damit die beiden Felder ihren Zwischenstand
 * behalten, ohne die ganze Musikzentrale bei jedem Tastendruck neu zu
 * zeichnen - dort hängen Favoriten, Verlauf und Wecker mit dran.
 *
 * Der Vorschlag steht schon drin: Wer eine Stufe hinzufügt, hat eine
 * Lücke im Kopf, keine Uhrzeit - und die grösste Lücke ist fast immer
 * die gemeinte (lib/lautplan.ts).
 */
function StufenFormular({
  vorschlag,
  onSichern,
  styles,
  colors,
}: {
  vorschlag: Stufe;
  onSichern: (stufe: Stufe) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const [zeit, setZeit] = useState(vorschlag.at);
  const [prozent, setProzent] = useState(String(vorschlag.volume));
  const gueltig = minuten(zeit) !== null && Number(prozent) >= 0 && Number(prozent) <= 100;

  const sichern = () => {
    if (!gueltig) return;
    onSichern({ at: zeit, volume: Math.round(Number(prozent)) });
    // Zurück auf den nächsten Vorschlag: Das Formular bleibt offen, weil
    // man Stufen meistens zu mehreren einträgt.
    setZeit(vorschlag.at);
    setProzent(String(vorschlag.volume));
  };

  return (
    <View style={styles.formular}>
      <TextInput
        style={styles.eingabe}
        value={zeit}
        onChangeText={setZeit}
        placeholder="07:00"
        placeholderTextColor={colors.inkFaint}
        maxLength={5}
        accessibilityLabel="Ab welcher Uhrzeit"
        onSubmitEditing={sichern}
      />
      <TextInput
        style={styles.eingabe}
        value={prozent}
        onChangeText={setProzent}
        placeholder="30"
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
        maxLength={3}
        accessibilityLabel="Lautstärke in Prozent"
        onSubmitEditing={sichern}
      />
      <Pressable
        onPress={sichern}
        disabled={!gueltig}
        accessibilityRole="button"
        accessibilityLabel="Stufe hinzufügen"
        style={({ pressed }) => [
          styles.schalter,
          { paddingHorizontal: 6 },
          (pressed || !gueltig) && { opacity: 0.5 },
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
      </Pressable>
    </View>
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
    // Ein Plan als eigener Block: abgesetzt, damit bei zweien klar ist,
    // welche Stufen zu welchen Boxen gehören.
    planblock: {
      marginTop: 6,
      paddingTop: 4,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    planKopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    planKopfText: { color: colors.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    boxenreihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
    boxchip: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
      maxWidth: 200,
    },
    boxchipText: { color: colors.inkSoft, fontSize: 12 },
    boxchipArt: { color: colors.inkFaint, fontSize: 10, marginTop: 1 },
  });
