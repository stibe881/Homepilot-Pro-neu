import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CommandData, Entity, KalenderEintrag, Scene } from '../api/types';
import { Card } from '../components/Card';
import { RenameDialog } from '../components/entity/anpassen';
import { DraggableList } from '../components/DraggableList';
import { KIND_ICONS, shortState } from '../components/RoomTile';
import { appleMapsRoute, googleMapsRoute } from '../components/TopStrip';
import { VacuumHome } from '../components/VacuumHome';
import { useTakt } from '../hooks/useTakt';
import { FAVORIT_LUECKE, FAVORIT_MINDEST, kachelBreite, spalten } from '../lib/raster';
import { dauerText, wochentagUhr } from '../lib/format';
import {
  chipZeile,
  fensterZeile,
  kannTimer,
  restMinuten,
  timerAuswahl,
} from '../lib/fernsehtimer';
import {
  Box,
  bestaetigung,
  boxen as boxenVon,
  gueltigesZiel,
  nachDemSenden,
  saetze as saetzeVon,
  satzAendern,
  satzHinzufuegen,
  satzLoeschen,
  sprecherFuer,
  STANDARDTEXTE,
  standardZurueck,
  zielText,
  zieleFuer,
} from '../lib/durchsage';
import { DurchsagePrefs } from '../hooks/usePrefs';
import { DURCHSAGE_ID, favoritenOrdnen } from '../lib/favoritenordnung';
import { haustuerZeile } from '../lib/klingel';
import { KalenderZeile, geburtstagsListe, terminListe } from '../lib/kalenderliste';
import { applianceLine } from '../lib/haushalt';
import {
  aufnahmeFehler,
  dauerText as aufnahmeDauer,
  kannAufnehmen,
  MINDESTENS_MS,
  starteAufnahme,
  type Aufnahme,
} from '../lib/sprachnotiz';
import { mayOpenDirectly } from '../lib/tuerbestaetigung';
import { Colors, radius, space, useColors } from '../theme';

/**
 * Startseite: Überblick über die Wohnung statt aller Geräte.
 *
 * Jeder Platz (Türen, Haushalt, Termine, Musik …) zeigt das passende echte
 * Gerät, sobald es eingebunden ist. Fehlt die Integration noch, steht eine
 * Demo-Kachel da – erkennbar am „Demo“-Etikett, aber bedienbar, damit das
 * Layout schon stimmt.
 */

interface Props {
  entities: Entity[];
  scenes: Scene[];
  now: Date;
  pending: Record<string, boolean>;
  wide: boolean;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  onActivateScene: (sceneId: string) => void;
  /** Auf der Startseite markierte Countdowns (aus dem Familie-Modul). */
  countdowns?: { text: string; date: string; on_start?: boolean }[];
  /** Karten-/Schnappschuss-Adresse eines Geräts – für die Saugerkarte. */
  snapshotUri?: (entity: Entity) => string | undefined;
  /** Als Favorit markierte Geräte-IDs. Kommt von aussen, weil der Stern
   *  in der Geräteliste in die Geräte-Einstellungen schreibt und nicht in
   *  die Entität – wer nur `entity.favorite` liest, sieht nie etwas. */
  favoriteIds?: string[];
  /** Gerät umbenennen - hängt am langen Druck auf einen Favoriten.
   *  Fehlt sie (Gast, alter Hub), bleibt der lange Druck einfach stumm. */
  onRenameEntity?: (entityId: string, name: string) => void;
  /** Selbst gezogene Reihenfolge der Favoriten (Gerätekennungen). */
  favoriteOrder?: string[];
  onReorderFavorites?: (ids: string[]) => void;
  /** Fragt die Türe vor dem Öffnen nach? Haushaltsweit eingestellt; fehlt
   *  der Wert, wird gefragt (siehe lib/tuerbestaetigung.ts). */
  doorConfirm?: boolean;
  /** Eine Durchsage abschicken. Fehlt sie, gibt es die Kachel nicht -
   *  ohne Recht zu schalten wäre sie eine Attrappe. */
  onDurchsage?: (
    text: string,
    speakers: string[]
  ) => Promise<{ sent?: string[]; errors?: string[] }>;
  /** Zuletzt gewählte Box und selbst getippte Sätze - siehe usePrefs. */
  durchsage?: DurchsagePrefs;
  onDurchsagePrefs?: (prefs: DurchsagePrefs) => void;
  /** Eine selbst gesprochene Notiz auf die Boxen. Fehlt sie (native
   *  App, kein Mikrofon), zeigt das Blatt den Knopf gar nicht erst. */
  onSprachnotiz?: (
    aufnahme: Blob,
    speakers: string[]
  ) => Promise<{ sent?: string[]; errors?: string[] }>;
}

const WEEKDAYS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];
const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** «in X Tagen» bis zu einem Datum – für den nächsten Geburtstag (rein,
 *  testbar). Reine Datumsangaben («2026-08-20») werden auf Mittag gesetzt,
 *  damit die Zeitzone die Tageszahl nicht verschiebt. */
