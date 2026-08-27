import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Entity, Scene } from '../api/types';
import { Card } from './Card';
import { WidgetSetting } from './WidgetSetting';
import { Ablage } from '../lib/widget';
import {
  MAX_BUTTONS,
  STANDARD,
  addableButtons,
  darfDirekt,
  moveButton,
  resolveButtons,
} from '../lib/widgetButtons';
import {
  MAX_KARTEN,
  WidgetKarte,
  addableKarten,
  karteArt,
  kartenSatz,
  resolveKarten,
} from '../lib/widgetKarten';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Einstellungen → Widgets.
 *
 * Drei Dinge, die vorher an drei Orten lagen oder gar nicht gingen: Was
 * auf den Knöpfen steht, welche eigenen Karten es gibt, und ob das
 * Widget den Hausstand zeigen darf.
 *
 * Die **Karten** sind das, was man landläufig ein Widget nennt: eine
 * Kachel für ein Gerät oder eine Szene, mit Zustand und einem Knopf.
 * Hier stellt man sie zusammen; welche davon ein bestimmtes Widget auf
 * dem Homescreen zeigt, wählt man dort beim Anlegen aus.
 *
 * Was hier bewusst fehlt, ist ein Knopf «Widget hinzufügen». Nicht aus
 * Nachlässigkeit: iOS lässt keine App ein Widget auf den Homescreen
 * legen, das ist Sache der Person und ihres langen Drucks auf den
 * Bildschirm. Statt einen Knopf hinzustellen, der nichts kann, steht
 * hier, wie es geht.
 */
