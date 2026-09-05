import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Activity, CommandData, Entity, EntityState } from '../api/types';
import { uhr, wochentag } from '../lib/format';
import {
  hatEigeneAuswahl,
  istMusikbox,
  musikboxenImRaum,
  pickPlayer,
  quellenSymbol,
  zeigtStopp,
} from '../lib/geraeteart';
import { hatWarteschlange } from '../lib/musikliste';
import { trockenSatz } from '../lib/giessen';
import { Regenstand, balkenHoehen, regenSatz } from '../lib/regen';
import { boxWechsel } from '../lib/boxwahl';
import { panelContent, showsRoomPlayer } from '../lib/seitenspalte';
import { stundenZeilen } from '../lib/stundenwetter';
import { uvWort } from '../lib/uv';
import { Colors, radius, type, useColors } from '../theme';
import { Bar } from './Bar';
import { Card } from './Card';
import { Musikliste } from './Musikliste';
import { RadioPanel, ShuffleRepeat, SpotifyPanel } from './EntityCard';

function severityColor(colors: Colors, severity: string): string {
  return severity === 'Extreme' || severity === 'Severe' ? colors.danger : colors.warn;
}

/**
 * Breite Spalte rechts (Tablet) bzw. Abschnitt unten (Telefon):
 * Wetterlage, Musik und was zuletzt im Haus passiert ist.
 *
 * Steht ein Raum offen, zeigt die Spalte **nur** dessen Box – Wetter und
 * die Musik des Hauses bleiben weg. Wer «Küche» öffnet, will die Küche
 * sehen und nicht das Wetter von Zell und die Box, die im Wohnzimmer
 * spielt; auf dem Telefon schob beides die Lampen unter den Rand. Was
 * bleibt, ist eine Wetterwarnung: Sie wegzuräumen, weil man gerade in
 * einem Zimmer steht, hiesse sie genau dann zu verstecken, wenn man
 * hinschaut. Welche Karte wann steht, entscheidet lib/seitenspalte.ts.
 *
 * Die Box des Raums lag früher als Kachel zwischen seinen Lampen: Man
 * bediente die Musik des Wohnzimmers also an einer anderen Stelle als
 * die Musik des Hauses, und beim Wechsel in den nächsten Raum sprang sie
 * wieder woanders hin. Musik gehört in die Musik-Spalte.
 */