function daysUntilText(value: unknown): string {
  const raw = String(value ?? '').trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '';
  const today = new Date();
  const days = Math.round(
    (new Date(target).setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days <= 0) return 'heute! 🎉';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
}

/** Erstes Gerät, das auf Art und (optional) Namensmuster passt. */
function pick(
  entities: Entity[],
  kind: string,
  pattern?: RegExp,
  integration?: string
): Entity | undefined {
  return entities.find(
    (entity) =>
      entity.kind === kind &&
      (!integration || entity.integration === integration) &&
      (!pattern || pattern.test(entity.name))
  );
}

export function OverviewScreen({
  entities,
  scenes,
  now,
  pending,
  wide,
  onCommand,
  onActivateScene,
  countdowns,
  snapshotUri,
  favoriteIds = [],
  favoriteOrder,
  onReorderFavorites,
  onRenameEntity,
  doorConfirm,
  onDurchsage,
  durchsage,
  onDurchsagePrefs,
  onSprachnotiz,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ── Echte Geräte, wo vorhanden ─────────────────────────────────────────
  const frontDoor = pick(entities, 'lock', undefined, 'ring');
  // Die Wohnungstüre ist das Schloss, das sich auf- und abschliessen
  // lässt - unabhängig davon, wie es angebunden ist. Vorher stand hier
  // der Herstellername, im Muster wie in der Integration: Dasselbe Nuki
  // über Matter fiel damit heraus, und die Kachel zeigte wieder die
  // Demo, obwohl das Schloss danebenstand.
  //
  // Der Name hat trotzdem Vorrang: Wer eines «Wohnungstüre» nennt, meint
  // dieses. Sonst das erste echte Schloss - «echt» heisst, es kann
  // abschliessen; ein blosser Türöffner wie die Gegensprechanlage kann
  // das nicht und ist oben schon die Haustüre.
  const flatDoor =
    entities.find(
      (entity) =>
        entity.kind === 'lock' &&
        entity.id !== frontDoor?.id &&
        /wohnung|haustür|wohnungstür/i.test(entity.name)
    ) ??
    entities.find(
      (entity) =>
        entity.kind === 'lock' &&
        entity.id !== frontDoor?.id &&
        entity.commands.includes('lock')
    );
  const vacuum = pick(entities, 'vacuum');
  const dishwasher = pick(entities, 'appliance', /geschirr/i);
  const washer = pick(entities, 'appliance', /wasch/i);
  const tumbler = entities.find(
    (e) => /tumbler|trockner/i.test(e.name) && typeof e.state.power === 'number'
  );
  const calendar = entities.find((e) => e.kind === 'calendar');
  const alert = entities.find((e) => e.kind === 'alert' && e.state.state === 'alert');
  // Die echte Alarmanlage des Hubs; ein per Namen erkannter Schalter ist
  // nur der Notnagel für Aufbauten ohne sie.
  const alarm =
    entities.find((e) => e.kind === 'alarm') ??
    entities.find((e) => /alarm/i.test(e.name) && e.kind === 'switch');
  const covers = entities.filter((e) => e.kind === 'cover');
  // Die persönlichen Favoriten des angemeldeten Benutzers. Bewusst nur
  // die übergebene Liste: Der Stern an der Entität (`e.favorite`) ist der
  // alte Haushalts-Stern – er steckt bereits als Startbestand in
  // `favoriteIds`, solange jemand noch keine eigene Liste hat. Zählte er
  // hier zusätzlich, liesse sich ein Gerät nie mehr entsternen.
  const favoriten = entities.filter((e) => favoriteIds.includes(e.id));
  // Selbst gezogene Reihenfolge anwenden; neu hinzugekommene Favoriten
  // hängen sich hinten an, statt die gewachsene Ordnung durcheinander zu
  // bringen. Dieselbe Regel wie bei den Familien-Kacheln.
  const [favOrdnen, setFavOrdnen] = useState(false);
  // Die Durchsage-Kachel: Sie hängt nicht an einem Gerät, sondern an der
  // Frage, ob es überhaupt eine Box gibt, die eine Tondatei abspielt.
  const durchsageBoxen = useMemo(() => boxenVon(entities), [entities]);
  const [durchsageOffen, setDurchsageOffen] = useState(false);
  // Ohne Box gibt es nichts anzusagen, ohne Recht nichts zu schalten -
  // in beiden Fällen wäre die Kachel eine Attrappe.
  const durchsageMoeglich = !!onDurchsage && durchsageBoxen.length > 0;

  // Alle Favoritenkacheln in einer Liste - die Geräte und die Durchsage.
  //
  // Sie hing vorher fest hinter der Liste, weil sie an keiner Entität
  // hängt. Damit stand sie auch nicht in «Favoriten ordnen»: «Durchsagen
  // kann man nicht sortieren bei den Favoriten.» Jetzt ist sie eine
  // Kachel wie jede andere, mit eigener Kennung (lib/favoritenordnung.ts).
  const favorites = useMemo(
    () =>
      favoritenOrdnen(
        [
          ...favoriten.map((entity) => ({
            id: entity.id,
            name: entity.name,
            entity,
          })),
          ...(durchsageMoeglich
            ? [{ id: DURCHSAGE_ID, name: 'Durchsage', entity: null }]
            : []),
        ],
        favoriteOrder
      ),
    [favoriten, durchsageMoeglich, favoriteOrder]
  );
  // Welcher Fernseher gerade sein Timer-Fenster offen hat. Der Chip auf
  // der Startseite ist zu klein für fünf Knöpfe - und beim Einschalten
  // will man ihn auch nicht versehentlich stellen.
  const [timerTv, setTimerTv] = useState<Entity | null>(null);
  // Welcher Favorit gerade umbenannt wird - null heisst keiner.
  const [umbenennen, setUmbenennen] = useState<Entity | null>(null);
  // Der offene Eintrag frisch aus der Liste: Sonst zeigte das Fenster den
  // Stand von dem Moment, in dem es aufging, und nach «1 h 30» stünde
  // weiter «Kein Timer gestellt».
  const timerEntity = timerTv
    ? (entities.find((e) => e.id === timerTv.id) ?? timerTv)
    : null;

  // Schnellaktionen: alle im Szenen-Editor für die Startseite markierten
  // Szenen. Solange keine markiert ist, springen «Kino» und «Schlafen»
  // (per Namenserkennung) ein, damit die Knöpfe nicht leer starten.
  const flagged = scenes.filter((scene) => scene.on_start);
  const fallback = [
    scenes.find((scene) => /kino/i.test(scene.name)),
    scenes.find((scene) => /schlaf/i.test(scene.name)),
  ].filter(Boolean) as typeof scenes;
  const startScenes = flagged.length > 0 ? flagged : fallback;

  // Nächster auf der Startseite markierter Countdown (TT.MM.JJJJ → Tage).
  const countdown = useMemo(() => {
    const parse = (value: string): number | null => {
      const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value).trim());
      if (!match) return null;
      const target = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
      return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
    };
    const shown = (countdowns ?? [])
      .filter((entry) => entry.on_start)
      .map((entry) => ({ ...entry, days: parse(entry.date) }))
      .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
    return shown[0] ?? null;
  }, [countdowns]);

  // ── Demo-Zustände für noch nicht eingebundene Geräte ───────────────────
  const [demoFlatLocked, setDemoFlatLocked] = useState(true);
  // Nachfrage «Route womit öffnen?» unter dem Termin-Ort.
  const [routeAsk, setRouteAsk] = useState(false);
  const [demoAlarmArmed, setDemoAlarmArmed] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  // Scharf ist alles ausser «unscharf» – auch während der Verzögerung und
  // erst recht, wenn sie ausgelöst hat.
  const alarmArmed = alarm
    ? alarm.kind === 'alarm'
      ? String(alarm.state.state ?? 'unscharf') !== 'unscharf'
      : alarm.state.state === 'on'
    : demoAlarmArmed;
  const alarmText = !alarm
    ? demoAlarmArmed
      ? 'Scharf'
      : 'Unscharf'
    : alarm.kind !== 'alarm'
      ? alarmArmed
        ? 'Scharf'
        : 'Unscharf'
      : String(alarm.state.state) === 'ausgeloest'
        ? 'Alarm ausgelöst'
        : String(alarm.state.state) === 'unscharf'
          ? 'Unscharf'
          : `Scharf · ${alarm.state.mode_label ?? ''}`;

  /** Zwei-Schritt-Bestätigung: erster Tipp fragt, zweiter führt aus.
   *
   *  `command` sagt, worum es geht: Nur das Öffnen der Türe lässt sich
   *  haushaltsweit abschalten (siehe lib/tuerbestaetigung.ts) - alles
   *  andere fragt weiter. */
  const confirmThen = (key: string, command: string, action: () => void) => {
    if (mayOpenDirectly(command, doorConfirm)) {
      setConfirm(null);
      action();
      return;
    }
    if (confirm === key) {
      setConfirm(null);
      action();
    } else {
      setConfirm(key);
      setTimeout(() => setConfirm((c) => (c === key ? null : c)), 4000);
    }
  };

  // Gemessen statt geraten: Prozentbreiten kennen die Lücke nicht, die
  // der Behälter zwischen die Kacheln legt. 2 × 48 % plus 14 Punkte
  // passten erst ab 350 Punkten Innenbreite – auf allem unter einem
  // iPhone Max brach die Reihe darum um. Siehe lib/raster.
  const [rasterBreite, setRasterBreite] = useState(0);
  const tileSpalten = spalten(rasterBreite, { hoechstens: wide ? 3 : 2 });
  const tileWidth =
    rasterBreite > 0 ? kachelBreite(rasterBreite, tileSpalten) : ('100%' as const);
  // Favoriten hatten als Einzige keine gerechnete Breite: Jede Kachel war
  // so breit wie ihr Inhalt, und drei Zimmernamen ergaben zusammen mehr,
  // als ein iPhone hergibt – die dritte rutschte in die zweite Zeile.
  // Jetzt teilen sie sich die Reihe wie jedes andere Raster.
  // Ohne Deckel auf die Anzahl der Favoriten: Eine halb gefüllte Reihe
  // ist auf einem Tablet richtig – drei Schnellzugriffe über 1000 Punkte
  // zu strecken wäre es nicht. Genauso hält es jedes andere Raster hier.
  const favSpalten = spalten(rasterBreite, {
    mindest: FAVORIT_MINDEST,
    hoechstens: wide ? 6 : 3,
    luecke: FAVORIT_LUECKE,
  });
  const favWidth =
    rasterBreite > 0
      ? kachelBreite(rasterBreite, favSpalten, FAVORIT_LUECKE)
      : ('100%' as const);
  const morningFirst = now.getHours() >= 5 && now.getHours() < 11;

  // Bausteine stehen auf Modulebene (unten) – innerhalb der Komponente
  // definiert würden sie bei jedem Live-Update neu erzeugt und laufende
  // Berührungen abgebrochen.

  // Der Zustandstext liegt als reine Funktion in lib/haushalt.ts - dort
  // steht auch, warum die Restzeit nur bei laufendem Gerät erscheint.
  const dish = applianceLine(dishwasher, 'Bereit');
  const wash = applianceLine(washer, 'Läuft · noch 32 min');
  // Der Tumbler hängt an einer Schalt-Messsteckdose: Ob er läuft, verrät
  // erst die Leistung – eingeschaltet ist die Steckdose auch danach noch.
  const tumblerWatts = tumbler ? Number(tumbler.state.power ?? 0) : 1450;
  const tumblerOff = tumbler ? String(tumbler.state.state) === 'off' : false;
  const tumblerRunning = !tumblerOff && tumblerWatts > 5;
  const tumblerText = tumblerOff
    ? 'Steckdose aus'
    : tumblerRunning
      ? 'Am Trocknen'
      : 'Fertig';

  // Kalender: nächster Termin und – als eigener Platz – nächster Geburtstag.
  const events: KalenderEintrag[] = Array.isArray(calendar?.state.events)
    ? calendar!.state.events
    : [];
  const isBirthday = (event: KalenderEintrag) =>
    event.birthday || /geburtstag|birthday/i.test(event.summary ?? '');
  const birthday = events.find(isBirthday);
  const nextEvent = events.find((event) => !isBirthday(event));

  const eventLine = (
    event: KalenderEintrag | undefined,
    demoText: string,
    demoWhen: string
  ) => {
    if (!calendar) return { title: demoText, when: demoWhen, demo: true };
    if (!event) return { title: 'Nichts geplant', when: '', demo: false };
    const when = event.all_day ? 'ganztägig' : wochentagUhr(new Date(event.start));
    return {
      title: event.summary ?? '—',
      when,
      demo: false,
      location: typeof event.location === 'string' ? event.location : null,
    };
  };

  // Welche der beiden Listen offen ist. Die Kacheln zeigen je einen
  // Eintrag; «was kommt diese Woche noch» und «wann hat Levin
  // Geburtstag» standen nirgends, obwohl beides im selben Kalender liegt.
  const [liste, setListe] = useState<'termine' | 'geburtstage' | null>(null);
  const jetztFuerListe = new Date();
  const alleTermine = terminListe(events, jetztFuerListe);
  const alleGeburtstage = geburtstagsListe(events, jetztFuerListe);

  const termin = eventLine(nextEvent, 'Zahnarzt', 'Mo 14:30');
  const geburtstag = birthday
    ? { title: birthday.summary ?? '—', when: daysUntilText(birthday.start), demo: false }
    : { title: 'Livia', when: 'in 12 Tagen', demo: true };

  // ── Anzeige ────────────────────────────────────────────────────────────

  // Die drei Blöcke einmal bauen und unten in der passenden Reihenfolge
  // ausgeben – vorher stand jeder doppelt im Code, einmal pro Tageszeit.
  const zugangBlock = (
    <>
      {/* Zugang & Sicherheit. Die Haustüre stand hier als erste Kachel –
          sie ist in den Kopf neben die Uhr gezogen, wo vorher das Wetter
          war. Übrig bleiben die zwei, die man seltener braucht. */}
      <Text style={styles.groupLabel}>Zugang</Text>
      <View style={styles.tileRow}>
        {/* Beide Kacheln färben sich, statt es nur danebenzuschreiben:
            Eine offene Wohnungstüre und eine scharfe Alarmanlage sind
            Zustände, die man im Vorbeigehen sehen soll - dieselbe Farbe
            wie auf der Gerätekachel. */}
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="key-outline"
          title="Wohnungstüre"
          demo={!flatDoor}
          tint={
            (flatDoor ? String(flatDoor.state.state) !== 'locked' : !demoFlatLocked)
              ? colors.dangerSoft
              : undefined
          }
        >
          <Text style={styles.tileState}>
            {flatDoor
              ? String(flatDoor.state.state) === 'locked'
                ? 'Abgeschlossen'
                : 'Aufgeschlossen'
              : demoFlatLocked
                ? 'Abgeschlossen'
                : 'Aufgeschlossen'}
          </Text>
          {/* Untereinander statt nebeneinander – zwei Textknöpfe passen in
              der schmalen Kachel nicht in eine Zeile. */}
          <View style={styles.actionCol}>
            <Action
              styles={styles}
              label={
                (flatDoor ? String(flatDoor.state.state) === 'locked' : demoFlatLocked)
                  ? 'Aufschliessen'
                  : 'Abschliessen'
              }
              onPress={() =>
                flatDoor
                  ? onCommand(
                      flatDoor.id,
                      String(flatDoor.state.state) === 'locked' ? 'unlock' : 'lock'
                    )
                  : setDemoFlatLocked((v) => !v)
              }
            />
            <Action
              styles={styles}
              label={confirm === 'flat' ? 'Sicher?' : 'Auf + öffnen'}
              accent={confirm === 'flat'}
              onPress={() =>
                confirmThen('flat', 'unlatch', () =>
                  flatDoor ? onCommand(flatDoor.id, 'unlatch') : setDemoFlatLocked(false)
                )
              }
            />
          </View>
        </Tile>

        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="shield-checkmark-outline"
          title="Alarmanlage"
          demo={!alarm}
          tint={alarmArmed ? colors.dangerSoft : undefined}
        >
          <Text
            style={[
              styles.tileState,
              alarmArmed && { color: colors.on },
              String(alarm?.state.state) === 'ausgeloest' && { color: colors.danger },
            ]}
          >
            {alarmText}
          </Text>
          <Action
            styles={styles}
            label={alarmArmed ? 'Unscharf schalten' : 'Scharf schalten'}
            onPress={() =>
              alarm ? onCommand(alarm.id, 'toggle') : setDemoAlarmArmed((v) => !v)
            }
          />
        </Tile>
      </View>
    </>
  );

  const haushaltBlock = (
    <>
      {/* Haushalt */}
      <Text style={styles.groupLabel}>Haushalt</Text>
      <View style={styles.tileRow}>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="sunny-outline"
          title="Tumbler"
          demo={!tumbler}
        >
          <Text style={[styles.tileState, tumblerRunning && { color: colors.accent }]}>
            {tumblerText}
          </Text>
          {!tumblerOff ? (
            <Text style={styles.tileSub}>{Math.round(tumblerWatts)} W</Text>
          ) : null}
        </Tile>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="water-outline"
          title="Waschmaschine"
          demo={!washer}
        >
          <Text style={[styles.tileState, wash.running && { color: colors.accent }]}>
            {wash.text}
          </Text>
        </Tile>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="restaurant-outline"
          title="Geschirrspüler"
          demo={!dishwasher}
        >
          <Text style={[styles.tileState, dish.running && { color: colors.accent }]}>
            {dish.text}
          </Text>
        </Tile>
      </View>
      {vacuum ? (
        <View style={styles.tileRow}>
          <Tile
            styles={styles}
            colors={colors}
            width="100%"
            // Nicht «hardware-chip»: Der Baustein-Chip ist das Sinnbild
            // für «irgendein Gerät» (RoomTile), und vor «Olga» sah er aus
            // wie ein Platzhalter, den jemand vergessen hat. Der Sauger
            // hat dasselbe Sinnbild wie überall sonst.
            icon={KIND_ICONS[vacuum.kind] ?? 'sparkles-outline'}
            title={vacuum.name}
          >
            <VacuumHome
              entity={vacuum}
              uri={snapshotUri?.(vacuum)}
              now={now}
              onCommand={onCommand}
            />
          </Tile>
        </View>
      ) : null}
    </>
  );

  const heuteBlock = (
    <>
      {/* Termine & Musik */}
      <Text style={styles.groupLabel}>Heute</Text>
      <View style={styles.tileRow}>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="calendar-outline"
          title="Nächster Termin"
          demo={termin.demo}
          onPress={alleTermine.length > 0 ? () => setListe('termine') : undefined}
          mehrLabel={`Alle Termine, ${alleTermine.length}`}
        >
          <Text style={styles.tileState} numberOfLines={1}>
            {termin.title}
          </Text>
          {termin.when ? <Text style={styles.tileSub}>{termin.when}</Text> : null}
          {'location' in termin && termin.location ? (
            <>
              <Pressable
                onPress={() => setRouteAsk((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={`Route zu ${termin.location}`}
                style={({ pressed }) => [styles.terminOrtRow, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="location-outline" size={13} color={colors.accent} />
                <Text style={styles.terminOrt} numberOfLines={1}>
                  {termin.location}
                </Text>
              </Pressable>
              {routeAsk ? (
                <View style={styles.routeRow}>
                  <Action
                    styles={styles}
                    label="Google Maps"
                    icon="map-outline"
                    onPress={() => {
                      // Keine Karten-App ist kein Fehler dieser Karte.
                      Linking.openURL(googleMapsRoute(termin.location!)).catch(() => {});
                      setRouteAsk(false);
                    }}
                  />
                  <Action
                    styles={styles}
                    label="Apple Karten"
                    icon="navigate-outline"
                    onPress={() => {
                      // Wie daneben: ohne Karten-App passiert nichts.
                      Linking.openURL(appleMapsRoute(termin.location!)).catch(() => {});
                      setRouteAsk(false);
                    }}
                  />
                </View>
              ) : null}
            </>
          ) : null}
        </Tile>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="gift-outline"
          title="Nächster Geburtstag"
          demo={geburtstag.demo}
          onPress={alleGeburtstage.length > 0 ? () => setListe('geburtstage') : undefined}
          mehrLabel={`Alle Geburtstage, ${alleGeburtstage.length}`}
        >
          <Text style={styles.tileState} numberOfLines={1}>
            {geburtstag.title}
          </Text>
          {geburtstag.when ? <Text style={styles.tileSub}>{geburtstag.when}</Text> : null}
        </Tile>
        {countdown ? (
          <Tile
            styles={styles}
            colors={colors}
            width={tileWidth}
            icon="hourglass-outline"
            title={countdown.text}
          >
            <Text style={styles.tileState} numberOfLines={1}>
              {countdown.days != null
                ? countdown.days > 0
                  ? `noch ${countdown.days} Tage`
                  : countdown.days === 0
                    ? 'heute!'
                    : 'vorbei'
                : '—'}
            </Text>
            <Text style={styles.tileSub}>{countdown.date}</Text>
          </Tile>
        ) : null}
      </View>
      <KalenderFenster
        offen={liste !== null}
        titel={liste === 'geburtstage' ? 'Alle Geburtstage' : 'Alle Termine'}
        zeilen={liste === 'geburtstage' ? alleGeburtstage : alleTermine}
        leer={
          liste === 'geburtstage'
            ? 'Im Kalender steht kein Geburtstag.'
            : 'Im Kalender steht kein Termin.'
        }
        onClose={() => setListe(null)}
        styles={styles}
        colors={colors}
      />
    </>
  );

  return (
    <View
      style={styles.stack}
      // Dieselbe Innenbreite wie jede Kachelreihe darunter – einmal
      // gemessen genügt, sie teilen sich den Rand.
      onLayout={(event) => setRasterBreite(event.nativeEvent.layout.width)}
    >
      {/* Kopf: Uhr, Datum, Haustüre, Warnung */}
      <View style={styles.headRow}>
        <Card style={styles.clockCard}>
          <Text style={styles.clock}>
            {two(now.getHours())}:{two(now.getMinutes())}
          </Text>
          <Text style={styles.date}>
            {WEEKDAYS[now.getDay()]}, {now.getDate()}. {MONTHS[now.getMonth()]}
          </Text>
        </Card>
        {/* Hier stand das Wetter. Aber die Frage beim Blick aufs Panel ist
            nicht «wie ist es draussen», sondern «hat jemand geklingelt» –
            und die Haustüre wohnte dafür zu weit unten, hinter einmal
            Rollen. Das Wetter hat seine Karte im Wetter-Gerät; die
            Warnungen bleiben hier, die gehören nach oben. */}
        <Card style={styles.doorCard}>
          <View style={styles.doorHead}>
            <Ionicons name="business-outline" size={20} color={colors.inkSoft} />
            <Text style={styles.doorTitle}>Haustüre</Text>
            {!frontDoor ? <Text style={styles.doorDemo}>Demo</Text> : null}
          </View>
          {haustuerZeile(frontDoor?.state, new Date()) ? (
            <Text style={styles.doorState} numberOfLines={1}>
              {haustuerZeile(frontDoor?.state, new Date())}
            </Text>
          ) : null}
          <Action
            styles={styles}
            label={confirm === 'front' ? 'Wirklich öffnen?' : 'Öffnen'}
            accent={confirm === 'front'}
            onPress={() =>
              confirmThen('front', 'open_door', () =>
                frontDoor ? onCommand(frontDoor.id, 'open_door') : undefined
              )
            }
          />
          {alert ? (
            <View style={styles.alertRow}>
              <Ionicons name="warning" size={14} color={colors.danger} />
              <Text style={styles.alertText} numberOfLines={1}>
                {String(alert.state.headline ?? alert.state.event ?? 'Wetterwarnung')}
              </Text>
            </View>
          ) : null}
        </Card>
      </View>

      {/* Schnellaktionen */}
      <View style={styles.quickRow}>
        {startScenes.map((scene) => (
          <Action
            styles={styles}
            key={scene.id}
            label={scene.name}
            icon={sceneIcon(scene)}
            accent
            onPress={() => onActivateScene(scene.id)}
          />
        ))}
        <Action
          styles={styles}
          label="Storen hoch"
          icon="arrow-up-outline"
          onPress={() => covers.forEach((c) => onCommand(c.id, 'open'))}
          disabled={covers.length === 0}
        />
        <Action
          styles={styles}
          label="Storen runter"
          icon="arrow-down-outline"
          onPress={() => covers.forEach((c) => onCommand(c.id, 'close'))}
          disabled={covers.length === 0}
        />
      </View>
      {startScenes.length === 0 ? (
        <Text style={styles.hintLine}>
          Szenen wie «Kino» oder «Schlafen» unter Abläufe anlegen und dort «Als
          Schnellaktion anzeigen» wählen – dann erscheinen sie hier.
        </Text>
      ) : null}

      {/* Favoriten aus der Geräteliste – zwischen Schnellaktionen und
          Zugang, damit die eigenen Griffbereit-Geräte oben stehen. Die
          Durchsage zählt mit: Sie hält den Block auch dann offen, wenn
          noch niemand einen Stern vergeben hat, und lässt sich seit
          neuestem mit einordnen. */}
      {favorites.length > 0 ? (
        <>
          <View style={styles.favHead}>
            <Text style={[styles.groupLabel, { flex: 1 }]}>Favoriten</Text>
            {onReorderFavorites && favorites.length > 1 ? (
              <Pressable
                onPress={() => setFavOrdnen(true)}
                accessibilityRole="button"
                accessibilityLabel="Reihenfolge der Favoriten ändern"
                hitSlop={8}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="swap-vertical" size={16} color={colors.onGradient} />
              </Pressable>
            ) : null}
          </View>
          <Modal
            visible={favOrdnen}
            animationType="slide"
            onRequestClose={() => setFavOrdnen(false)}
          >
            <View style={styles.reorderSheet}>
              <View style={styles.reorderHead}>
                <Text style={styles.reorderTitle}>Favoriten ordnen</Text>
                <Pressable onPress={() => setFavOrdnen(false)} accessibilityLabel="Fertig">
                  <Ionicons name="checkmark" size={26} color={colors.ink} />
                </Pressable>
              </View>
              <Text style={styles.reorderHint}>
                Am Griff ☰ ziehen. Die Reihenfolge wird bei deinem Benutzer gespeichert und
                gilt auf allen deinen Geräten.
              </Text>
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <DraggableList
                  items={favorites.map(({ id, name }) => ({ id, name }))}
                  onReorder={(ids) => onReorderFavorites?.(ids)}
                />
              </ScrollView>
            </View>
          </Modal>
          <View style={styles.favRow}>
            {favorites.map((kachel) =>
              kachel.entity ? (
                <FavoriteChip
                  key={kachel.id}
                  entity={kachel.entity}
                  breite={favWidth}
                  pending={!!pending[kachel.id]}
                  onCommand={onCommand}
                  onTimer={() => setTimerTv(kachel.entity)}
                  onRename={
                    onRenameEntity ? () => setUmbenennen(kachel.entity) : undefined
                  }
                  styles={styles}
                  colors={colors}
                />
              ) : (
                /* Die Durchsage. Ohne eigene Reihenfolge steht sie
                   zuletzt - die Favoriten sind persönlich gewählt, sie
                   steht immer da, und vorn schöbe sie jeden Abend das
                   weg, wofür jemand den Stern gesetzt hat. Wer sie
                   woanders haben will, zieht sie jetzt dorthin. */
                <Pressable
                  key={kachel.id}
                  onPress={() => setDurchsageOffen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Durchsage"
                  style={({ pressed }) => [
                    styles.favChip,
                    { width: favWidth },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name="megaphone-outline" size={18} color={colors.inkSoft} />
                  <Text style={styles.favName} numberOfLines={1}>
                    Durchsage
                  </Text>
                  <Text style={styles.favState} numberOfLines={1}>
                    {zielText(
                      gueltigesZiel(durchsage?.ziel, durchsageBoxen),
                      durchsageBoxen
                    )}
                  </Text>
                </Pressable>
              )
            )}
          </View>
          {/* Der Dialog steht einmal hier statt in jedem Chip - es kann
              ohnehin nur einer offen sein. */}
          {umbenennen ? (
            <RenameDialog
              visible
              current={umbenennen.name}
              onClose={() => setUmbenennen(null)}
              onSubmit={(name) => {
                setUmbenennen(null);
                if (name) onRenameEntity?.(umbenennen.id, name);
              }}
            />
          ) : null}
          <FernsehTimerFenster
            entity={timerEntity}
            onCommand={onCommand}
            onClose={() => setTimerTv(null)}
            styles={styles}
            colors={colors}
          />
          {durchsageOffen && onDurchsage ? (
            <DurchsageFenster
              boxen={durchsageBoxen}
              prefs={durchsage}
              onPrefs={onDurchsagePrefs}
              onSenden={onDurchsage}
              onSprachnotiz={onSprachnotiz}
              onClose={() => setDurchsageOffen(false)}
              styles={styles}
              colors={colors}
            />
          ) : null}
        </>
      ) : null}

      {/* Zugang steht immer gleich unter den Schnellaktionen. Danach
          tauschen Haushalt und Heute je nach Tageszeit den Platz: morgens
          zuerst der Tag (Termine, Musik), abends zuerst die Wohnung. */}
      {zugangBlock}
      {morningFirst ? (
        <>
          {heuteBlock}
          {haushaltBlock}
        </>
      ) : (
        <>
          {haushaltBlock}
          {heuteBlock}
        </>
      )}
    </View>
  );
}

type OverviewStyles = ReturnType<typeof makeStyles>;

/** Ein Favorit als kompakter Chip: Symbol, Name, Zustand. Schaltbares
 *  schaltet ein Tipp um; Storen wechseln zwischen auf und zu; der Rest
 *  zeigt nur an. Auf Modulebene wie Tile und Action – innerhalb der
 *  Komponente definiert würde jeder Live-Update laufende Berührungen
 *  abbrechen. */
function FavoriteChip({
  entity,
  breite,
  pending,
  onCommand,
  onTimer,
  onRename,
  styles,
  colors,
}: {
  entity: Entity;
  /** Gerechnete Spaltenbreite – vor der ersten Messung «100%». */
  breite: number | '100%';
  pending: boolean;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  /** Öffnet das Timer-Fenster – nur bei Geräten, die einen können. */
  onTimer: () => void;
  /** Öffnet den Umbenennen-Dialog. Ohne Recht dazu: kein langer Druck. */
  onRename?: () => void;
  styles: OverviewStyles;
  colors: Colors;
}) {
  const state = String(entity.state.state ?? '');
  const active = state === 'on' || state === 'playing' || state === 'cleaning';
  const timer = kannTimer(entity);
  // Nur mitzählen, solange etwas läuft. Ein Zähler, der auch ohne Timer
  // jede Viertelminute neu zeichnet, kostet Akku für nichts - und das
  // mal so viele Chips, wie jemand Favoriten hat.
  const [jetzt, setJetzt] = useState(() => Date.now());
  const laeuft = timer && restMinuten(entity.state.sleep_until, jetzt) !== null;
  useTakt(() => setJetzt(Date.now()), laeuft ? 15000 : null);
  // Beim Stellen die Uhr nachziehen. Ohne das rechnete der frisch
  // gestellte Timer gegen den Zeitpunkt, an dem die Seite geladen wurde -
  // und aus «1 h 30 min» wurden «1 h 31 min», weil der Takt erst
  // fünfzehn Sekunden später das erste Mal schlägt.
  useEffect(() => setJetzt(Date.now()), [entity.state.sleep_until]);

  const tap = () => {
    // Beim Fernseher ist der Timer der Griff, den man abends sucht - und
    // ein Chip, der beim Antippen umschaltet, wäre dafür der falsche
    // Ort. An- und Ausschalten steht weiterhin auf der Gerätekachel.
    if (timer) {
      onTimer();
    } else if (entity.commands.includes('toggle')) {
      onCommand(entity.id, 'toggle');
    } else if (entity.commands.includes('turn_on')) {
      onCommand(entity.id, state === 'on' ? 'turn_off' : 'turn_on');
    } else if (entity.kind === 'cover' && entity.commands.includes('open')) {
      onCommand(entity.id, state === 'closed' ? 'open' : 'close');
    }
  };
  const switchable =
    timer ||
    entity.commands.includes('toggle') ||
    entity.commands.includes('turn_on') ||
    (entity.kind === 'cover' && entity.commands.includes('open'));

  return (
    <Pressable
      onPress={switchable ? tap : undefined}
      // Umbenennen am Ort des Ärgernisses: Wer den falschen Namen liest,
      // liest ihn hier - nicht unter Geräte → Anpassen, drei Schritte
      // weiter. disabled fällt deshalb weg, sobald es ein onRename gibt:
      // Ein deaktiviertes Pressable schluckt auch den langen Druck.
      onLongPress={onRename}
      delayLongPress={350}
      disabled={!switchable && !onRename}
      accessibilityRole={switchable || onRename ? 'button' : undefined}
      accessibilityLabel={entity.name}
      style={({ pressed }) => [
        styles.favChip,
        { width: breite },
        active && styles.favChipActive,
        (pressed || pending) && { opacity: 0.6 },
      ]}
    >
      {/* Symbol über dem Namen statt daneben: Nebeneinander frisst es
          28 Punkte der Breite, und die fehlen genau dort, wo es eng
          wird – bei drei Kacheln auf einem iPhone. Übereinander bekommt
          der Name die ganze Kachelbreite, und «Wohnzimmer» steht
          ungekürzt da. */}
      <Ionicons
        // Läuft ein Timer, ist der Mond das Sinnbild - die Note über
        // «Aus in 1 h 30 min» erzählt vom falschen Gerät.
        name={laeuft ? 'moon' : (KIND_ICONS[entity.kind] ?? 'cube-outline')}
        size={18}
        color={active || laeuft ? colors.accent : colors.inkSoft}
      />
      <Text style={styles.favName} numberOfLines={1}>
        {entity.name}
      </Text>
      <Text
        style={[styles.favState, (active || laeuft) && { color: colors.accent }]}
        numberOfLines={1}
      >
        {timer
          ? // Läuft ein Timer, ist die Restzeit die Auskunft, für die man
            // überhaupt hinsieht - «An» weiss man selbst, man sitzt ja davor.
            chipZeile(entity, jetzt)
          : entity.kind === 'light' || entity.kind === 'switch'
            ? state === 'on'
              ? 'An'
              : 'Aus'
            : shortState(entity)}
      </Text>
    </Pressable>
  );
}

/**
 * Das Durchsage-Fenster hinter der Kachel.
 *
 * Vorher stand die Durchsage als breite Karte unter Einstellungen →
 * Lautsprecher: ein leeres Textfeld und darunter fünfzehn
 * Lautsprechernamen als Chips. Wer «Essen ist fertig» rufen wollte,
 * ging drei Ecken weit, tippte den Satz und suchte die Box aus einer
 * Wand von Namen - jedes Mal denselben Satz, jedes Mal dieselbe Box.
 *
 * Hier ist beides vorbereitet: Das Ziel steht oben und merkt sich, was
 * zuletzt gewählt war; darunter stehen fertige Sätze, und ein Tippen
 * darauf sendet. Zwei Tipper. Das Textfeld bleibt für den Satz, den
 * niemand vorhersehen konnte - und was dort getippt wurde, steht beim
 * nächsten Mal oben bei den Vorschlägen.
 */
function DurchsageFenster({
  boxen,
  prefs,
  onPrefs,
  onSenden,
  onSprachnotiz,
  onClose,
  styles,
  colors,
}: {
  boxen: Box[];
  prefs?: DurchsagePrefs;
  onPrefs?: (prefs: DurchsagePrefs) => void;
  onSenden: (
    text: string,
    speakers: string[]
  ) => Promise<{ sent?: string[]; errors?: string[] }>;
  onSprachnotiz?: (
    aufnahme: Blob,
    speakers: string[]
  ) => Promise<{ sent?: string[]; errors?: string[] }>;
  onClose: () => void;
  styles: OverviewStyles;
  colors: Colors;
}) {
  // Das gemerkte Ziel gilt nur, solange es die Box noch gibt - sonst
  // ginge die Durchsage ins Leere, ohne dass jemand sähe, warum.
  const [ziel, setZiel] = useState(() => gueltigesZiel(prefs?.ziel, boxen));
  const [zielOffen, setZielOffen] = useState(false);
  const [frei, setFrei] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Der Stift oben: Statt zu senden werden die eigenen Sätze gepflegt -
  // hinzufügen, umformulieren, löschen. Die mitgelieferten bleiben
  // aussen vor: Sie gehören der App, und gelöscht wären sie beim
  // nächsten Update kommentarlos wieder da.
  const [verwalten, setVerwalten] = useState(false);
  // Welcher Satz gerade im Feld zum Umformulieren liegt.
  const [bearbeite, setBearbeite] = useState<string | null>(null);
  // Eine Liste, nicht zwei: Was mitgeliefert wurde und was jemand
  // selbst getippt hat, steht gleichberechtigt nebeneinander und lässt
  // sich gleich behandeln.
  const texte = useMemo(() => saetzeVon(prefs ?? {}), [prefs]);

  // Die Sprachnotiz: laufende Aufnahme, ihr Beginn (für die Uhr) und
  // ob dieser Browser überhaupt ein Mikrofon hergibt. `kannAufnehmen`
  // einmal beim Anlegen - die Antwort ändert sich nicht mehr, und in
  // der nativen App fällt der Knopf damit ganz weg statt auszugrauen.
  const mikrofon = useMemo(() => !!onSprachnotiz && kannAufnehmen(), [onSprachnotiz]);
  const laufend = useRef<Aufnahme | null>(null);
  const [seit, setSeit] = useState<number | null>(null);
  const [jetzt, setJetzt] = useState(() => Date.now());

  // Die Sekundenanzeige läuft nur, solange aufgenommen wird - ein
  // Ticker, der immer läuft, zeichnet das Blatt bei jedem Tippen neu.
  useEffect(() => {
    if (seit === null) return;
    const takt = setInterval(() => setJetzt(Date.now()), 250);
    return () => clearInterval(takt);
  }, [seit]);

  // Beim Schliessen des Blattes das Mikrofon loslassen. Sonst bliebe im
  // Browser der rote Punkt im Tab stehen, und auf dem Wandpanel sähe
  // es aus, als höre die Wohnung weiter zu.
  useEffect(
    () => () => {
      laufend.current?.abbrechen();
      laufend.current = null;
    },
    []
  );

  const aufnahmeUmschalten = async () => {
    if (busy) return;
    if (laufend.current) {
      const aufnahme = laufend.current;
      const dauer = Date.now() - (seit ?? Date.now());
      laufend.current = null;
      setSeit(null);
      const ton = await aufnahme.stopp();
      // Zu kurz heisst: Der Knopf ist gewackelt. Das hier zu sagen ist
      // freundlicher, als eine Zehntelsekunde Rauschen durchs Haus zu
      // schicken - und der Hub wiese sie ohnehin ab.
      if (!ton || dauer < MINDESTENS_MS) {
        setNote('Zu kurz - den Knopf gedrückt lassen, bis der Satz durch ist.');
        return;
      }
      setBusy(true);
      setNote(null);
      try {
        const antwort = await onSprachnotiz?.(ton, sprecherFuer(ziel));
        setNote(bestaetigung(antwort ?? {}));
      } catch (err) {
        setNote(String(err instanceof Error ? err.message : err));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      laufend.current = await starteAufnahme();
      setSeit(Date.now());
      setJetzt(Date.now());
      setNote(null);
    } catch (err) {
      setNote(aufnahmeFehler(err));
    }
  };

  const speichern = () => {
    const sauber = frei.trim();
    if (!sauber) return;
    // `letzter` fällt bei jedem Handgriff weg: Der Satz steht danach in
    // der Liste, und ein zweites Feld daneben wäre wieder etwas, das
    // sich niemand erklären kann.
    onPrefs?.({
      ...prefs,
      letzter: undefined,
      texte: bearbeite
        ? satzAendern(prefs ?? {}, bearbeite, sauber)
        : satzHinzufuegen(prefs ?? {}, sauber),
    });
    setFrei('');
    setBearbeite(null);
  };

  const loeschen = (satz: string) => {
    onPrefs?.({ ...prefs, letzter: undefined, texte: satzLoeschen(prefs ?? {}, satz) });
    if (bearbeite === satz) {
      setBearbeite(null);
      setFrei('');
    }
  };

  const waehle = (naechstes: string) => {
    setZiel(naechstes);
    setZielOffen(false);
    onPrefs?.({ ...prefs, ziel: naechstes });
  };

  const sende = async (text: string) => {
    const sauber = text.trim();
    if (!sauber || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const antwort = await onSenden(sauber, sprecherFuer(ziel));
      setNote(bestaetigung(antwort ?? {}));
      setFrei('');
      // Ein selbst getippter Satz landet in derselben Liste wie alle
      // anderen - und ist damit auch gleich wieder zu ändern oder zu
      // löschen. Früher lag er in einem eigenen Feld, das genau einen
      // Satz hielt und ihn beim nächsten überschrieb.
      const liste = nachDemSenden(prefs ?? {}, sauber);
      if (liste) onPrefs?.({ ...prefs, ziel, letzter: undefined, texte: liste });
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent>
      <Pressable style={styles.fensterGrund} onPress={onClose}>
        <Pressable style={styles.fensterBlatt} onPress={() => {}}>
          <View style={styles.fensterKopf}>
            <Text style={styles.fensterTitel}>Durchsage</Text>
            <Pressable
              onPress={() => {
                setVerwalten((an) => !an);
                setBearbeite(null);
                setFrei('');
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: verwalten }}
              accessibilityLabel={verwalten ? 'Sätze fertig bearbeiten' : 'Sätze bearbeiten'}
              hitSlop={8}
              style={{ marginRight: 14 }}
            >
              <Ionicons
                name={verwalten ? 'checkmark' : 'pencil-outline'}
                size={21}
                color={verwalten ? colors.accent : colors.inkSoft}
              />
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
            >
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>

          {/* Erst wohin, dann was. Andersherum hätte man den Satz schon
              abgeschickt, bevor die Frage nach der Box überhaupt kam. */}
          <Pressable
            onPress={() => setZielOffen((auf) => !auf)}
            accessibilityRole="button"
            accessibilityState={{ expanded: zielOffen }}
            accessibilityLabel={`Ziel: ${zielText(ziel, boxen)}`}
            style={({ pressed }) => [styles.durchsageZiel, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="volume-medium-outline" size={18} color={colors.inkSoft} />
            <Text style={styles.durchsageZielText} numberOfLines={1}>
              {zielText(ziel, boxen)}
            </Text>
            <Ionicons
              name={zielOffen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.inkSoft}
            />
          </Pressable>
          {/* Beim Wählen nur die Liste: Sonst stünden Boxenliste, sechs
              Sätze und das Textfeld übereinander, und auf einem Telefon
              fiele das Feld unten aus dem Blatt - ohne dass sich das
              Blatt scrollen liesse, weil in ihm schon die Boxenliste
              scrollt. Ein Schritt nach dem anderen ist ohnehin
              verständlicher: erst wohin, dann was. */}
          {zielOffen ? (
            <ScrollView style={styles.durchsageListe} keyboardShouldPersistTaps="handled">
              {zieleFuer(boxen).map((box) => (
                <Pressable
                  key={box.id}
                  onPress={() => waehle(box.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: box.id === ziel }}
                  style={({ pressed }) => [
                    styles.durchsageZeile,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.durchsageZeileText,
                      box.id === ziel && { color: colors.accent, fontWeight: '700' },
                    ]}
                  >
                    {box.name}
                  </Text>
                  {box.id === ziel ? (
                    <Ionicons name="checkmark" size={18} color={colors.accent} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <>
          {/* Ein Tippen auf den Satz sendet ihn - das ist der ganze Sinn
              der Kachel. Ein zweiter Knopf «Senden» daneben machte aus
              zwei Tippern drei. */}
          <View style={styles.durchsageTexte}>
            {verwalten && texte.length === 0 ? (
              <Text style={styles.durchsageNote}>
                Keine Sätze mehr - unten einen eintippen und mit dem Haken
                sichern.
              </Text>
            ) : null}
            {/* Der Weg zurück, wenn jemand die Liste leergeräumt hat und
                es bereut. Von selbst kommt nichts wieder: Zurückkommende
                Sätze wären dasselbe Ärgernis wie eine Kachel, die man
                nicht ausgeblendet bekommt. */}
            {verwalten && texte.length < STANDARDTEXTE.length ? (
              <Pressable
                onPress={() =>
                  onPrefs?.({
                    ...prefs,
                    letzter: undefined,
                    texte: standardZurueck(prefs ?? {}),
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Mitgelieferte Sätze zurückholen"
                style={({ pressed }) => [styles.durchsageText, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="refresh-outline" size={16} color={colors.inkSoft} />
                <Text style={[styles.durchsageTextLabel, { flex: 1 }]}>
                  Mitgelieferte Sätze zurückholen
                </Text>
              </Pressable>
            ) : null}
            {texte.map((text) => (
              <Pressable
                key={text}
                onPress={verwalten ? undefined : () => sende(text)}
                disabled={busy || verwalten}
                accessibilityRole={verwalten ? undefined : 'button'}
                accessibilityLabel={
                  verwalten ? text : `${text} auf ${zielText(ziel, boxen)}`
                }
                style={({ pressed }) => [
                  styles.durchsageText,
                  bearbeite === text && { borderColor: colors.accent },
                  (pressed || busy) && !verwalten && { opacity: 0.6 },
                ]}
              >
                <Text style={[styles.durchsageTextLabel, { flex: 1 }]}>{text}</Text>
                {verwalten ? (
                  <>
                    <Pressable
                      onPress={() => {
                        setBearbeite(text);
                        setFrei(text);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${text} bearbeiten`}
                      hitSlop={8}
                    >
                      <Ionicons name="pencil-outline" size={16} color={colors.inkSoft} />
                    </Pressable>
                    <Pressable
                      onPress={() => loeschen(text)}
                      accessibilityRole="button"
                      accessibilityLabel={`${text} löschen`}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.inkSoft} />
                    </Pressable>
                  </>
                ) : null}
              </Pressable>
            ))}
          </View>

          <View style={styles.durchsageEigen}>
            <TextInput
              style={styles.durchsageFeld}
              value={frei}
              onChangeText={setFrei}
              placeholder={
                verwalten
                  ? bearbeite
                    ? 'Satz umformulieren …'
                    : 'Neuer Satz …'
                  : 'Eigener Text …'
              }
              placeholderTextColor={colors.inkFaint}
              maxLength={200}
              onSubmitEditing={() => (verwalten ? speichern() : sende(frei))}
              returnKeyType={verwalten ? 'done' : 'send'}
            />
            <Pressable
              onPress={() => (verwalten ? speichern() : sende(frei))}
              disabled={busy || !frei.trim()}
              accessibilityRole="button"
              accessibilityLabel={
                verwalten
                  ? bearbeite
                    ? 'Satz speichern'
                    : 'Satz hinzufügen'
                  : 'Eigenen Text durchsagen'
              }
              style={({ pressed }) => [
                styles.durchsageSenden,
                (pressed || busy || !frei.trim()) && { opacity: 0.5 },
              ]}
            >
              <Ionicons
                name={verwalten ? (bearbeite ? 'checkmark' : 'add') : 'megaphone-outline'}
                size={18}
                color="#FFFFFF"
              />
            </Pressable>
            {/* Die Sprachnotiz steht neben dem Textfeld und nicht
                darüber: Es ist dieselbe Frage («was soll durchgesagt
                werden?»), nur mit der Stimme beantwortet. Während der
                Aufnahme steht die Zeit im Knopf - sonst weiss niemand,
                ob das Mikrofon wirklich läuft. */}
            {mikrofon && !verwalten ? (
              <Pressable
                onPress={aufnahmeUmschalten}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ busy: seit !== null }}
                accessibilityLabel={
                  seit === null
                    ? `Sprachnotiz aufnehmen für ${zielText(ziel, boxen)}`
                    : 'Aufnahme beenden und durchsagen'
                }
                style={({ pressed }) => [
                  styles.durchsageSenden,
                  seit !== null && { backgroundColor: colors.danger },
                  (pressed || busy) && { opacity: 0.5 },
                ]}
              >
                {seit === null ? (
                  <Ionicons name="mic-outline" size={18} color="#FFFFFF" />
                ) : (
                  <Text style={styles.durchsageZeit}>{aufnahmeDauer(jetzt - seit)}</Text>
                )}
              </Pressable>
            ) : null}
          </View>

          {note ? <Text style={styles.durchsageNote}>{note}</Text> : null}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Der Einschlaf-Timer hinter dem Favoriten-Chip.
 *
 * Auf der Fernsehkachel klappt eine Zeile mit denselben Zeiten auf. Der
 * Chip auf der Startseite ist dafür zu schmal – dort wären es fünf
 * Knöpfe auf hundert Punkten. Also ein Fenster, wie bei Termin und
 * Geburtstag: kurz stellen und wieder dort sein, wo man war.
 *
 * Was schon läuft, steht oben – die Frage, mit der man das Fenster
 * öffnet, ist meistens «wie lange noch?» und nicht «wie stelle ich».
 */
function FernsehTimerFenster({
  entity,
  onCommand,
  onClose,
  styles,
  colors,
}: {
  /** `null` heisst: geschlossen. */
  entity: Entity | null;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  onClose: () => void;
  styles: OverviewStyles;
  colors: Colors;
}) {
  const [jetzt, setJetzt] = useState(() => Date.now());
  const rest = entity ? restMinuten(entity.state.sleep_until, jetzt) : null;
  // Nur mitzählen, solange das Fenster offen ist und etwas läuft.
  useTakt(() => setJetzt(Date.now()), entity && rest !== null ? 15000 : null);
  // Und beim Öffnen sowie beim Stellen die Uhr nachziehen – siehe
  // FavoriteChip, dort stand sonst eine Minute zu viel.
  const bis = entity?.state.sleep_until;
  useEffect(() => setJetzt(Date.now()), [bis]);
  if (!entity) return null;

  const stellen = (minuten: number) => {
    onCommand(entity.id, 'sleep_timer', { minutes: minuten });
    onClose();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent>
      <Pressable style={styles.fensterGrund} onPress={onClose}>
        {/* Innen darf das Tippen nicht durchschlagen, sonst geht das
            Fenster beim Zielen auf einen Knopf zu. */}
        <Pressable style={styles.fensterBlatt} onPress={() => {}}>
          <View style={styles.fensterKopf}>
            <Text style={styles.fensterTitel}>{entity.name}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
            >
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.timerStand}>
            <Ionicons
              name={rest !== null ? 'moon' : 'moon-outline'}
              size={18}
              color={rest !== null ? colors.accent : colors.inkSoft}
            />
            <Text
              style={[styles.timerStandText, rest !== null && { color: colors.accent }]}
            >
              {fensterZeile(entity, jetzt)}
            </Text>
          </View>
          <View style={styles.timerWahl}>
            {timerAuswahl(entity).map((minuten) => (
              <Pressable
                key={minuten}
                onPress={() => stellen(minuten)}
                accessibilityRole="button"
                accessibilityLabel={`Fernseher in ${dauerText(minuten)} ausschalten`}
                style={({ pressed }) => [styles.timerChip, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.timerChipText}>{dauerText(minuten)}</Text>
              </Pressable>
            ))}
          </View>
          {rest !== null ? (
            <Pressable
              onPress={() => stellen(0)}
              accessibilityRole="button"
              accessibilityLabel="Timer abbrechen"
              style={({ pressed }) => [styles.timerAbbruch, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={[styles.timerChipText, { color: colors.danger }]}>
                Timer abbrechen
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Badge({ label, styles }: { label: string; styles: OverviewStyles }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

/**
 * Die volle Liste hinter einer Kachel.
 *
 * Auf der Startseite steht je ein Eintrag: der nächste Termin, der
 * nächste Geburtstag. Wer wissen will, was diese Woche noch kommt oder
 * wann Levin Geburtstag hat, fand das nirgends – obwohl beides im selben
 * Kalender liegt. Ein Fenster statt einer eigenen Seite: Man will kurz
 * nachsehen und wieder dort sein, wo man war.
 */
function KalenderFenster({
  offen,
  titel,
  zeilen,
  leer,
  onClose,
  styles,
  colors,
}: {
  offen: boolean;
  titel: string;
  zeilen: KalenderZeile[];
  leer: string;
  onClose: () => void;
  styles: OverviewStyles;
  colors: Colors;
}) {
  return (
    <Modal visible={offen} animationType="slide" onRequestClose={onClose} transparent>
      <Pressable style={styles.fensterGrund} onPress={onClose}>
        {/* Der Griff nach aussen schliesst; innen darf das Tippen nicht
            durchschlagen, sonst geht das Fenster beim Lesen zu. */}
        <Pressable style={styles.fensterBlatt} onPress={() => {}}>
          <View style={styles.fensterKopf}>
            <Text style={styles.fensterTitel}>{titel}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
            >
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>
          {zeilen.length === 0 ? (
            <Text style={styles.fensterLeer}>{leer}</Text>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {zeilen.map((zeile) => (
                <View key={zeile.key} style={styles.fensterZeile}>
                  <Text style={styles.fensterName} numberOfLines={2}>
                    {zeile.titel}
                  </Text>
                  <View style={styles.fensterUnten}>
                    {zeile.wann ? (
                      <Text style={styles.fensterWann}>{zeile.wann}</Text>
                    ) : null}
                    {zeile.ort ? (
                      <Text style={styles.fensterOrt} numberOfLines={1}>
                        · {zeile.ort}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Tile({
  icon,
  title,
  demo,
  children,
  styles,
  colors,
  width,
  tint,
  onPress,
  mehrLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  demo?: boolean;
  children: React.ReactNode;
  styles: OverviewStyles;
  colors: Colors;
  /** In Punkten, aus der gemessenen Fläche gerechnet. «100 %» gilt, bis
   *  gemessen ist, und für Kacheln, die allein eine Reihe füllen. */
  width: number | '100%';
  /** Hintergrund für Zustände, die man im Vorbeigehen sehen soll. */
  tint?: string;
  /** Öffnet die volle Liste hinter der Kachel. Das kleine Zeichen oben
   *  rechts sagt, dass es hier etwas zu sehen gibt – eine Kachel, die
   *  ohne Hinweis auf Antippen reagiert, findet niemand. */
  onPress?: () => void;
  mehrLabel?: string;
}) {
  // Der Inhalt einmal; die Breite trägt aussen, wer da ist – die Karte
  // selbst oder der Druckpunkt um sie herum. Sonst stünde die Kachel im
  // gedrückten Fall zu schmal.
  const karte = (
    <Card style={{ ...styles.tile, width: onPress ? '100%' : width }} tint={tint}>
      <View style={styles.tileHead}>
        <Ionicons name={icon} size={18} color={colors.inkSoft} />
        <Text style={styles.tileTitle} numberOfLines={1}>
          {title}
        </Text>
        {demo ? <Badge label="Demo" styles={styles} /> : null}
        {onPress ? (
          <Ionicons name="chevron-forward" size={15} color={colors.inkSoft} />
        ) : null}
      </View>
      {children}
    </Card>
  );
  if (!onPress) return karte;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={mehrLabel ?? title}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.75 }]}
    >
      {karte}
    </Pressable>
  );
}

/** Icon einer Schnellaktion: das im Szenen-Editor gewählte, sonst eines,
 *  das zum Namen passt («Kino» → Film, «Schlafen» → Mond). */
function sceneIcon(scene: { name: string; icon?: string }): keyof typeof Ionicons.glyphMap {
  if (scene.icon && scene.icon in Ionicons.glyphMap) {
    return scene.icon as keyof typeof Ionicons.glyphMap;
  }
  if (/kino|film|tv/i.test(scene.name)) return 'film-outline';
  if (/schlaf|nacht|bett/i.test(scene.name)) return 'moon-outline';
  if (/morgen|aufstehen/i.test(scene.name)) return 'sunny-outline';
  if (/essen|dinner/i.test(scene.name)) return 'restaurant-outline';
  return 'sparkles-outline';
}

function Action({
  label,
  icon,
  onPress,
  accent,
  disabled,
  styles,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: boolean;
  disabled?: boolean;
  styles: OverviewStyles;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        accent && styles.actionAccent,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={accent ? '#FFFFFF' : undefined}
          style={accent ? undefined : styles.actionIcon}
        />
      ) : null}
      <Text
        style={[styles.actionText, accent && styles.actionTextAccent]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    favHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Das Fenster hinter «Nächster Termin» und «Nächster Geburtstag».
    // Es deckt nicht die ganze Seite: Man will kurz nachsehen und sofort
    // sehen, wohin man zurückkommt.
    fensterGrund: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    fensterBlatt: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: 20,
      paddingBottom: 32,
      gap: 12,
      maxHeight: '80%',
      // Auf dem iPad zöge sich die Liste sonst über die volle Breite,
      // und zwischen Datum und Titel läge eine handbreite Lücke.
      width: '100%',
      maxWidth: 560,
    },
    fensterKopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    fensterTitel: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    fensterLeer: { color: colors.inkSoft, fontSize: 14, paddingVertical: 12 },
    fensterZeile: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surfaceBorder,
      gap: 3,
    },
    fensterName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    fensterUnten: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    fensterWann: { color: colors.inkSoft, fontSize: 13 },
    fensterOrt: { color: colors.inkSoft, fontSize: 13, flexShrink: 1 },
    /** Der Auswahlknopf für die Box - ein Dropdown, keine Chipwand. */
    durchsageZiel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    durchsageZielText: { color: colors.ink, fontSize: 16, fontWeight: '600', flex: 1 },
    // Fünfzehn Boxen wären eine Seite für sich; hier scrollt die Liste in
    // sich, damit die Sätze darunter sichtbar bleiben.
    durchsageListe: {
      maxHeight: 380,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    durchsageZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surfaceBorder,
    },
    durchsageZeileText: { color: colors.ink, fontSize: 15, flex: 1 },
    durchsageTexte: { gap: 8 },
    // Volle Breite statt Chips nebeneinander: Die Sätze sind
    // unterschiedlich lang, und eine Reihe aus Bruchstücken liest sich
    // schlechter als eine Liste - zumal jede Zeile ein Knopf ist, den
    // man im Vorbeigehen treffen soll.
    durchsageText: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    durchsageTextLabel: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    durchsageEigen: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    durchsageFeld: {
      flex: 1,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 15,
    },
    durchsageSenden: {
      width: 44,
      height: 44,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    // Die laufende Sekunde im Aufnahmeknopf - gleich gross wie das
    // Symbol daneben, damit die Zeile beim Umschalten nicht springt.
    durchsageZeit: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    durchsageNote: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
    timerStand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    timerStandText: { color: colors.inkSoft, fontSize: 15, flex: 1 },
    timerWahl: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    timerChip: {
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    timerChipText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    timerAbbruch: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    reorderSheet: {
      flex: 1,
      backgroundColor: colors.panel,
      padding: 20,
      paddingTop: 60,
      gap: 10,
    },
    reorderHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    reorderTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    reorderHint: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    stack: { gap: space.gap },
    headRow: { flexDirection: 'row', gap: space.gap },
    clockCard: { flex: 1, minHeight: 0, justifyContent: 'center' },
    clock: { color: colors.ink, fontSize: 44, fontWeight: '700', letterSpacing: 1 },
    date: { color: colors.inkSoft, fontSize: 14, marginTop: 2 },
    // Die Haustüre neben der Uhr – gleiche Fläche, auf der vorher das
    // Wetter stand.
    doorCard: { flex: 1, minHeight: 0, justifyContent: 'center', gap: 6 },
    doorHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    doorTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    doorDemo: {
      color: colors.inkFaint,
      fontSize: 11,
      marginLeft: 'auto',
    },
    doorState: { color: colors.ink, fontSize: 13 },
    alertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    alertText: { color: colors.danger, fontSize: 12, fontWeight: '600', flex: 1 },

    quickRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    hintLine: { color: colors.onGradientSoft, fontSize: 12, marginTop: -6 },

    groupLabel: {
      color: colors.onGradient,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 6,
    },
    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
    tile: { minHeight: 0, gap: 8, flexGrow: 1 },
    tileHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tileTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', flex: 1 },
    tileState: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    tileSub: { color: colors.inkSoft, fontSize: 13 },
    terminOrtRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    terminOrt: { color: colors.accent, fontSize: 12, flexShrink: 1 },
    routeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

    favRow: { flexDirection: 'row', flexWrap: 'wrap', gap: FAVORIT_LUECKE },
    favChip: {
      gap: 2,
      // Enger als die übrigen Kacheln: Jeder Punkt Polsterung geht bei
      // drei Spalten dreimal vom Namen ab.
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    favChipActive: { borderColor: colors.accent },
    // 13 statt 14 Punkt, und das ist gemessen: Bei drei Spalten auf einem
    // iPhone SE 3 bleiben 83 Punkte für den Namen. «Wohnzimmer» braucht
    // bei 14 Punkt deren 88 und wurde zu «Wohnzimme…»; bei 13 sind es 82.
    favName: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    favState: { color: colors.inkFaint, fontSize: 11 },

    badge: {
      backgroundColor: colors.track,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeText: { color: colors.inkFaint, fontSize: 10, fontWeight: '700' },

    action: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.control,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      flexGrow: 1,
    },
    actionIcon: { color: colors.ink },
    actionAccent: { backgroundColor: colors.accent, borderColor: colors.accent },
    actionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    actionTextAccent: { color: '#FFFFFF' },
    actionRow: { flexDirection: 'row', gap: 8 },
    actionCol: { gap: 8, alignSelf: 'stretch' },
  });
