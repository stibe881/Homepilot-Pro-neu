/**
 * Der Szenen-Editor samt Geräteliste und Befehls-Auswahl.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Entity } from '../../api/types';
import { useColors } from '../../theme';
import { deviceKindIcon, deviceKindLabel, geraeteUntertitel } from '../../lib/geraeteart';
import { PALETTE } from '../../components/ColorRow';
import {
  UNVERAENDERT,
  chipWahl,
  chipWert,
  helligkeitsQuellen,
  helligkeitsStufen,
  quelleVon,
  raumHatLux,
} from '../../lib/helligkeitsvorgabe';
import { RueckwegBefehl, SceneActionDraft, snapshotAction } from '../../lib/szenen';
import { Fassung, VersionsSection } from './editor';
import { WEISSTOENE, istAnschalten, vacuumRooms } from './entwurf';
import {
  appsVon,
  baseCommandOptions,
  boxenVon,
  commandOptions,
  imSchnappschuss,
  isSceneDevice,
  mischenMoeglich,
  playlistWahl,
  playlistsVon,
  sendersVon,
  zieltemperaturStandard,
  zieltemperaturen,
} from './szenengeraete';

export { baseCommandOptions, commandOptions, isSceneDevice };
import { CategoryField, Choice, EditorRahmen, Field, NachlaufWahl, Unterfrage } from './felder';
import { makeStyles } from './stil';

export interface SceneDraft {
  id?: string;
  name: string;
  icon: string;
  /** Optionaler Raum – dann erscheint die Szene in dessen Kategorie „Szenen“. */
  room?: string;
  /** Auf der Startseite als Schnellaktion anzeigen. */
  onStart?: boolean;
  /** Übergangszeit in Sekunden – Helligkeiten werden angefahren. */
  transition?: number;
  /** Bleibt die Szene aktiv? Dann leuchtet ihr Knopf, solange sie gilt,
   *  und ein zweiter Druck nimmt sie zurück. Aus für Handlungen wie
   *  «Alles aus», die keinen Zustand herstellen. Fehlt der Wert, gilt
   *  «ja» – so verhalten sich die Szenen, die es schon gab. */
  toggles?: boolean;
  /** Nach so vielen Sekunden nimmt sich die Szene von selbst zurück
   *  (0 = nie). Nur sinnvoll, wenn sie aktiv bleibt. */
  autoOff?: number;
  actions: SceneActionDraft[];
  /** Frei benannte Kategorie zum Gruppieren in der Liste. */
  category?: string;
}

/** Eine Handvoll passender Symbole reicht – die App bleibt aufgeräumt.
 *
 * Dazugekommen sind die Abende, an denen jemand anderes im Haus ist:
 * «Babysitter-Modus» hatte unter sechs Symbolen keines, das passte, und
 * blieb beim allgemeinen Funkeln stehen. Das Gesicht ist dasselbe wie
 * unter Familie → Babysitter. */
export const SCENE_ICONS = [
  'sparkles-outline',
  'sunny-outline',
  'moon-outline',
  'film-outline',
  'wine-outline',
  'home-outline',
  'happy-outline',
  'people-outline',
  'restaurant-outline',
];

/** Geräte-Checkliste statt Zeilen mit Dropdown: antippen nimmt ein Gerät in
 *  die Szene auf, ein zweiter Chip legt den Zielzustand fest. «Aktuellen
 *  Zustand übernehmen» füllt alles in einem Tipp aus der Wirklichkeit. */
/** Die blossen Stufen - für Szenen, die keine Auslöser haben und sich
 *  darum an nichts anpassen können. */
const STUFEN = [
  { key: '10', label: '10 %' },
  { key: '25', label: '25 %' },
  { key: '50', label: '50 %' },
  { key: '75', label: '75 %' },
  { key: '100', label: '100 %' },
];