export function SidePanel({
  entities,
  width,
  room,
  onCommand,
  topOffset = 0,
}: {
  entities: Entity[];
  width?: number;
  /** Offener Raum – dessen Box kommt als zweite Karte dazu. Ohne Raum
   *  («Alle», Geräteseiten) bleibt es bei der einen. */
  room?: string | null;
  /** Für den Player – ohne ihn bleibt er weg statt tot dazustehen. */
  onCommand?: (entityId: string, command: string, data?: CommandData) => void;
  /** Versatz nach unten, in Punkten. Im offenen Raum die gemessene Höhe
   *  des Raumkopfs: Die Karte des Raums soll unter dem Titel beginnen,
   *  nicht neben ihm um dieselbe Zeile streiten (nur als Spalte rechts -
   *  auf dem Telefon steht der Abschnitt ohnehin unter allem). */
  topOffset?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const weather = entities.find((entity) => entity.kind === 'weather');
  const alert = entities.find((entity) => entity.kind === 'alert');
  // Warnung nur zeigen, wenn es wirklich eine gibt (für den gewählten Ort).
  const hasAlert = alert && (alert.state.count ?? 0) > 0;
  const players = useMemo(() => entities.filter(istMusikbox), [entities]);
  // Von Hand gewählte Box, solange es sie noch gibt – sonst die naheliegende
  // (siehe pickPlayer): So sieht man immer nur eine Karte, aber jede Box
  // lässt sich ansehen und bedienen, nicht nur die gerade spielende.
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Die zuletzt im Wähler bestimmte Box - reist bis zum Startbefehl mit.
  // Ohne dieses Gedächtnis startete eine Playlist auf der zuletzt
  // aktiven Box statt auf der gewählten: Der Umzug per play_on bleibt
  // bei stillem Spotify nicht haften (siehe lib/boxwahl).
  const [wunschBox, setWunschBox] = useState<string | null>(null);
  const player =
    (chosenId ? players.find((entity) => entity.id === chosenId) : undefined) ??
    pickPlayer(entities);

  // Der Wähler übernimmt auch das Verschieben: Kennt die gezeigte Quelle
  // die Box, zieht die Musik dorthin um (wie früher die «Abspielen
  // auf»-Chips) und die Karte der Quelle bleibt stehen. Fremde Boxen
  // wechseln nur die Ansicht.
  //
  // Früher galt das nur für Spotify. Seit das Radio danebensteht, war
  // dessen Boxenwahl auf der Startseite gar nicht erreichbar: Sein
  // eigenes Panel blendet sie hier aus, weil sie oben in der Kopfzeile
  // sitzt – nur zog die dann Spotify um statt das Radio.
  const choose = (ziel: Entity) => {
    const quelle = player && hatEigeneAuswahl(player) ? player : undefined;
    // Die Entscheidung selbst liegt in lib/boxwahl.ts - dieselbe, die
    // auch das Musik-Blatt über der Raumkachel trifft.
    const wechsel = boxWechsel(quelle ? wechselQuelle(quelle) : null, ziel);
    if (wechsel.art === 'umzug' && quelle) {
      onCommand?.(quelle.id, 'play_on', { device: wechsel.device, play: wechsel.play });
      setChosenId(quelle.id);
      setWunschBox(wechsel.device);
    } else {
      setChosenId(ziel.id);
    }
  };

  // Sobald die gewünschte Box die aktive ist, hat der Wunsch seinen
  // Dienst getan. Ihn weiter festzuhalten hiesse: Wer die Musik später
  // in der Spotify-App woandershin zieht und hier eine Playlist drückt,
  // bekäme sie zurück ins Büro geholt.
  useEffect(() => {
    if (wunschBox && player?.state.device === wunschBox) setWunschBox(null);
  }, [wunschBox, player?.state.device]);

  // Die Box des offenen Raums – immer die des Raums, in dem man gerade
  // steht. Läuft sie ohnehin schon oben (weil sie die spielende des
  // Hauses ist), bleibt es bei der einen Karte statt zweimal derselben.
  const raumBoxen = useMemo(() => musikboxenImRaum(entities, room), [entities, room]);
  const [chosenRoomId, setChosenRoomId] = useState<string | null>(null);
  const raumPlayer =
    (chosenRoomId ? raumBoxen.find((entity) => entity.id === chosenRoomId) : undefined) ??
    pickPlayer(raumBoxen);
  const zeigtRaumPlayer = showsRoomPlayer({
    inRoom: !!room,
    roomPlayerId: raumPlayer?.id,
    housePlayerId: player?.id,
  });

  // Was die Spalte hier zeigt. Im Zimmer bleiben Wetter und die Musik
  // des Hauses weg - beides beantwortet keine Frage, die man im Zimmer
  // stellt (siehe lib/seitenspalte.ts).
  //
  // «Nichts zu zeigen heisst: keine Spalte» steckt als `anything` mit
  // darin. Vorher stand auf einem Tablet im Querformat eine leere Fläche
  // von 340 Punkten am rechten Rand, weil die Spalte ihre Breite auch
  // dann beanspruchte, wenn nichts darin lag - ein knappes Drittel des
  // Bildschirms für nichts. Aufgefallen ist es erst, als die Startseite
  // einmal im Browser auf iPad-Grösse gemessen wurde.
  const zeigt = panelContent({
    inRoom: !!room,
    weather: !!weather,
    housePlayer: !!player && !!onCommand,
    roomPlayer: zeigtRaumPlayer && !!onCommand,
    alert: !!hasAlert,
  });
  if (!zeigt.anything) return null;

  return (
    <View
      style={[
        styles.column,
        width ? { width } : { flex: 1 },
        topOffset > 0 && { marginTop: topOffset },
      ]}
    >
      {zeigt.weather ? <WeatherPanel entity={weather!} /> : null}
      {zeigt.housePlayer && player && onCommand ? (
        <MediaPanel
          entity={player}
          players={players}
          // Die Box der *gezeigten* Quelle, nicht immer die von Spotify:
          // Sonst stünde auf der Radio-Karte, wo Spotify spielt.
          activeDevice={
            hatEigeneAuswahl(player) ? ((player.state.device as string) ?? null) : null
          }
          onSelect={choose}
          onCommand={onCommand}
          wunschBox={wunschBox}
        />
      ) : null}
      {/* Und darunter der Raum, in dem man steht. Eine Box hier
          anzutippen wechselt nur die Ansicht innerhalb des Raums – die
          Musik dorthin zu ziehen wäre der Umzug, den die grosse Karte
          oben schon kann, und würde die Karte mit einer Box füllen, die
          gar nicht in diesem Raum steht. */}
      {zeigt.roomPlayer && onCommand ? (
        <MediaPanel
          entity={raumPlayer!}
          players={raumBoxen}
          titel={room ?? 'Musik'}
          onSelect={(speaker) => setChosenRoomId(speaker.id)}
          onCommand={onCommand}
        />
      ) : null}
      {zeigt.alert ? <AlertPanel entity={alert!} /> : null}
    </View>
  );
}

/** Der Player – unter dem Wetter, weil er dort die volle Spaltenbreite hat.
 *
 * In der Kachelreihe der Startseite zwang der Spotify-Bereich die
 * Nachbarkacheln auf seine Höhe; hier stört er niemanden. */
/** Die gezeigte Quelle, wie `boxWechsel` sie braucht. */
export function wechselQuelle(quelle: Entity) {
  return {
    id: quelle.id,
    kannUmziehen: quelle.commands.includes('play_on'),
    devices: Array.isArray(quelle.state.devices) ? (quelle.state.devices as string[]) : [],
    spielt: quelle.state.state === 'playing',
  };
}

export function MediaPanel({
  entity,
  players,
  activeDevice,
  titel = 'Musik',
  onSelect,
  onCommand,
  wunschBox = null,
}: {
  entity: Entity;
  /** Alle Medien-Geräte, nicht nur das gerade gezeigte – für die
   *  Lautsprecherwahl. Bei nur einem Gerät bleibt die Zeile weg. */
  players: Entity[];
  /** Box, auf der Spotify gerade spielt – für Etikett und Markierung. */
  activeDevice?: string | null;
  /** Überschrift der Karte. Steht eine zweite darunter (die Box des
   *  offenen Raums), sagt der Raumname, welche welche ist. */
  titel?: string;
  onSelect: (speaker: Entity) => void;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  /** Im Wähler bestimmte Box - fürs Starten von Playlist und Sender. */
  wunschBox?: string | null;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playing = entity.state.state === 'playing';
  // Zugeklappt zeigt die Karte nur den Namen des gewählten Players – die
  // volle Liste erst auf Antippen. Eine Box antippen heisst: Musik dorthin
  // (die frühere «Abspielen auf»-Zeile ist hier aufgegangen).
  const [pickerOpen, setPickerOpen] = useState(false);
  // Was als Nächstes läuft – hinter Cover und Titel.
  const [listeOffen, setListeOffen] = useState(false);
  const command = (name: string, data?: CommandData) => onCommand(entity.id, name, data);
  const istQuelle = hatEigeneAuswahl(entity);
  // Der Wähler führt nur noch Boxen, also steht auch nur die Box darauf.
  // Vorher stand dort der Name der Quelle – neben einem Chip, auf dem
  // schon «Radio» steht, ist das dasselbe Wort zweimal.
  const pickerLabel = istQuelle ? (activeDevice ?? 'Box wählen') : entity.name;

  // Zwei verschiedene Fragen, die bisher in einer Liste steckten: *was*
  // spielt (Spotify oder Radio) und *wo* es spielt (welche Box). Beides
  // hiess «Lautsprecher wählen» und lag hinter demselben Pfeil – die
  // Quelle war damit weder benannt noch zu sehen, ohne aufzuklappen.
  const quellen = useMemo(() => players.filter(hatEigeneAuswahl), [players]);
  const boxen = useMemo(
    () => players.filter((player) => !hatEigeneAuswahl(player)),
    [players]
  );

  return (
    <Card style={styles.mediaCard}>
      <View style={styles.mediaHead}>
        <Ionicons name="musical-notes-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.heading}>{titel}</Text>
        {boxen.length > 0 ? (
          <Pressable
            onPress={() => setPickerOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: pickerOpen }}
            accessibilityLabel="Lautsprecher wählen"
            style={({ pressed }) => [styles.speakerPicker, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.speakerPickerText} numberOfLines={1}>
              {pickerLabel}
            </Text>
            <Ionicons
              name={pickerOpen ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.inkSoft}
            />
          </Pressable>
        ) : null}
      </View>
      {/* Die Quellen offen und nicht hinter einem Pfeil: Es sind zwei
          oder drei, sie ändern sich nicht, und «wo ist das Radio» soll
          man nicht suchen müssen. */}
      {quellen.length > 1 ? (
        <View style={styles.speakerRow}>
          {quellen.map((quelle) => {
            const selected = quelle.id === entity.id;
            return (
              <Pressable
                key={quelle.id}
                onPress={() => onSelect(quelle)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${quelle.name} anzeigen`}
                style={[styles.speakerChip, selected && styles.speakerChipActive]}
              >
                <Ionicons
                  name={quellenSymbol(quelle) as keyof typeof Ionicons.glyphMap}
                  size={13}
                  color={
                    selected
                      ? '#FFFFFF'
                      : quelle.state.state === 'playing'
                        ? colors.accent
                        : colors.inkSoft
                  }
                />
                <Text
                  style={[styles.speakerChipText, selected && styles.speakerChipTextActive]}
                  numberOfLines={1}
                >
                  {quelle.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {pickerOpen && boxen.length > 0 ? (
        // Eine ruhige Spalte statt Chips im Flattersatz: Bei einem
        // Dutzend Boxen ergaben die Pillen vier ausgefranste Zeilen, in
        // denen das Auge jeden Namen einzeln suchen musste. Eine Liste
        // liest sich von oben nach unten, alphabetisch, die gewählte Box
        // trägt ein Häkchen - und wo Musik läuft, sagt es das Symbol.
        <View style={styles.speakerList}>
          {[...boxen]
            .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            .map((speaker, index) => {
              const selected =
                speaker.id === entity.id ||
                (istQuelle && activeDevice != null && speaker.name === activeDevice);
              return (
                <Pressable
                  key={speaker.id}
                  onPress={() => {
                    onSelect(speaker);
                    setPickerOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Musik auf ${speaker.name}`}
                  style={({ pressed }) => [
                    styles.speakerItem,
                    index > 0 && styles.speakerItemTrenner,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons
                    name={
                      speaker.state.state === 'playing'
                        ? 'volume-high-outline'
                        : 'volume-mute-outline'
                    }
                    size={15}
                    color={
                      speaker.state.state === 'playing' ? colors.accent : colors.inkFaint
                    }
                  />
                  <Text
                    style={[
                      styles.speakerItemText,
                      selected && styles.speakerItemTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {speaker.name}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark" size={16} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
        </View>
      ) : null}
      {/* Cover und Titel öffnen, was als Nächstes kommt – aber nur, wenn
          es etwas zu zeigen gibt. Eine Karte, die auf Antippen nichts tut,
          ist schlimmer als eine, die gar nicht darauf reagiert. */}
      <Pressable
        onPress={hatWarteschlange(entity.state) ? () => setListeOffen(true) : undefined}
        accessibilityRole={hatWarteschlange(entity.state) ? 'button' : undefined}
        accessibilityLabel={
          hatWarteschlange(entity.state) ? 'Was als Nächstes läuft' : undefined
        }
        style={({ pressed }) => [styles.nowPlayingRow, pressed && { opacity: 0.75 }]}
      >
        {entity.state.image ? (
          <Image
            source={{ uri: String(entity.state.image) }}
            style={styles.coverArt}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={styles.nowPlayingText}>
          <Text style={styles.mediaTrack} numberOfLines={2}>
            {entity.state.track ?? 'Nichts läuft'}
          </Text>
          {entity.state.artist ? (
            <Text style={styles.mediaArtist} numberOfLines={1}>
              {entity.state.artist}
            </Text>
          ) : null}
        </View>
        {hatWarteschlange(entity.state) ? (
          <Ionicons name="list-outline" size={18} color={colors.inkFaint} />
        ) : null}
      </Pressable>
      <Musikliste
        state={entity.state}
        offen={listeOffen}
        onClose={() => setListeOffen(false)}
        onPlay={
          entity.commands.includes('play_queue')
            ? (uri) => command('play_queue', { uri })
            : undefined
        }
      />

      <View style={styles.mediaButtons}>
        {entity.commands.includes('previous') ? (
          <Pressable
            onPress={() => command('previous')}
            accessibilityRole="button"
            accessibilityLabel="Voriger Titel"
            style={styles.playButton}
          >
            <Ionicons name="play-skip-back" size={18} color={colors.ink} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => command(playing ? 'pause' : 'play')}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Abspielen'}
          style={styles.playButton}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.ink} />
        </Pressable>
        {/* Stopp neben Pause, aber nur auf Boxen mit einer Sitzung:
            Pause hält bloss an - die Sitzung bleibt auf der Box und
            hält sie besetzt. Stopp beendet sie (lib/geraeteart,
            zeigtStopp). */}
        {zeigtStopp(entity) ? (
          <Pressable
            onPress={() => command('turn_off')}
            accessibilityRole="button"
            accessibilityLabel="Stopp – Wiedergabe beenden"
            style={styles.playButton}
          >
            <Ionicons name="stop" size={18} color={colors.ink} />
          </Pressable>
        ) : null}
        {entity.commands.includes('next') ? (
          <Pressable
            onPress={() => command('next')}
            accessibilityRole="button"
            accessibilityLabel="Nächster Titel"
            style={styles.playButton}
          >
            <Ionicons name="play-skip-forward" size={18} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      <ShuffleRepeat entity={entity} onCommand={(name, data) => command(name, data)} />

      {entity.commands.includes('set_volume') ? (
        <View style={styles.volumeRow}>
          <Ionicons
            name={
              entity.state.muted || entity.state.volume === 0 ? 'volume-mute' : 'volume-low'
            }
            size={18}
            color={colors.inkSoft}
          />
          <View style={{ flex: 1 }}>
            <Bar
              height={26}
              value={typeof entity.state.volume === 'number' ? entity.state.volume : 0}
              onChange={(value) => command('set_volume', { volume: value })}
            />
          </View>
          <Ionicons name="volume-high" size={18} color={colors.inkSoft} />
        </View>
      ) : null}

      {entity.commands.includes('play_playlist') ? (
        // Ohne Boxen-Zeile: Die Lautsprecherwahl sitzt oben in der Kopfzeile.
        <SpotifyPanel
          entity={entity}
          hideDevices
          wunschBox={wunschBox}
          onCommand={(name, data) => command(name, data)}
        />
      ) : null}
      {entity.commands.includes('play_radio') ? (
        <RadioPanel
          entity={entity}
          hideDevices
          wunschBox={wunschBox}
          onCommand={(name, data) => command(name, data)}
        />
      ) : null}
    </Card>
  );
}

/** Protokoll «Zuletzt passiert» – eigenständige Karte, eingebunden unter
 *  Einstellungen. */
export function ActivityCard({
  activity,
  limit = 30,
}: {
  activity: Activity[];
  limit?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={styles.activityCard}>
      <Text style={styles.heading}>Zuletzt passiert</Text>
      {activity.length === 0 ? (
        <Text style={styles.empty}>Noch keine Änderung, seit die App verbunden ist.</Text>
      ) : (
        <View style={styles.list}>
          {activity.slice(0, limit).map((item) => (
            <View key={item.id} style={styles.activityRow}>
              <View style={styles.bullet} />
              <Text numberOfLines={1} style={styles.activityName}>
                {item.name}
              </Text>
              <Text style={styles.activitySummary}>
                {item.summary}
                {/* Beantwortet „warum ist das passiert?" */}
                {item.source && item.sourceKind !== 'device' ? ` · ${item.source}` : ''}
              </Text>
              <Text style={styles.activityTime}>{uhr(item.at)}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Wetterlage: aktuell gross, darunter die nächsten sieben Tage als
 *  Streifen mit Symbol, Höchst- und Tiefstwert. Ein Tipp auf die Karte
 *  klappt den heutigen Tag Stunde für Stunde auf - so gewünscht: «60 %
 *  heute» sagt nicht, ob der Grillabend trocken bleibt. */
function WeatherPanel({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const days: EntityState[] = Array.isArray(entity.state.days) ? entity.state.days : [];
  const [stunden, setStunden] = useState(false);
  const stundenListe = stundenZeilen(entity.state.hours);

  return (
    <Card style={styles.alertCard}>
      <Pressable
        onPress={() => setStunden((offen) => !offen)}
        accessibilityRole="button"
        accessibilityLabel={
          stunden ? 'Stündliches Wetter verbergen' : 'Stündliches Wetter für heute anzeigen'
        }
        style={styles.weatherPress}
      >
        <View style={styles.weatherNow}>
          <Ionicons
            name={
              (entity.state.icon as keyof typeof Ionicons.glyphMap) ??
              'partly-sunny-outline'
            }
            size={40}
            color={colors.ink}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.weatherTemp}>
              {entity.state.temperature != null ? `${entity.state.temperature}°` : '–'}
            </Text>
            <Text style={styles.alertSource}>
              {entity.state.state} · {entity.name}
            </Text>
          </View>
        </View>

        {/* Die Frage am Fenster: Muss die Wäsche jetzt herein? Die
          Wochenzeile darunter beantwortet sie nicht (lib/regen.ts). */}
        {regenSatz(entity.state.rain as Regenstand | undefined) ? (
          <Text style={styles.regen}>
            {regenSatz(entity.state.rain as Regenstand | undefined)}
          </Text>
        ) : null}
        <RegenBalken stand={entity.state.rain as Regenstand | undefined} />
        {/* Der UV-Index, sobald er etwas sagt: ab «mässig» als Zeile, ab
          «hoch» in Warnfarbe. Unter 3 steht nichts - eine Zahl, die
          immer da ist, liest bald niemand mehr (hub/core/uvwarnung.py
          brummt aus demselben Grund erst ab «hoch»). */}
        {uvWort(entity.state.uv_today) ? (
          <Text
            style={[
              styles.uv,
              Number(entity.state.uv_today) >= 6 && { color: colors.warn },
            ]}
          >
            UV heute {uvWort(entity.state.uv_today)} ({String(entity.state.uv_today)})
            {Number(entity.state.uv_today) >= 6 ? ' · eincremen' : ''}
          </Text>
        ) : null}

        {/* Und die andere Richtung: Wie lange es *nicht* geregnet hat.
          Der Hub erinnert abends ans Giessen (hub/core/giessen.py) - hier
          steht dieselbe Auskunft dort, wo man ohnehin nachsieht. */}
        {trockenSatz(entity.state.dry_days, entity.state.rain_next) ? (
          <Text style={styles.trocken}>
            {trockenSatz(entity.state.dry_days, entity.state.rain_next)} · giessen
          </Text>
        ) : null}

        {/* Aufgeklappt: der heutige Tag Stunde für Stunde, seitlich
          wischbar. Bewusst dieselbe Spaltenform wie die Wochenzeile
          darunter - eine Karte, ein Vokabular. */}
        {stunden ? (
          stundenListe.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityLabel="Heute Stunde für Stunde"
            >
              <View style={styles.hourRow}>
                {stundenListe.map((stunde) => (
                  <View key={stunde.zeit} style={[styles.dayCol, styles.hourCol]}>
                    <Text style={styles.dayName}>{stunde.zeit}</Text>
                    <Ionicons
                      name={
                        (stunde.icon as keyof typeof Ionicons.glyphMap) ?? 'cloud-outline'
                      }
                      size={20}
                      color={colors.inkSoft}
                    />
                    <Text style={styles.dayHigh}>
                      {stunde.temp != null ? `${stunde.temp}°` : '–'}
                    </Text>
                    {stunde.rain != null && stunde.rain >= 20 ? (
                      <Text style={styles.dayRain}>{stunde.rain}%</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            // Ein Hub von vor dieser Funktion schickt keine Stundenwerte.
            // Dann steht hier, woran es liegt - eine Karte, die auf den
            // Tipp einfach nichts tut, sieht kaputt aus.
            <Text style={styles.hourHint}>
              Stundenwerte kennt erst der neue Hub - einmal aktualisieren (Einstellungen →
              System → Update).
            </Text>
          )
        ) : null}

        {days.length > 0 ? (
          <View style={styles.weekRow}>
            {days.map((day, index) => (
              <View key={day.date ?? index} style={styles.dayCol}>
                <Text style={styles.dayName}>
                  {index === 0 ? 'Heute' : weekdayShort(day.date)}
                </Text>
                <Ionicons
                  name={(day.icon as keyof typeof Ionicons.glyphMap) ?? 'cloud-outline'}
                  size={20}
                  color={colors.inkSoft}
                />
                <Text style={styles.dayHigh}>
                  {day.high != null ? `${day.high}°` : '–'}
                </Text>
                <Text style={styles.dayLow}>{day.low != null ? `${day.low}°` : ''}</Text>
                {day.rain != null && day.rain >= 20 ? (
                  <Text style={styles.dayRain}>{day.rain}%</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    </Card>
  );
}

/**
 * Die nächsten zwei Stunden Regen als acht kleine Balken.
 *
 * Der Satz darüber sagt «in etwa 45 Minuten»; die Balken sagen, ob das
 * ein Schauer ist oder der Anfang eines nassen Nachmittags. Ein Balken
 * je Viertelstunde - die Auflösung der Quelle, nichts Feineres.
 *
 * Ganz ohne Regen erscheint nichts: Acht leere Balken wären Tinte für
 * die Auskunft «kein Regen», und die gibt die Karte schon dadurch,
 * dass hier nichts steht.
 */
function RegenBalken({ stand }: { stand: Regenstand | undefined }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hoehen = balkenHoehen(stand?.bars, 22);
  if (hoehen.length === 0) return null;
  return (
    <View style={styles.regenReihe} accessibilityLabel="Regen der nächsten zwei Stunden">
      <View style={styles.regenBalken}>
        {hoehen.map((hoehe, index) => (
          <View
            key={index}
            style={[
              styles.regenBalkenSaeule,
              // Trocken bleibt als flacher Sockel sichtbar - so liest
              // sich die Lücke zwischen zwei Schauern als Lücke.
              { height: Math.max(2, hoehe) },
              hoehe === 0 && { backgroundColor: colors.track },
            ]}
          />
        ))}
      </View>
      <View style={styles.regenAchse}>
        <Text style={styles.regenAchsenText}>jetzt</Text>
        <Text style={styles.regenAchsenText}>+2 Std</Text>
      </View>
    </View>
  );
}

/** Wochentagskürzel aus einem ISO-Datum (YYYY-MM-DD). */
function weekdayShort(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return wochentag(parsed);
}

function AlertPanel({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const count = entity.state.count ?? 0;
  const severity = entity.state.max_severity;
  const tone = count > 0 ? severityColor(colors, severity) : colors.on;
  const alerts: Record<string, string | undefined>[] = entity.state.alerts ?? [];

  return (
    <Card style={styles.alertCard}>
      <View style={styles.alertHead}>
        <Ionicons
          name={count > 0 ? 'thunderstorm-outline' : 'sunny-outline'}
          size={26}
          color={tone}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Wetterlage</Text>
          <Text style={styles.alertSource}>{entity.name}</Text>
        </View>
      </View>

      <Text style={[styles.alertCount, { color: tone }]}>
        {count > 0 ? `${count} Warnungen` : 'Keine Warnungen'}
      </Text>

      <View style={styles.list}>
        {alerts.slice(0, 4).map((item, index) => (
          <View key={index} style={styles.alertRow}>
            <View
              style={[
                styles.severityBar,
                { backgroundColor: severityColor(colors, item.severity ?? '') },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.alertEvent}>
                {item.event ?? item.title}
              </Text>
              <Text numberOfLines={1} style={styles.alertArea}>
                {item.area}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    column: { gap: 14 },
    mediaCard: { gap: 8, minHeight: 0 },
    mediaHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    speakerPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 'auto',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      maxWidth: '60%',
    },
    speakerPickerText: {
      fontSize: 12,
      color: colors.inkSoft,
      fontWeight: '600',
      flexShrink: 1,
    },
    speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    speakerList: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 12,
    },
    speakerItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
    },
    speakerItemTrenner: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceBorder,
    },
    speakerItemText: { flex: 1, fontSize: 13, color: colors.ink },
    speakerItemTextActive: { color: colors.accent, fontWeight: '700' },
    speakerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      maxWidth: '100%',
    },
    speakerChipActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    speakerChipText: { fontSize: 12, color: colors.inkSoft, flexShrink: 1 },
    speakerChipTextActive: { color: '#FFFFFF' },
    nowPlayingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    coverArt: {
      width: 56,
      height: 56,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
    },
    nowPlayingText: { flex: 1, gap: 2 },
    mediaTrack: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    mediaArtist: { color: colors.inkSoft, fontSize: 13 },
    mediaButtons: { flexDirection: 'row', gap: 8, marginTop: 2 },
    playButton: {
      width: 40,
      height: 34,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    alertCard: { gap: 12, minHeight: 0 },
    // Übernimmt den Abstand der Karte: Seit dem Tipp-zum-Aufklappen ist
    // die ganze Wetterkarte ein Pressable, und `gap` wirkt nur auf
    // direkte Kinder.
    weatherPress: { gap: 12 },
    hourRow: { flexDirection: 'row', gap: 10, paddingRight: 4 },
    // In der wischbaren Reihe darf keine Spalte wachsen - `flex: 1` aus
    // der Wochenzeile presste sonst alle Stunden in die Kartenbreite.
    hourCol: { flex: 0, minWidth: 44 },
    hourHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    activityCard: { gap: 12, minHeight: 0, flexShrink: 1 },
    alertHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    heading: {
      color: colors.ink,
      fontSize: type.cardTitle,
      fontWeight: '700',
    },
    alertSource: {
      color: colors.inkFaint,
      fontSize: 12,
      marginTop: 1,
    },
    alertCount: {
      fontSize: 28,
      fontWeight: '700',
    },
    weatherNow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    weatherTemp: {
      color: colors.ink,
      fontSize: 30,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 2,
    },
    dayCol: { alignItems: 'center', gap: 3, flex: 1 },
    dayName: { color: colors.inkSoft, fontSize: 11, fontWeight: '600' },
    dayHigh: {
      color: colors.ink,
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    dayLow: { color: colors.inkFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
    // Eine Zeile, kein Kasten: Die Vorwarnung gehört zum Wetter und
    // nicht daneben.
    regen: { color: colors.warn, fontSize: 13, fontWeight: '600', marginTop: 2 },
    trocken: { color: colors.inkSoft, fontSize: 13, marginTop: 2 },
    regenReihe: { marginTop: 6, gap: 2 },
    regenBalken: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 3,
      height: 22,
    },
    regenBalkenSaeule: {
      flex: 1,
      maxWidth: 22,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      backgroundColor: colors.accent,
    },
    regenAchse: { flexDirection: 'row', justifyContent: 'space-between' },
    regenAchsenText: { color: colors.inkFaint, fontSize: 10 },
    uv: { color: colors.inkSoft, fontSize: 12, fontWeight: '600', marginTop: 4 },
    dayRain: { color: colors.accent, fontSize: 10, fontWeight: '600' },
    list: { gap: 10 },
    alertRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    severityBar: {
      width: 3,
      height: 30,
      borderRadius: radius.pill,
    },
    alertEvent: {
      color: colors.ink,
      fontSize: 14,
      fontWeight: '500',
    },
    alertArea: {
      color: colors.inkSoft,
      fontSize: 12,
    },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    bullet: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.inkFaint,
    },
    activityName: {
      color: colors.ink,
      fontSize: 13,
      fontWeight: '500',
      flexShrink: 1,
    },
    activitySummary: {
      color: colors.inkSoft,
      fontSize: 13,
      flex: 1,
    },
    activityTime: {
      color: colors.inkFaint,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    empty: {
      color: colors.inkSoft,
      fontSize: 13,
      lineHeight: 19,
    },
  });