export function Widgets({
  buttons,
  onButtons,
  direct = [],
  onDirect,
  karten,
  onKarten,
  dataEnabled,
  onDataEnabled,
  ablage,
  scenes,
  entities,
}: {
  buttons?: string[];
  onButtons: (keys: string[]) => void;
  /** Die eigenen Karten – dieselbe Schlüsselsprache wie die Knöpfe. */
  karten?: string[];
  onKarten?: (keys: string[]) => void;
  /** Schlüssel der Knöpfe, die direkt schalten (iOS 17) statt die App zu
   *  öffnen. Nur Szenen und Lichter – Tür und Alarm behalten den Umweg. */
  direct?: string[];
  onDirect?: (keys: string[]) => void;
  dataEnabled: boolean;
  onDataEnabled: (on: boolean) => void;
  ablage: Ablage;
  scenes: Scene[];
  entities: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [kartenAuf, setKartenAuf] = useState(false);
  const [kartenSuche, setKartenSuche] = useState('');

  const keys = buttons ?? STANDARD;
  const gewaehlt = useMemo(
    () => resolveButtons(keys, scenes, entities),
    [keys, scenes, entities]
  );
  // Nicht aus `keys`, sondern aus dem Aufgelösten: Was es nicht mehr
  // gibt, soll auch nicht als «schon drin» gelten.
  const drin = gewaehlt.map((knopf) => knopf.key);
  const angebot = useMemo(
    () => addableButtons(drin, scenes, entities),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drin.join(' '), scenes, entities]
  );
  const gefiltert = query.trim()
    ? angebot.filter((knopf) =>
        knopf.title.toLowerCase().includes(query.trim().toLowerCase())
      )
    : angebot;

  const setzen = (next: string[]) => onButtons(next.slice(0, MAX_BUTTONS));

  // Die eigenen Karten. `dataEnabled` steht hier nur, damit die Liste
  // dieselben Karten zeigt wie das Widget - geschaltet wird in der
  // Vorschau nichts.
  const kartenListe = useMemo(
    () => resolveKarten(karten, scenes, entities, !!dataEnabled),
    [karten, scenes, entities, dataEnabled]
  );
  const kartenDrin = kartenListe.map((karte) => karte.key);
  const kartenAngebot = useMemo(
    () => addableKarten(kartenDrin, scenes, entities),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kartenDrin.join(' '), scenes, entities]
  );
  const kartenGefiltert = kartenSuche.trim()
    ? kartenAngebot.filter((karte) =>
        karte.title.toLowerCase().includes(kartenSuche.trim().toLowerCase())
      )
    : kartenAngebot;
  const kartenSetzen = (next: string[]) =>
    onKarten?.(next.slice(0, MAX_KARTEN));

  const verschieben = (index: number, richtung: -1 | 1) =>
    setzen(moveButton(drin, index, richtung));

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.heading}>Knöpfe im Widget</Text>
        <Text style={styles.hint}>
          Bis zu {MAX_BUTTONS} Stück. Ein Tipp darauf schaltet nichts direkt,
          sondern öffnet die App an der richtigen Stelle – bei der Haustüre
          steht die Rückfrage schon da.
        </Text>

        {gewaehlt.length === 0 ? (
          <Text style={styles.hint}>
            Zurzeit keine – das Widget zeigt dann Haustüre, Alles aus und
            Alarm.
          </Text>
        ) : (
          gewaehlt.map((knopf, index) => (
            <View key={knopf.key} style={styles.row}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{index + 1}</Text>
              </View>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {knopf.title}
              </Text>
              <Pressable
                onPress={() => verschieben(index, -1)}
                disabled={index === 0}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Nach oben"
              >
                <Ionicons
                  name="chevron-up"
                  size={20}
                  color={index === 0 ? colors.inkFaint : colors.ink}
                />
              </Pressable>
              <Pressable
                onPress={() => verschieben(index, 1)}
                disabled={index === gewaehlt.length - 1}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Nach unten"
              >
                <Ionicons
                  name="chevron-down"
                  size={20}
                  color={
                    index === gewaehlt.length - 1 ? colors.inkFaint : colors.ink
                  }
                />
              </Pressable>
              {onDirect && darfDirekt(knopf.key, entities) ? (
                // Seit iOS 17 kann der Knopf selbst schalten. Je Knopf
                // entschieden: Für ein Licht ist der Umweg über die App
                // keine Sicherheit mehr, nur Reibung – für Tür und Alarm
                // gibt es den Schalter gar nicht erst.
                <Pressable
                  onPress={() =>
                    onDirect(
                      direct.includes(knopf.key)
                        ? direct.filter((key) => key !== knopf.key)
                        : [...direct, knopf.key]
                    )
                  }
                  disabled={!dataEnabled}
                  hitSlop={8}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: direct.includes(knopf.key) }}
                  accessibilityLabel={`${knopf.title} direkt schalten`}
                >
                  {/* Auch ohne Hausstand sichtbar, nur blass. Vorher
                      verschwand der Blitz dort ganz - und damit der
                      einzige Hinweis darauf, dass es das überhaupt gibt. */}
                  <Ionicons
                    name={direct.includes(knopf.key) && dataEnabled ? 'flash' : 'flash-outline'}
                    size={18}
                    color={
                      !dataEnabled
                        ? colors.inkFaint
                        : direct.includes(knopf.key)
                          ? colors.warn
                          : colors.inkFaint
                    }
                  />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setzen(drin.filter((key) => key !== knopf.key))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${knopf.title} entfernen`}
              >
                <Ionicons name="close-circle" size={20} color={colors.inkFaint} />
              </Pressable>
            </View>
          ))
        )}

        {onDirect && gewaehlt.some((k) => darfDirekt(k.key, entities)) ? (
          <Text style={styles.hint}>
            {dataEnabled
              ? '⚡ heisst: Der Knopf schaltet direkt vom Widget aus (ab iOS 17), ohne die App zu öffnen. Tür und Alarm behalten den Umweg immer.'
              : 'Direkt schalten geht erst mit «Hausstand im Widget» weiter unten: Der Knopf braucht dafür die Zugangsdaten im Widget selbst. Ohne das öffnet jeder Tipp nur die App an der richtigen Stelle – das ist der Grund, wenn ein Widget nichts zu schalten scheint.'}
          </Text>
        ) : null}
        {gewaehlt.length >= MAX_BUTTONS ? (
          <Text style={styles.hint}>
            Voll – erst einen entfernen, dann kommt ein anderer hinein.
          </Text>
        ) : (
          <Pressable
            onPress={() => {
              setAdding((offen) => !offen);
              setQuery('');
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.8 }]}
          >
            <Ionicons
              name={adding ? 'chevron-up' : 'add'}
              size={16}
              color={colors.ink}
            />
            <Text style={styles.addText}>
              {adding ? 'Schliessen' : 'Knopf hinzufügen'}
            </Text>
          </Pressable>
        )}

        {adding && gewaehlt.length < MAX_BUTTONS ? (
          <>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Szene oder Gerät suchen …"
              placeholderTextColor={colors.inkFaint}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {/* Begrenzte Höhe: Die Geräteliste kann lang sein, und eine
                Auswahl, die die halbe Seite schiebt, verliert man aus den
                Augen. */}
            <ScrollView style={styles.picker} keyboardShouldPersistTaps="handled">
              {gefiltert.length === 0 ? (
                <Text style={styles.hint}>Nichts gefunden.</Text>
              ) : (
                gefiltert.map((knopf) => (
                  <Pressable
                    key={knopf.key}
                    onPress={() => {
                      setzen([...drin, knopf.key]);
                      setAdding(false);
                      setQuery('');
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.pickRow,
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color={colors.accent}
                    />
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {knopf.title}
                    </Text>
                    <Text style={styles.pickKind}>{artOf(knopf.key)}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </>
        ) : null}
      </Card>

      {/* Die eigenen Karten. Erst nach den Knöpfen, weil die Knopfleiste
          das ist, was jeder schon hat - die Karten kommen dazu. */}
      {onKarten ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Eigene Widgets</Text>
          <Text style={styles.hint}>{kartenSatz(kartenListe.length)}</Text>

          {kartenListe.map((karte, index) => (
            <View key={karte.key} style={styles.row}>
              <Ionicons
                name={karte.kind === 'scene' ? 'sparkles-outline' : 'cube-outline'}
                size={18}
                color={colors.inkSoft}
              />
              <Text style={styles.rowTitle} numberOfLines={1}>
                {karte.title}
              </Text>
              <Text style={styles.pickKind}>{karteArt(karte)}</Text>
              <Pressable
                onPress={() => kartenSetzen(moveButton(kartenDrin, index, -1))}
                disabled={index === 0}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Nach oben"
              >
                <Ionicons
                  name="chevron-up"
                  size={20}
                  color={index === 0 ? colors.inkFaint : colors.ink}
                />
              </Pressable>
              <Pressable
                onPress={() => kartenSetzen(moveButton(kartenDrin, index, 1))}
                disabled={index === kartenListe.length - 1}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Nach unten"
              >
                <Ionicons
                  name="chevron-down"
                  size={20}
                  color={
                    index === kartenListe.length - 1 ? colors.inkFaint : colors.ink
                  }
                />
              </Pressable>
              <Pressable
                onPress={() =>
                  kartenSetzen(kartenDrin.filter((key) => key !== karte.key))
                }
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${karte.title} entfernen`}
              >
                <Ionicons name="close-circle" size={20} color={colors.inkFaint} />
              </Pressable>
            </View>
          ))}

          {!dataEnabled && kartenListe.length > 0 ? (
            <Text style={styles.hint}>
              Ohne «Hausstand im Widget» weiter unten zeigt eine Karte nur
              den Namen: Zustand und Schaltknopf brauchen die Zugangsdaten
              im Widget selbst.
            </Text>
          ) : null}

          {kartenListe.length >= MAX_KARTEN ? (
            <Text style={styles.hint}>
              Voll – erst eine entfernen, dann kommt eine andere hinein.
            </Text>
          ) : (
            <Pressable
              onPress={() => {
                setKartenAuf((offen) => !offen);
                setKartenSuche('');
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={kartenAuf ? 'chevron-up' : 'add'}
                size={16}
                color={colors.ink}
              />
              <Text style={styles.addText}>
                {kartenAuf ? 'Schliessen' : 'Widget hinzufügen'}
              </Text>
            </Pressable>
          )}

          {kartenAuf && kartenListe.length < MAX_KARTEN ? (
            <>
              <TextInput
                style={styles.search}
                value={kartenSuche}
                onChangeText={setKartenSuche}
                placeholder="Gerät oder Szene suchen …"
                placeholderTextColor={colors.inkFaint}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <ScrollView style={styles.picker} keyboardShouldPersistTaps="handled">
                {kartenGefiltert.length === 0 ? (
                  <Text style={styles.hint}>Nichts gefunden.</Text>
                ) : (
                  kartenGefiltert.map((karte: WidgetKarte) => (
                    <Pressable
                      key={karte.key}
                      onPress={() => {
                        kartenSetzen([...kartenDrin, karte.key]);
                        setKartenAuf(false);
                        setKartenSuche('');
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.pickRow,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={18}
                        color={colors.accent}
                      />
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {karte.title}
                      </Text>
                      <Text style={styles.pickKind}>{karteArt(karte)}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          ) : null}
        </Card>
      ) : null}

      <WidgetSetting enabled={dataEnabled} onChange={onDataEnabled} />

      <Card style={styles.card}>
        <Text style={styles.heading}>So kommt es auf den Bildschirm</Text>
        {Platform.OS === 'ios' ? (
          <>
            <Text style={styles.hint}>
              Auf dem Homescreen lange drücken, bis die Symbole wackeln, dann
              oben links auf «+», «HomePilot» suchen, Grösse wählen und
              hinzufügen.
            </Text>
            <Text style={styles.hint}>
              «HomePilot» ist die Knopfleiste, «HomePilot Karte» eines der
              eigenen Widgets von oben. Welche Karte es zeigt, wählt man
              danach: Widget lange drücken → «Widget bearbeiten». So liegen
              mehrere davon nebeneinander, jedes mit seinem eigenen Gerät.
            </Text>
            <Text style={styles.hint}>
              Für den Sperrbildschirm: Sperrbildschirm lange drücken →
              «Anpassen» → Bereich unter der Uhr antippen → «HomePilot».
            </Text>
            <Text style={styles.hint}>
              Den Knopf dafür kann keine App anbieten – iOS behält das
              Hinzufügen bei sich. Änderungen hier sind dagegen sofort da,
              ohne das Widget neu anzulegen.
            </Text>
            {ablage === 'fehlt' ? (
              // Der Fall, der sonst als «nicht erreichbar» im Widget
              // endet und wie eine Netzstörung aussieht: Die App-Gruppe
              // ist im Apple-Portal nicht eingerichtet. iOS schluckt
              // jedes Schreiben stillschweigend, die App merkt es nur,
              // weil sie zurückliest.
              <View style={styles.warn}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
                <Text style={styles.warnText}>
                  Die geteilte Ablage antwortet nicht – das Widget bleibt
                  bei den Standardknöpfen und zeigt keinen Hausstand. Meist
                  fehlt die App-Gruppe im Apple-Entwickler-Portal; sie muss
                  dort angelegt und beiden Kennungen zugewiesen sein.
                  Danach braucht es einen neuen Build.
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.hint}>
            Ein Widget gibt es zurzeit nur auf iPhone und iPad. Die
            Einstellungen hier gelten, sobald die App dort geöffnet wird –
            sie liegen im Haus, nicht im Gerät.
          </Text>
        )}
      </Card>
    </>
  );
}

/** Woher der Knopf kommt – damit «Küche» als Szene und «Küche» als Licht
 *  in der Auswahl auseinanderzuhalten sind. */
function artOf(key: string): string {
  if (key.startsWith('scene:')) return 'Szene';
  if (key.startsWith('entity:')) return 'Gerät';
  return 'Abkürzung';
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    badgeText: { color: colors.inkSoft, fontSize: 11, fontWeight: '700' },
    rowTitle: { color: colors.ink, fontSize: 14, flex: 1 },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    addText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    search: {
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    picker: { maxHeight: 220 },
    warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    warnText: {
      color: colors.inkSoft,
      fontSize: 12,
      lineHeight: 18,
      flex: 1,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
    },
    pickKind: { color: colors.inkFaint, fontSize: 11 },
  });