export function SceneDevices({
  entities,
  actions,
  onActions,
  showSnapshot = true,
  allowToggle = false,
  sceneTransition = 0,
  luxSensors,
  nurAuswahl = false,
}: {
  entities: Entity[];
  actions: SceneDraft['actions'];
  onActions: (actions: SceneDraft['actions']) => void;
  /** Melder des Ablaufs, die Helligkeit messen. Ist die Liste da, bekommen
   *  Lampen die Feinheiten dazu: Farbe, Weissanteil und - sobald ein
   *  Melder Lux liefert - «an die Helligkeit angepasst». Szenen geben sie
   *  nicht mit: Dort gibt es keinen Auslöser, an den man sich anpassen
   *  könnte. */
  luxSensors?: Entity[];
  /** Nur ankreuzen, keine Befehle je Gerät: für «gemeinsam umschalten»,
   *  wo alle denselben Befehl bekommen und der Hub ihn erst beim Drücken
   *  bestimmt. */
  nurAuswahl?: boolean;
  /** Übergangszeit der Szene – nur dann lohnt die Frage «diese Lampe
   *  sofort?». */
  sceneTransition?: number;
  /** Der «Aktuellen Zustand übernehmen»-Knopf – für Szenen sinnvoll, für
   *  Ablauf-Aktionen nicht (dort zählt der Zielzustand, nicht der jetzige). */
  showSnapshot?: boolean;
  /** «umschalten» als dritte Möglichkeit – nur in Abläufen sinnvoll. */
  allowToggle?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  // Im Ablauf-Editor (dort kommt luxSensors mit) bekommen Lampen Farbe
  // und Weissanteil dazu; ob es auch «angepasst» gibt, entscheidet der
  // Melder: ohne Helligkeitsfühler wäre die Wahl eine Attrappe.
  const lichtFein = luxSensors !== undefined;
  const hatLux = (luxSensors ?? []).length > 0;

  const needle = query.trim().toLowerCase();
  const all = entities.filter(isSceneDevice);
  const devices = needle
    ? all.filter(
        (entity) =>
          entity.name.toLowerCase().includes(needle) ||
          (entity.room ?? '').toLowerCase().includes(needle) ||
          // Auch über die Art: «Saugroboter» findet ihn, ohne dass man
          // wissen muss, dass er «Rosa» heisst.
          deviceKindLabel(entity).toLowerCase().includes(needle)
      )
    : all;
  const byId = new Map(actions.map((action) => [action.entity_id, action]));

  // Die gewählten Geräte stehen über der Liste, in der Reihenfolge der
  // Wahl - und die Liste zeigt nur noch, was sich hinzufügen lässt.
  // Vorher stand alles in einer einzigen, ungedeckelten Liste: Wer drei
  // Geräte gewählt hatte, scrollte an hundert anderen vorbei, um sie
  // wiederzufinden.
  const gewaehlte = actions
    .map((action) => all.find((entity) => entity.id === action.entity_id))
    .filter((entity): entity is Entity => !!entity);
  const angebot = devices.filter((entity) => !byId.has(entity.id));

  // Nach Raum gruppieren; Geräte ohne Raum kommen unter «Weitere».
  const groups: { room: string; items: Entity[] }[] = [];
  const order = Array.from(
    new Set(angebot.map((entity) => entity.room || 'Weitere'))
  ).sort((a, b) => (a === 'Weitere' ? 1 : b === 'Weitere' ? -1 : a.localeCompare(b)));
  for (const room of order) {
    groups.push({
      room,
      items: angebot
        .filter((entity) => (entity.room || 'Weitere') === room)
        // Nach Art, dann nach Name: So stehen die Lichter eines Raums
        // beieinander und die Storen auch – in der Reihenfolge, in der
        // die Integration sie meldet, standen sie durcheinander.
        .sort(
          (a, b) =>
            deviceKindLabel(a).localeCompare(deviceKindLabel(b)) ||
            a.name.localeCompare(b.name)
        ),
    });
  }

  const toggle = (entity: Entity) => {
    if (byId.has(entity.id)) {
      onActions(actions.filter((action) => action.entity_id !== entity.id));
    } else {
      onActions([...actions, snapshotAction(entity)]);
    }
  };

  const setCommand = (entityId: string, command: string) =>
    onActions(
      actions.map((action) =>
        action.entity_id === entityId ? { ...action, command } : action
      )
    );

  const setPosition = (entityId: string, position: number) =>
    onActions(
      actions.map((action) =>
        action.entity_id === entityId ? { ...action, position } : action
      )
    );

  /** Ein Feld einer Geräte-Aktion ändern – für Farbe, Weiss und
   *  «angepasst», die sich sonst dreimal fast gleich schrieben. */
  const setField = (entityId: string, teil: Partial<SceneActionDraft>) =>
    onActions(
      actions.map((action) =>
        action.entity_id === entityId ? { ...action, ...teil } : action
      )
    );

  const setRooms = (entityId: string, id: number) =>
    onActions(
      actions.map((action) => {
        if (action.entity_id !== entityId) return action;
        const current = action.rooms ?? [];
        return {
          ...action,
          rooms: current.includes(id)
            ? current.filter((entry) => entry !== id)
            : [...current, id],
        };
      })
    );

  const snapshot = () =>
    onActions(
      // Warum nicht einfach alles: siehe `imSchnappschuss`. Die Regel
      // steht dort, weil sie sich hier nicht prüfen liess.
      devices.filter(imSchnappschuss).map(snapshotAction)
    );

  return (
    <View style={{ gap: 12 }}>
      {showSnapshot ? (
        <>
          <Pressable
            onPress={snapshot}
            accessibilityRole="button"
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="camera-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Aktuellen Zustand übernehmen</Text>
          </Pressable>
          <Text style={styles.snapshotHint}>
            Stell die Zimmer so ein, wie du sie in der Szene willst, und tippe
            oben – oder wähle die Geräte einzeln.
          </Text>
        </>
      ) : null}

      <View style={styles.deviceSearch}>
        <Ionicons name="search" size={15} color={colors.inkFaint} />
        <TextInput
          style={styles.deviceSearchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Gerät oder Raum suchen …"
          placeholderTextColor={colors.inkFaint}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Suche leeren"
          >
            <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>

      {/* Zwei Abschnitte mit Überschrift statt einer durchlaufenden
          Liste: oben, was gilt, unten, was sich dazunehmen lässt. Ohne
          die Überschriften war das eine einzige Reihe von Gerätenamen,
          in der nur ein Häkchen den Unterschied machte - und «1
          Gerät(e)» stand als lose Zeile darüber, weil niemand die
          Mehrzahl bilden wollte. */}
      {gewaehlte.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={styles.wahlKopf}>
            <Text style={styles.groupLabel}>Ausgewählt</Text>
            <Text style={styles.wahlZahl}>
              {gewaehlte.length === 1 ? '1 Gerät' : `${gewaehlte.length} Geräte`}
            </Text>
          </View>
          {gewaehlte.map((entity) => gewaehltesGeraet(entity))}
        </View>
      ) : null}

      {groups.length === 0 && needle ? (
        <Text style={styles.snapshotHint}>Nichts gefunden.</Text>
      ) : null}
      {/* Die Angebotsliste scrollt in sich selbst, wie die Gerätewahl
          der Auslöser: Hundert Geräte am Stück schoben sonst den Rest
          des Editors ausser Sicht - genau das gemeldete Scrollen. */}
      {groups.length > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={styles.wahlKopf}>
            <Text style={styles.groupLabel}>
              {gewaehlte.length > 0 ? 'Weitere hinzufügen' : 'Gerät wählen'}
            </Text>
          </View>
          <ScrollView
            style={styles.pickList}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {groups.map((group) => (
              <View key={group.room}>
                <Text style={styles.raumLabel}>{group.room}</Text>
                {group.items.map((entity) => angebotsZeile(entity))}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  /** Eine Zeile im Angebot: ankreuzen, mehr nicht.
   *
   * Als Funktionsdeklaration nach dem return, damit oben zuerst steht,
   * was die Ansicht zeigt.
   */
  function angebotsZeile(entity: Entity) {
    return (
      <Pressable
        key={entity.id}
        onPress={() => toggle(entity)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: false }}
        accessibilityLabel={`${entity.name}, ${deviceKindLabel(entity)}`}
        style={({ pressed }) => [
          styles.angebotZeile,
          pressed && { backgroundColor: colors.surfaceSoft },
        ]}
      >
        <Ionicons name="ellipse-outline" size={22} color={colors.inkFaint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName}>{entity.name}</Text>
          {/* Wofür das Gerät steht. «Flur» allein sagt nicht, ob das
              Licht oder der Melder gemeint ist. */}
          <Text style={styles.pickKind}>{geraeteUntertitel(entity, entities)}</Text>
        </View>
      </Pressable>
    );
  }

  /** Ein gewähltes Gerät als eigene Karte: Kopf, Strich, seine Fragen.
   *
   * Jede Chip-Reihe darin trägt ihre Frage (`Unterfrage`). Vorher
   * standen bis zu fünf Reihen ohne Überschrift untereinander, und man
   * musste aus den Wörtern erraten, welche Frage sie beantworten.
   */
  function gewaehltesGeraet(entity: Entity) {
    const action = byId.get(entity.id)!;
    const rooms = vacuumRooms(entity);
    const quelle = quelleVon(action);
    const dimmbar =
      action.command === 'set_brightness' ||
      (action.command === 'toggle' && lichtFein && entity.commands.includes('set_brightness'));
    return (
      <View key={entity.id} style={styles.geraetKarte}>
        <View style={styles.geraetKopf}>
          <View style={styles.geraetZeichen}>
            <Ionicons
              name={deviceKindIcon(entity) as keyof typeof Ionicons.glyphMap}
              size={17}
              color={colors.accent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceName}>{entity.name}</Text>
            <Text style={styles.pickKind}>{geraeteUntertitel(entity, entities)}</Text>
          </View>
          {/* Ein eigener Knopf zum Wegnehmen statt der ganzen Zeile:
              Wer ein Gerät eingestellt hat und dann seinen Namen
              antippt, um nachzusehen, verlor vorher alles daran. */}
          <Pressable
            onPress={() => toggle(entity)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${entity.name} wieder entfernen`}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close-circle" size={22} color={colors.inkFaint} />
          </Pressable>
        </View>

        {nurAuswahl ? null : (
          <>
            <View style={styles.geraetStrich} />
            <Unterfrage label="Was soll passieren?">
              <Choice
                options={commandOptions(entity, allowToggle)}
                value={action.command}
                onSelect={(command) => setCommand(entity.id, command)}
              />
            </Unterfrage>

            {action.command === 'clean_rooms' && rooms.length > 0 ? (
              <Unterfrage label="Welche Zimmer?">
                <Choice
                  multi
                  options={rooms.map((room) => ({
                    key: String(room.id),
                    label: room.name,
                  }))}
                  values={(action.rooms ?? []).map(String)}
                  onSelect={(key) => setRooms(entity.id, Number(key))}
                />
              </Unterfrage>
            ) : null}

            {/* Zieltemperatur des Grills. Feste Stufen, weil er ohnehin
                nur bestimmte Sollwerte annimmt und selbst auf den
                nächsten rundet. */}
            {action.command === 'set_temperature' ? (
              <Unterfrage label="Zieltemperatur">
                <Choice
                  options={zieltemperaturen(entity)}
                  value={String(action.temperature ?? zieltemperaturStandard(entity))}
                  onSelect={(key) => setField(entity.id, { temperature: Number(key) })}
                />
              </Unterfrage>
            ) : null}

            {action.command === 'set_volume' ? (
              <Unterfrage label="Wie laut?">
                <Choice
                  options={[
                    { key: '10', label: '10 %' },
                    { key: '20', label: '20 %' },
                    { key: '30', label: '30 %' },
                    { key: '50', label: '50 %' },
                    { key: '70', label: '70 %' },
                  ]}
                  value={String(action.volume ?? 30)}
                  onSelect={(key) => setField(entity.id, { volume: Number(key) })}
                />
              </Unterfrage>
            ) : null}

            {/* Was «Musik an» spielen soll. Bis hierher hing die
                Playlist an einem eigenen Chip daneben – wer die Box in
                die Szene nahm und «Musik an» wählte, sah darunter nichts
                und suchte sie dort, wo sie nicht war. Ohne Wahl bleibt
                es beim Weiterspielen. */}
            {action.command === 'play' && playlistWahl(entity) ? (
              <>
                <Unterfrage label="Playlist">
                  <Choice
                    options={[
                      { key: '', label: 'weiterspielen' },
                      ...playlistsVon(entity).map((name) => ({ key: name, label: name })),
                    ]}
                    value={action.playlist ?? ''}
                    onSelect={(key) => setField(entity.id, { playlist: key })}
                  />
                </Unterfrage>
                {action.playlist ? (
                  <>
                    {/* Auf welcher Box. Ohne Angabe spielt sie dort, wo
                        zuletzt Musik lief – in einer Szene ist das eine
                        Wette. Schlafende Google-Home-Boxen stehen mit
                        dabei; der Hub weckt sie. */}
                    {boxenVon(entity).length > 0 ? (
                      <Unterfrage label="Auf welcher Box">
                        <Choice
                          options={[
                            { key: '', label: 'zuletzt benutzte Box' },
                            ...boxenVon(entity).map((name) => ({ key: name, label: name })),
                          ]}
                          value={action.device ?? ''}
                          onSelect={(key) => setField(entity.id, { device: key })}
                        />
                      </Unterfrage>
                    ) : null}
                    {/* «Party» soll nicht jeden Abend mit demselben
                        Titel anfangen. Ohne Wahl bleibt die Einstellung
                        des Kontos, wie sie ist – eine Szene soll sie
                        nicht heimlich umstellen. */}
                    {mischenMoeglich(entity) ? (
                      <Unterfrage label="Reihenfolge">
                        <Choice
                          options={[
                            { key: '', label: 'Reihenfolge lassen' },
                            { key: 'reihe', label: 'der Reihe nach' },
                            { key: 'zufall', label: 'zufällig' },
                          ]}
                          value={
                            action.shuffle === undefined
                              ? ''
                              : action.shuffle
                                ? 'zufall'
                                : 'reihe'
                          }
                          onSelect={(key) =>
                            setField(entity.id, {
                              shuffle: key === '' ? undefined : key === 'zufall',
                            })
                          }
                        />
                      </Unterfrage>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {/* Radio: erst der Sender, dann die Box. Ohne Box spielt er
                dort, wo zuletzt Radio lief – in einer Szene «Küche
                morgens» ist das eine Wette. */}
            {action.command === 'play_radio' ? (
              <>
                <Unterfrage label="Sender">
                  <Choice
                    options={sendersVon(entity).map((name) => ({ key: name, label: name }))}
                    value={action.station ?? ''}
                    onSelect={(key) => setField(entity.id, { station: key })}
                  />
                </Unterfrage>
                {boxenVon(entity).length > 0 ? (
                  <Unterfrage label="Auf welcher Box">
                    <Choice
                      options={[
                        { key: '', label: 'zuletzt benutzte Box' },
                        ...boxenVon(entity).map((name) => ({ key: name, label: name })),
                      ]}
                      value={action.device ?? ''}
                      onSelect={(key) => setField(entity.id, { device: key })}
                    />
                  </Unterfrage>
                ) : null}
              </>
            ) : null}

            {action.command === 'launch_app' ? (
              <Unterfrage label="Welche App?">
                <Choice
                  options={appsVon(entity).map((eintrag) => ({
                    key: eintrag.app,
                    label: eintrag.name,
                  }))}
                  value={action.app ?? ''}
                  onSelect={(key) => setField(entity.id, { app: key })}
                />
              </Unterfrage>
            ) : null}

            {action.command === 'set_position' ? (
              <Unterfrage label="Wie weit?">
                <Choice
                  options={[
                    { key: '25', label: '25 %' },
                    { key: '50', label: '50 %' },
                    { key: '75', label: '75 %' },
                  ]}
                  value={String(action.position ?? 50)}
                  onSelect={(key) => setPosition(entity.id, Number(key))}
                />
              </Unterfrage>
            ) : null}

            {/* Die Helligkeit: fest unter «ein, gedimmt» - und beim
                Umschalten als Zugabe, sofern die Lampe überhaupt dimmen
                kann. Dort heisst sie «wenn sie angeht, dann so», und
                «Helligkeit lassen» ist die Vorgabe: Ein Taster, der
                jedes Mal auf 50 % zwingt, nimmt einem das Dimmen von
                Hand weg. */}
            {dimmbar ? (
              <>
                <Unterfrage label="Helligkeit">
                  <Choice
                    options={
                      lichtFein
                        ? helligkeitsStufen(action.command === 'toggle')
                        : STUFEN
                    }
                    // Läuft eine Quelle, ist hier *nichts* gewählt -
                    // `undefined` und nicht `''`: Der leere Schlüssel ist
                    // «Helligkeit lassen» und stünde sonst markiert da.
                    value={
                      quelle === 'zahl'
                        ? chipWert(action, action.command === 'toggle' ? '' : '50')
                        : undefined
                    }
                    onSelect={(key) => setField(entity.id, chipWahl(key))}
                  />
                </Unterfrage>
                {/* Die beiden Quellen als eigene Frage. In derselben
                    Reihe wie die Prozentzahlen sahen sie aus wie ein
                    sechster Prozentwert - «nach Tageszeit» stand allein
                    in der zweiten Zeile und gehörte scheinbar nicht
                    dazu. Ein zweiter Druck auf die gewählte Quelle geht
                    zurück auf die feste Zahl. */}
                {lichtFein ? (
                  <Unterfrage label="Oder rechnen lassen">
                    <Choice
                      options={helligkeitsQuellen(hatLux || raumHatLux(entities, entity))}
                      value={quelle === 'zahl' ? undefined : chipWert(action)}
                      onSelect={(key) =>
                        setField(
                          entity.id,
                          chipWahl(
                            key === chipWert(action)
                              ? action.command === 'toggle'
                                ? UNVERAENDERT
                                : '50'
                              : key
                          )
                        )
                      }
                    />
                  </Unterfrage>
                ) : null}
                {/* Woher die Helligkeit kommt, gehört dazugeschrieben:
                    «nach Raumhelligkeit» klingt wie eine Einstellung,
                    ist aber eine Rechnung, und ohne Messwert eine
                    andere als man denkt. */}
                {action.adaptive ? (
                  <Text style={styles.snapshotHint}>
                    Der Hub nimmt beim Auslösen die gemessene Helligkeit
                    {(luxSensors ?? []).length > 0
                      ? ` von ${(luxSensors ?? []).map((m) => m.name).join(', ')}`
                      : ' aus dem Raum der Lampe'}{' '}
                    und rechnet daraus: stockdunkel gedämpft, am trüben Nachmittag
                    voll. Kein Messwert heisst «an ohne Vorgabe» – dunkel bleibt
                    die Lampe nie.
                  </Text>
                ) : null}
                {action.nachTageszeit ? (
                  <Text style={styles.snapshotHint}>
                    Der Hub nimmt die Uhrzeit: nachts gedämpft, tagsüber voll,
                    morgens und abends dazwischen. Braucht keinen
                    Helligkeitsfühler – dafür ist ein Gewitternachmittag für sie
                    so hell wie ein Julitag.
                  </Text>
                ) : null}
                {sceneTransition > 0 ? (
                  // Beim Lichtwecker kommt die Decke über zwanzig
                  // Minuten – die Nachttischlampe soll trotzdem sofort
                  // an.
                  <Unterfrage label="Übergang">
                    <Choice
                      options={[
                        { key: 'szene', label: 'mit Übergang' },
                        { key: 'sofort', label: 'sofort' },
                      ]}
                      value={action.transition === 0 ? 'sofort' : 'szene'}
                      onSelect={(key) =>
                        setField(entity.id, {
                          transition: key === 'sofort' ? 0 : undefined,
                        })
                      }
                    />
                  </Unterfrage>
                ) : null}
              </>
            ) : null}

            {/* Farbe und Weissanteil, wenn die Lampe es kann und wir in
                einem Ablauf sind: «wenn sich die Lampe einschaltet, dann
                bitte so». */}
            {lichtFein &&
            istAnschalten(action.command) &&
            entity.commands.includes('set_color') ? (
              <Unterfrage label="Lichtfarbe">
                <View style={styles.farbReihe}>
                  <Pressable
                    onPress={() => setField(entity.id, { color: undefined })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: !action.color }}
                    accessibilityLabel="Farbe unverändert lassen"
                    style={[
                      styles.farbPunkt,
                      styles.farbLeer,
                      !action.color && { borderColor: colors.ink, borderWidth: 2 },
                    ]}
                  >
                    <Ionicons name="close" size={13} color={colors.inkFaint} />
                  </Pressable>
                  {PALETTE.map((farbe) => (
                    <Pressable
                      key={farbe.hex}
                      onPress={() =>
                        setField(entity.id, {
                          color: farbe.hex,
                          // Farbe und Weissanteil schliessen sich aus:
                          // Die Lampe leuchtet in einem von beidem.
                          colorTemp: undefined,
                        })
                      }
                      accessibilityRole="radio"
                      accessibilityState={{ selected: action.color === farbe.hex }}
                      accessibilityLabel={farbe.name}
                      style={[
                        styles.farbPunkt,
                        { backgroundColor: farbe.hex },
                        action.color === farbe.hex && {
                          borderColor: colors.ink,
                          borderWidth: 2,
                        },
                      ]}
                    />
                  ))}
                </View>
              </Unterfrage>
            ) : null}

            {lichtFein &&
            istAnschalten(action.command) &&
            entity.commands.includes('set_color_temp') ? (
              <Unterfrage label="Weisston">
                <Choice
                  options={[
                    { key: '', label: 'Weiss unverändert' },
                    ...WEISSTOENE.map((ton) => ({
                      key: String(ton.mirek),
                      label: ton.label,
                    })),
                  ]}
                  value={action.color ? '' : String(action.colorTemp ?? '')}
                  onSelect={(key) =>
                    setField(entity.id, {
                      colorTemp: key ? Number(key) : undefined,
                      color: key ? undefined : action.color,
                    })
                  }
                />
              </Unterfrage>
            ) : null}

            {/* Und wie lange sie an bleibt. Vorher brauchte das drei
                Schritte – an, warten, aus –, und der Warte-Schritt hielt
                den ganzen Ablauf auf. */}
            {lichtFein && istAnschalten(action.command) ? (
              <Unterfrage
                label="Wie lange an?"
                // Was die Zahl wirklich heisst (Punkt 547). Sie sah aus
                // wie ein harter Zeitgeber, und genau so wurde sie
                // gelesen: «schaltet nach dieser Zeit aus, auch wenn in
                // der Zwischenzeit wieder eine Bewegung erkannt wurde».
                // Sie zählt ab der letzten Bewegung - das steht jetzt da,
                // statt dass man es am dunklen Flur merkt.
                hinweis="Zählt ab der letzten Bewegung: Löst ein Bewegungsmelder diesen Ablauf aus und meldet er weiter Bewegung, bleibt es an."
              >
                <NachlaufWahl
                  value={action.offAfter ? String(action.offAfter) : ''}
                  onChange={(seconds) =>
                    setField(entity.id, {
                      offAfter: seconds ? Number(seconds) : undefined,
                    })
                  }
                />
              </Unterfrage>
            ) : null}
          </>
        )}
      </View>
    );
  }
}

export interface SzenenAusloeser {
  id: string;
  alias: string;
  enabled: boolean;
}

export function SceneEditor({
  draft,
  entities,
  categories,
  onChange,
  onSave,
  onDelete,
  onCancel,
  onTest,
  onRevert,
  onVersions,
  onRestoreVersion,
  ausloeser = [],
  onAusloeser,
}: {
  draft: SceneDraft | null;
  entities: Entity[];
  /** Schon vergebene Kategorien – als Vorschläge im Feld. */
  categories: string[];
  onChange: (draft: SceneDraft) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** Nur bei gespeicherten Szenen: einmal auslösen, Rückweg merken. */
  onTest?: () => Promise<RueckwegBefehl[]>;
  onRevert?: (befehle: RueckwegBefehl[]) => void;
  /** Abläufe, die diese Szene auslösen - fürs Anzeigen und Anspringen. */
  ausloeser?: SzenenAusloeser[];
  /** Einen Auslöser öffnen (id) oder neu anlegen (null). Fehlt der
   *  Griff, bleibt der Abschnitt weg. */
  onAusloeser?: (automationId: string | null) => void;
  /** Frühere Fassungen laden bzw. eine zurückholen (nur beim Bearbeiten). */
  onVersions?: () => Promise<Fassung[]>;
  onRestoreVersion?: (at: number) => Promise<boolean>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Der gemerkte Rückweg nach «Ausprobieren» – solange er da ist, steht
  // daneben «Doch nicht».
  const [rueckweg, setRueckweg] = useState<RueckwegBefehl[] | null>(null);
  if (!draft) return null;

  const set = (patch: Partial<SceneDraft>) => onChange({ ...draft, ...patch });
  // Räume aus den Geräten – für die Zuordnung der Szene zu einer Kategorie.
  const sceneRooms = Array.from(
    new Set(entities.map((entity) => entity.room).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));

  return (
    <EditorRahmen
      titel={draft.id ? 'Szene bearbeiten' : 'Neue Szene'}
      onCancel={onCancel}
      onSave={onSave}
    >
        <Field label="Name">
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => set({ name })}
            placeholder="z.B. Feierabend"
            placeholderTextColor={colors.inkFaint}
          />
        </Field>

        <CategoryField
          value={draft.category ?? ''}
          known={categories}
          onChange={(category) => set({ category })}
        />

        <Field label="Symbol">
          <View style={styles.choices}>
            {SCENE_ICONS.map((icon) => (
              <Pressable
                key={icon}
                onPress={() => set({ icon })}
                accessibilityRole="radio"
                accessibilityLabel={`Symbol ${icon}`}
                accessibilityState={{ selected: draft.icon === icon }}
                style={[styles.choice, draft.icon === icon && styles.choiceActive]}
              >
                <Ionicons
                  name={icon as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color={draft.icon === icon ? colors.surfaceStrong : colors.inkSoft}
                />
              </Pressable>
            ))}
          </View>
        </Field>

        {sceneRooms.length > 0 ? (
          <Field label="Raum (für die Kategorie „Szenen“)">
            <Choice
              options={[
                { key: '', label: 'Kein Raum' },
                ...sceneRooms.map((name) => ({ key: name, label: name })),
              ]}
              value={draft.room ?? ''}
              onSelect={(room) => set({ room: room || undefined })}
            />
          </Field>
        ) : null}

        <Field label="Startseite">
          <Choice
            options={[
              { key: 'yes', label: 'Als Schnellaktion anzeigen' },
              { key: 'no', label: 'Nicht anzeigen' },
            ]}
            value={draft.onStart ? 'yes' : 'no'}
            onSelect={(value) => set({ onStart: value === 'yes' })}
          />
        </Field>

        {/* Nicht jede Szene ist ein Zustand. «Kino» ist einer - man
            will sehen, dass er gilt, und ihn zurücknehmen können.
            «Alles aus» ist eine Handlung: Man löst sie aus und geht. */}
        <Field label="Nach dem Auslösen">
          <Choice
            options={[
              { key: 'aktiv', label: 'Bleibt aktiv' },
              { key: 'einmal', label: 'Löst nur aus' },
            ]}
            value={draft.toggles === false ? 'einmal' : 'aktiv'}
            onSelect={(value) => set({ toggles: value === 'aktiv' })}
          />
          <Text style={styles.triggerNote}>
            {draft.toggles === false
              ? 'Der Knopf leuchtet nie, jeder Druck löst die Szene aus. Richtig für «Alles aus» oder «Gute Nacht».'
              : 'Der Knopf leuchtet, solange der Raum so steht. Ein zweiter Druck stellt her, wie es vorher war – aber nur bei Geräten, die die Szene wirklich verändert hat. Ein Fernseher, der schon aus war, bleibt aus.'}
          </Text>
        </Field>

        {/* Wann die Szene von selbst losgeht. Der Auslöser ist in
            Wahrheit ein gewöhnlicher Ablauf mit dem Schritt «Szene» -
            hier steht nur die Abkürzung dorthin. Bewusst kein zweiter
            Auslöser-Editor: Es gibt schon einen, und zwei wachsen
            auseinander. */}
        {onAusloeser ? (
          <Field label="Auslöser">
            {ausloeser.map((eintrag) => (
              <Pressable
                key={eintrag.id}
                onPress={() => onAusloeser(eintrag.id)}
                accessibilityRole="button"
                accessibilityLabel={`Auslöser «${eintrag.alias}» bearbeiten`}
                style={({ pressed }) => [styles.ausloeserZeile, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="flash-outline" size={16} color={colors.inkSoft} />
                <Text style={styles.ausloeserText} numberOfLines={1}>
                  {eintrag.alias}
                </Text>
                {!eintrag.enabled ? (
                  <Text style={styles.ausloeserAus}>pausiert</Text>
                ) : null}
                <Ionicons name="chevron-forward" size={14} color={colors.inkFaint} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => onAusloeser(null)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.ausloeserNeu, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="add" size={16} color={colors.accent} />
              <Text style={styles.ausloeserNeuText}>Auslöser hinzufügen</Text>
            </Pressable>
            <Text style={styles.triggerNote}>
              Ein Auslöser ist ein gewöhnlicher Ablauf, der diese Szene
              startet - Zeit, Bewegung, Heimkommen, was die Abläufe eben
              können. Er erscheint auch unter «Abläufe».
            </Text>
          </Field>
        ) : draft.id === undefined ? null : null}

        {/* Nur bei Szenen mit Zustand: Eine Handlung hat keinen
            Rückweg, also auch nichts, was sich von selbst zurücknehmen
            könnte. Der Fall dahinter: der Sternenhimmel im
            Kinderzimmer, den beim Einschlafen niemand mehr ausdrückt. */}
        {draft.toggles !== false ? (
          <Field label="Schaltet von selbst zurück">
            <Choice
              options={[
                { key: '0', label: 'Nie' },
                { key: '900', label: '15 Min' },
                { key: '1800', label: '30 Min' },
                { key: '3600', label: '1 Std' },
                { key: '7200', label: '2 Std' },
              ]}
              value={String(draft.autoOff ?? 0)}
              onSelect={(value) => set({ autoOff: Number(value) })}
            />
            <Text style={styles.triggerNote}>
              Nach dieser Zeit schaltet alles aus, was die Szene verändert
              hat – der Sternenhimmel ist dann dunkel, auch wenn das Licht
              vorher an war. Wer früher von Hand schaltet, ist schneller;
              die Uhr tut dann nichts.
            </Text>
          </Field>
        ) : null}

        <Field label="Übergang">
          <Choice
            options={[
              { key: '0', label: 'Sofort' },
              { key: '300', label: '5 Min' },
              { key: '900', label: '15 Min' },
              { key: '1800', label: '30 Min' },
            ]}
            value={String(draft.transition ?? 0)}
            onSelect={(value) => set({ transition: Number(value) })}
          />
          <Text style={styles.triggerNote}>
            Über diese Zeit werden Helligkeiten sanft angefahren statt
            geschaltet – als Lichtwecker oder Einschlaflicht. An und Aus,
            Storen und alles andere bleiben sofort.
          </Text>
        </Field>

        <Field label="Diese Geräte schalten">
          <SceneDevices
            entities={entities}
            actions={draft.actions}
            onActions={(actions) => set({ actions })}
            sceneTransition={draft.transition ?? 0}
          />
        </Field>

        <Pressable style={styles.save} onPress={onSave} accessibilityRole="button">
          <Text style={styles.saveText}>Speichern</Text>
        </Pressable>
        {onTest ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={async () => setRueckweg(await onTest())}
            accessibilityRole="button"
          >
            <Ionicons name="flash-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Ausprobieren</Text>
          </Pressable>
        ) : null}
        {rueckweg && rueckweg.length > 0 && onRevert ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={() => {
              onRevert(rueckweg);
              setRueckweg(null);
            }}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-undo-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>
              Doch nicht – Zustand von vorher wiederherstellen
            </Text>
          </Pressable>
        ) : null}
        {onTest ? (
          <Text style={styles.snapshotHint}>
            «Ausprobieren» löst die gespeicherte Szene wirklich aus.
            Gespeicherte Änderungen zuerst sichern – und der Rückweg stellt
            Lichter, Schalter und Storen wieder her, Schlösser nur zu.
          </Text>
        ) : null}
        {onVersions && onRestoreVersion ? (
          <VersionsSection load={onVersions} restore={onRestoreVersion} />
        ) : null}
        {onDelete ? (
          <Pressable style={styles.delete} onPress={onDelete} accessibilityRole="button">
            <Text style={styles.deleteText}>Szene löschen</Text>
          </Pressable>
        ) : null}
    </EditorRahmen>
  );
}

