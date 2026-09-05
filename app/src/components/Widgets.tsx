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
import { Colors, radius, type, useColors } from '../theme';

/**
 * Einstellungen → Widgets.
 *
 * Eine Liste, ein Ort: Was im Widget steht, sind die Knöpfe - Szenen,
 * Geräte und die drei Abkürzungen, bis zu acht Stück. Daneben nur noch
 * der Schalter, ob das Widget den Hausstand zeigen darf.
 *
 * Die «eigenen Widgets» als zweite Liste gab es einmal: eine eigene
 * Widget-Art je Karte, die man auf dem Homescreen einzeln anlegen und
 * einrichten musste. Niemand fand sie - und wer seine Szenen im Widget
 * wollte, wollte sie schlicht bei den Knöpfen. Genau das gilt jetzt.
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
  tuerOhneRueckfrage = false,
  dataEnabled,
  onDataEnabled,
  ablage,
  scenes,
  entities,
}: {
  buttons?: string[];
  onButtons: (keys: string[]) => void;
  /** Schlüssel der Knöpfe, die direkt schalten (iOS 17) statt die App zu
   *  öffnen. Szenen und Lichter immer, Schlösser nur ohne Tür-Rückfrage
   *  – «Alles aus» und der Alarm behalten den Umweg. */
  direct?: string[];
  onDirect?: (keys: string[]) => void;
  /** Ist die Tür-Rückfrage ausdrücklich abgestellt? Dann dürfen auch
   *  die Schlösser direkt schalten – dieselbe Abwägung wie in der App. */
  tuerOhneRueckfrage?: boolean;
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

  const verschieben = (index: number, richtung: -1 | 1) =>
    setzen(moveButton(drin, index, richtung));

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.heading}>Knöpfe im Widget</Text>
        <Text style={styles.hint}>
          Bis zu {MAX_BUTTONS} Stück. Ein Knopf mit ⚡ schaltet direkt vom
          Widget aus (ab iOS 17), alle anderen öffnen die App an der
          richtigen Stelle.
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
              {onDirect && darfDirekt(knopf.key, entities, tuerOhneRueckfrage) ? (
                // Seit iOS 17 kann der Knopf selbst schalten. Je Knopf
                // entschieden: Für ein Licht ist der Umweg über die App
                // keine Sicherheit mehr, nur Reibung. Schlösser bekommen
                // den Schalter erst, wenn die Tür-Rückfrage aus ist –
                // «Alles aus» und der Alarm gar nie.
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

        {onDirect && gewaehlt.some((k) => darfDirekt(k.key, entities, tuerOhneRueckfrage)) ? (
          <Text style={styles.hint}>
            {dataEnabled
              ? '⚡ heisst: Der Knopf schaltet direkt vom Widget aus (ab iOS 17), ohne die App zu öffnen. «Alles aus» und der Alarm behalten den Umweg immer.'
              : 'Direkt schalten geht erst mit «Hausstand im Widget» weiter unten: Der Knopf braucht dafür die Zugangsdaten im Widget selbst. Ohne das öffnet jeder Tipp nur die App an der richtigen Stelle – das ist der Grund, wenn ein Widget nichts zu schalten scheint.'}
          </Text>
        ) : null}
        {onDirect &&
        gewaehlt.some(
          (k) =>
            !darfDirekt(k.key, entities, tuerOhneRueckfrage) &&
            darfDirekt(k.key, entities, true)
        ) ? (
          // Der gemeldete Fall: zwei Schlösser auf dem Widget, jeder Tipp
          // öffnete nur die App - und nirgends stand, woran es liegt.
          <Text style={styles.hint}>
            Die Schlösser öffnen erst direkt vom Widget aus, wenn die
            Tür-Rückfrage abgestellt ist (Einstellungen → Konto) – dieselbe
            Regel wie in der App.
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
              Das Widget zeigt genau die Knöpfe von oben – die kleine
              Grösse die ersten vier, mittel und gross bis zu acht in
              zwei Reihen.
            </Text>
            <Text style={styles.hint}>
              Die Vorschau in der Widget-Galerie zeigt immer nur
              Beispielknöpfe – die eigene Auswahl erscheint erst, wenn das
              Widget auf dem Bildschirm liegt.
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
            {/* Der Stand der geteilten Ablage steht immer da - nicht nur
                im Fehlerfall. «Das Widget zeigt meine Knöpfe nicht» hat
                zwei stumme Ursachen mit zwei verschiedenen Abhilfen, und
                wer hier nachsieht, soll lesen, welche gilt - statt zu
                raten, ob überhaupt etwas ankommt. */}
            {ablage === 'ok' ? (
              <View style={styles.warn}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.on} />
                <Text style={styles.warnText}>
                  Die geteilte Ablage antwortet – Knöpfe und Hausstand
                  liegen für das Widget bereit. Zeigt es trotzdem die
                  Standardknöpfe, hilft meist: Widget vom Bildschirm
                  entfernen und neu hinzufügen.
                </Text>
              </View>
            ) : null}
            {ablage === 'huelle-alt' ? (
              // Der zweite stumme Fall: Das native Ablage-Modul steckt
              // nicht in der installierten Hülle. Ein OTA-Update kann es
              // nicht nachliefern - der Hinweis muss das sagen, sonst
              // wartet man auf ein Update, das nie hilft.
              <View style={styles.warn}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
                <Text style={styles.warnText}>
                  Die installierte App kennt die Widget-Ablage noch nicht –
                  Knöpfe und Hausstand erreichen das Widget deshalb nicht,
                  es bleibt bei den Standardknöpfen. Das kann kein
                  nachgeladenes Update beheben. Steht das hier auch nach
                  der Installation des neusten TestFlight-Builds noch, ist
                  dieser Build selbst zu alt: Erst ein Update mit
                  «Hub + App-Builds» erzeugt einen neuen – der taucht nach
                  dem Bauen in TestFlight auf und gehört dann installiert.
                </Text>
              </View>
            ) : null}
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
                  dort angelegt und beiden Kennungen zugewiesen sein
                  (Anleitung in docs/eigener-app-build.md). Danach braucht
                  es einen neuen Build.
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
