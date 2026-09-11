/**
 * Der Ablauf-Editor: Auslöser, Bedingungen, Schritte, frühere Fassungen.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Entity, Scene } from '../../api/types';
import { Colors, useColors } from '../../theme';
import { ablaufSatz, nameVon } from '../../lib/ablaufsatz';
import {
  SimulationsBericht,
  nichtSimulierbarZeile,
  obergrenzeSatz,
  summenSatz,
  tagZeile,
  ungeprueftZeile,
} from '../../lib/ablaufsimulation';
import { datumUhr } from '../../lib/format';
import {
  MAX_SCHACHTELUNG,
  REPEAT_LIMIT,
  WARNSTUFEN_WAHL,
  begrenzteAnzahl,
} from '../../lib/kontrollfluss';
import { ZUHAUSE, anwesenheitsPersonen, istOrtsmelder, ortsauswahl } from '../../lib/ortsausloeser';
import { Compare, ConditionKind, Draft, DryRun, EMPTY_STEP, STEP_KIND_ICON, StateCondition, StepDraft, StepKind, TRIGGER_KIND_ICON, TriggerDraft, TriggerKind, WEEKDAY_LABELS, buildConditions, conditionOptions, delayLabel, fittingState, fittingTrigger, geraetePlatzhalter, KAMERA_AUSLOESER, kopieSchritt, PLATZHALTER, hatWartezeit, schaltetSpaeterAus, measurableAttributes, meldetEtwas, melderMitLux, newTrigger, normalisiereZeit, optionKey, stateOptions, stepsToActions, triggerToConfig, unbekannterZustand, namensVorschlag, angabenStand, bedingungStand, sonstStand, wasFehlt, weekdayLabel, zeitfensterHinweis, stundeAusText } from './entwurf';
import {
  Abschnitt,
  CategoryField,
  Choice,
  EditorRahmen,
  Kachelauswahl,
  Klappe,
  EntityPicker,
  Field,
  MinutenWahl,
  NumberField,
  Picker,
} from './felder';
import { makeStyles } from './stil';
import { tiefen } from '../../lib/ablaufhilfen';
import { mitschalter, mitschalterSatz } from '../../lib/verweise';
import { zuletztGefeuert } from '../../lib/verwaist';
import { NachrichtenZiel } from './nachrichtenziel';
import { SceneDevices } from './szenen-editor';

export function Editor({
  draft,
  entities,
  orte,
  scenes,
  andereAblaeufe = [],
  categories,
  hueScenes,
  favoriten,
  empfaenger,
  onProbeStep,
  onChange,
  onZurueck,
  onKonfliktProbe,
  onSave,
  onDelete,
  onDuplizieren,
  onTest,
  onDryRun,
  onSimulation,
  onVersions,
  onRestoreVersion,
  onCancel,
  verwaist,
}: {
  draft: Draft | null;
  entities: Entity[];
  /** Die Orte des Hubs – eigene und die aus Life360 übernommenen.
   *  Ohne sie kennt der Ortsauslöser nur «Zuhause». */
  orte?: { id: string; name?: string }[];
  scenes: Scene[];
  /** Die übrigen Abläufe – für den Hinweis «das schaltet auch …».
   *  Leer ist erlaubt: Dann steht der Hinweis eben nicht. */
  andereAblaeufe?: { id: string; alias: string }[];
  /** Schon vergebene Kategorien – als Vorschläge im Feld. */
  categories: string[];
  /** Szenen der Hue-Bridge; leer, wenn keine Bridge verbunden ist. */
  hueScenes: string[];
  favoriten: string[];
  /** Mögliche Nachricht-Empfänger (Punkt 158); leer = keine Auswahl. */
  empfaenger?: string[];
  /** Einen einzelnen Schritt sofort ausführen (Punkt 164). */
  onProbeStep?: (step: StepDraft) => Promise<boolean>;
  onChange: (draft: Draft) => void;
  /** Eine Änderung zurücknehmen (Punkt 467 der Werkbank) - fehlt, wenn
   *  es nichts zurückzunehmen gibt. Betrifft nur diese Sitzung; für
   *  gespeicherte Fassungen gibt es «Frühere Fassungen» daneben. */
  onZurueck?: () => void;
  /** Womit sich dieser Entwurf beisst (Punkt 462). Der Hub rechnet es
   *  mit demselben Weg wie die Widerspruchs-Liste - nur jetzt statt
   *  Tage später an einem Licht, das flackert. */
  onKonfliktProbe?: (draft: Draft) => Promise<
    { entity_id: string; commands: string[]; automations: { id: string; alias: string }[] }[]
  >;
  onSave: () => void;
  onDelete?: () => void;
  /** Den Ablauf kopieren (Punkt 313 der Werkbank). «Wie der für die
   *  Küche, aber fürs Bad» ist der häufigste zweite Ablauf - und ihn
   *  von Hand nachzubauen heisst, sieben Felder erneut zu treffen. */
  onDuplizieren?: () => void;
  /** Nur bei gespeicherten Abläufen: einmal sofort ausführen. */
  onTest?: () => void;
  /** Nur bei gespeicherten Abläufen: zeigen, was jetzt passieren würde. */
  onDryRun?: () => Promise<DryRun | null>;
  /** Nur bei gespeicherten Abläufen: «Hätte gefeuert» - die letzten
   *  sieben Tage nachgerechnet (Punkt 254). */
  onSimulation?: () => Promise<SimulationsBericht | null>;
  /** Frühere Fassungen laden bzw. eine zurückholen (nur beim Bearbeiten). */
  onVersions?: () => Promise<Fassung[]>;
  onRestoreVersion?: (at: number) => Promise<boolean>;
  onCancel: () => void;
  /** Nur bei verwaisten Abläufen (Punkt 262) - das Urteil fällt der Hub
   *  (`orphaned`), damit App und Hub nie zwei Meinungen über die
   *  90-Tage-Grenze haben. `lastFired` ist das letzte Feuern in
   *  Unix-Sekunden, null = noch nie. */
  verwaist?: { lastFired: number | null };
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tested, setTested] = useState(false);
  // Der Satz oben: kurz, mit «Alle zeigen» - siehe lib/ablaufsatz.ts.
  const [satzGanz, setSatzGanz] = useState(false);
  const [preview, setPreview] = useState<DryRun | null>(null);
  // Das Blatt «Hätte gefeuert» (Punkt 254) - null heisst: noch nicht
  // geholt oder Hub nicht erreichbar.
  const [simulation, setSimulation] = useState<SimulationsBericht | null>(null);
  // Womit sich der Entwurf beisst (Punkt 462). Nachgefragt wird eine
  // Sekunde nach der letzten Änderung: Bei jedem Tastendruck zu fragen
  // hiesse, dem Hub beim Tippen des Namens dreissig Anfragen zu
  // schicken - und die Antwort auf einen halben Entwurf ist ohnehin
  // keine.
  const [widersprueche, setWidersprueche] = useState<
    { entity_id: string; commands: string[]; automations: { id: string; alias: string }[] }[]
  >([]);
  const schritteSchluessel = JSON.stringify(draft?.steps ?? []);
  const sonstSchluessel = JSON.stringify(draft?.elseSteps ?? []);
  useEffect(() => {
    if (!onKonfliktProbe || !draft) {
      setWidersprueche([]);
      return;
    }
    let lebt = true;
    const frist = setTimeout(() => {
      onKonfliktProbe(draft)
        .then((zeilen) => {
          if (lebt) setWidersprueche(zeilen);
        })
        .catch(() => {
          // Ein Hinweis, der sich nicht holen lässt, soll das Bauen
          // nicht aufhalten - dann steht er eben nicht da.
          if (lebt) setWidersprueche([]);
        });
    }, 1000);
    return () => {
      lebt = false;
      clearTimeout(frist);
    };
    // Nur die Schritte entscheiden über Widersprüche - Name, Kategorie
    // und Nachtruhe schalten nichts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schritteSchluessel, sonstSchluessel, draft?.id]);
  if (!draft) return null;

  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  // Die Sammelfrage «ist überhaupt noch jemand da?» - dieselbe Entität,
  // die die Kopfzeile für «jemand da» liest. Fehlt sie (kein Geofence
  // eingerichtet), steht der Schnellknopf gar nicht erst da: Ein Knopf,
  // der eine Bedingung auf ein nicht vorhandenes Gerät baut, ist ein
  // Ablauf, der nie läuft.
  const anwesenheit = entities.find((entity) => entity.id === 'geofence.anyone_home');
  const hatAnwesenheitsbedingung = draft.stateConditions.some(
    (eintrag) => eintrag.entity_id === anwesenheit?.id
  );

  const setTrigger = (index: number, patch: Partial<TriggerDraft>) =>
    set({
      triggers: draft.triggers.map((trigger, i) =>
        i === index ? { ...trigger, ...patch } : trigger
      ),
    });
  const addTrigger = () =>
    set({
      triggers: [
        ...draft.triggers,
        newTrigger(entities[0]),
      ],
    });
  const removeTrigger = (index: number) =>
    set({ triggers: draft.triggers.filter((_, i) => i !== index) });

  // Welche Auslöser dieses Ablaufs messen Helligkeit? Nur dann gibt es
  // bei den Lampen «an Helligkeit angepasst» – ein Melder ohne
  // Helligkeitsfühler kann nichts beisteuern, und die Wahl wäre eine
  // Attrappe.
  const luxSensors = melderMitLux(draft, entities);

  // Was am Entwurf noch fehlt - dieselbe Liste speist den Hinweis oben
  // und den Zustand der Speichern-Knöpfe. Eine Vorlage darf lückenhaft
  // bleiben: Sie schaltet nichts, sie steht bereit, und gerade das
  // Offengelassene füllt man beim Anlegen aus ihr aus.
  const fehlt = draft.templateId ? [] : wasFehlt(draft);
  const speicherbar = fehlt.length === 0;
  const vorschlag = namensVorschlag(draft, entities);

  const titel = draft.templateId
    ? draft.templateId === 'neu'
      ? 'Neue Vorlage'
      : 'Vorlage bearbeiten'
    : draft.id
      ? 'Ablauf bearbeiten'
      : 'Neuer Ablauf';

  return (
    <EditorRahmen
      titel={titel}
      onCancel={onCancel}
      onSave={onSave}
      saveGesperrt={!speicherbar}
    >
        <Text style={styles.snapshotHint}>
          {draft.templateId
            ? // Eine Vorlage schaltet nichts - sie steht bereit. Das
              // gehört hierhin, sonst wartet jemand auf ein Licht, das
              // nie angeht.
              'Eine Vorlage läuft nicht – sie steht unter «Abläufe» bereit und öffnet sich beim Antippen als vorbefüllter Entwurf. Erst was daraus gespeichert wird, schaltet.'
            : 'Ein Ablauf ist ein Satz: „Wenn … passiert, dann … tun." Unten das Wenn und das Dann ausfüllen, oben einen Namen geben.'}
        </Text>

        {/* Und hier steht dieser Satz auch – mitlaufend, mit Gerätenamen.
            Wer «und» meinte und «oder» gebaut hat, liest es sofort, statt
            es erst am Abend im dunklen Flur zu merken. */}
        {(() => {
          const roh = {
            triggers: draft.triggers.map(triggerToConfig),
            conditions: buildConditions(draft),
            actions: stepsToActions(draft.steps),
            otherwise: stepsToActions(draft.elseSteps),
            match: draft.match,
          };
          const satz = ablaufSatz(roh, entities, scenes, satzGanz);
          // Ein «alle weg» schaltet sechzig Geräte - einzeln aufgezählt
          // füllt das den halben Bildschirm. Kurz genügt zum Lesen; wer
          // die ganze Liste sehen will, tippt drauf.
          const lang = ablaufSatz(roh, entities, scenes, true);
          const gekuerzt = lang !== ablaufSatz(roh, entities, scenes, false);
          // Fehlt noch etwas, steht das *statt* des Satzes da. Vorher
          // verschwand die Box einfach, solange der Entwurf unvollständig
          // war - also genau dann, wenn eine Auskunft am meisten wert
          // gewesen wäre.
          if (fehlt.length > 0) {
            return (
              <View style={[styles.satzBox, { borderColor: colors.warn }]}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.warn} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.satzText, { color: colors.warn }]}>
                    Es fehlt noch:
                  </Text>
                  {fehlt.map((was, index) => (
                    <Text key={index} style={styles.fehltZeile}>
                      • {was}
                    </Text>
                  ))}
                </View>
              </View>
            );
          }
          return satz ? (
            <Pressable
              onPress={gekuerzt ? () => setSatzGanz((an) => !an) : undefined}
              accessibilityRole={gekuerzt ? 'button' : undefined}
              accessibilityLabel={
                gekuerzt
                  ? satzGanz
                    ? 'Kurzfassung zeigen'
                    : 'Alle Geräte zeigen'
                  : undefined
              }
              style={styles.satzBox}
            >
              <Ionicons name="chatbox-ellipses-outline" size={15} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.satzText}>{satz}</Text>
                {gekuerzt ? (
                  <Text style={styles.satzMehr}>
                    {satzGanz ? 'Weniger zeigen' : 'Alle zeigen'}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ) : null;
        })()}

        <Field label="Name">
          {/* Der Platzhalter ist der Vorschlag, den auch das Speichern
              nimmt: Wer nichts eintippt, sieht vorher, wie der Ablauf
              in der Liste heissen wird - statt hinterher «Ohne Namen»,
              zweimal untereinander. */}
          <TextInput
            style={styles.input}
            value={draft.alias}
            onChangeText={(alias) => set({ alias })}
            placeholder={vorschlag || 'z.B. Licht bei Bewegung'}
            placeholderTextColor={colors.inkFaint}
          />
        </Field>

        {/* Beides ist Beiwerk: Ein neuer Ablauf läuft, und eine
            Kategorie vergibt man, wenn die Liste lang geworden ist -
            nicht beim Anlegen. Zusammen in einer Klappe, die sich von
            selbst öffnet, sobald etwas drinsteht. */}
        <Klappe label="Kategorie und Zustand" stand={angabenStand(draft)}>
          <CategoryField
            value={draft.category}
            known={categories}
            onChange={(category) => set({ category })}
          />
          <Text style={styles.label}>Aktiv</Text>
          <Choice
            options={[
              { key: 'on', label: 'läuft' },
              { key: 'off', label: 'aus' },
            ]}
            value={draft.enabled ? 'on' : 'off'}
            onSelect={(value) => set({ enabled: value === 'on' })}
          />
          {!draft.enabled ? (
            <Text style={styles.triggerNote}>
              Der Ablauf bleibt gespeichert, löst aber nicht aus – besser als
              löschen, wenn man ihn im Winter wieder braucht.
            </Text>
          ) : null}
        </Klappe>

        {/* Die vier Hauptabschnitte als nummerierte Karten - die Nummern
            erzählen den Satz: 1 Wenn, 2 Nur wenn, 3 Dann, 4 Sonst. */}
        <Abschnitt
          nummer="1"
          titel={draft.triggers.length > 1 ? 'Wenn eines passiert' : 'Wenn … passiert'}
        >
          {draft.triggers.map((trigger, index) => (
            <TriggerRow
              key={index}
              trigger={trigger}
              entities={entities}
              orte={orte}
              index={index}
              removable={draft.triggers.length > 1}
              onChange={(patch) => setTrigger(index, patch)}
              onRemove={() => removeTrigger(index)}
            />
          ))}
          <Pressable
            onPress={addTrigger}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>Weiterer Auslöser</Text>
          </Pressable>
        </Abschnitt>

        {/* Der grösste Abschnitt: Zustandsbedingungen, Und/Oder-Gruppen,
            Wochentage, Feiertage. Für «wenn der Melder anschlägt, mach
            das Licht an» braucht man nichts davon - offen sind es zwei
            Bildschirme, an denen man vorbeiscrollt; darum zuklappbar. */}
        <Abschnitt
          nummer="2"
          titel="Nur wenn (Bedingung)"
          stand={bedingungStand(draft)}
          zuklappbar
        >
          <Choice
            options={[
              { key: 'none', label: 'immer' },
              { key: 'sun', label: 'Tag / Nacht' },
              { key: 'time', label: 'Zeitfenster' },
            ]}
            value={draft.conditionKind}
            onSelect={(conditionKind) =>
              set({ conditionKind: conditionKind as ConditionKind })
            }
          />
          {draft.conditionKind === 'sun' ? (
            <Choice
              options={[
                { key: 'down', label: 'nur wenn dunkel' },
                { key: 'up', label: 'nur wenn hell' },
              ]}
              value={draft.conditionSun}
              onSelect={(value) => set({ conditionSun: value as 'up' | 'down' })}
            />
          ) : draft.conditionKind === 'time' ? (
            <View style={styles.rowGap}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={draft.conditionAfter}
                onChangeText={(conditionAfter) => set({ conditionAfter })}
                onEndEditing={(event) =>
                  set({ conditionAfter: normalisiereZeit(event.nativeEvent.text) })
                }
                keyboardType="numbers-and-punctuation"
                placeholder="ab 22:00"
                placeholderTextColor={colors.inkFaint}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={draft.conditionBefore}
                onChangeText={(conditionBefore) => set({ conditionBefore })}
                onEndEditing={(event) =>
                  set({ conditionBefore: normalisiereZeit(event.nativeEvent.text) })
                }
                keyboardType="numbers-and-punctuation"
                placeholder="bis 06:00"
                placeholderTextColor={colors.inkFaint}
              />
            </View>
          ) : null}
          {draft.conditionKind === 'time' &&
          zeitfensterHinweis(draft.conditionAfter, draft.conditionBefore) ? (
            <Text style={styles.snapshotHint}>
              {zeitfensterHinweis(draft.conditionAfter, draft.conditionBefore)}
            </Text>
          ) : null}
          {draft.conditionKind === 'time' ? (
            <>
              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((label, day) => {
                  const on = draft.weekdays.includes(day);
                  return (
                    <Pressable
                      key={day}
                      onPress={() =>
                        set({
                          weekdays: on
                            ? draft.weekdays.filter((entry) => entry !== day)
                            : [...draft.weekdays, day],
                        })
                      }
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      style={[styles.weekday, on && styles.weekdayOn]}
                    >
                      <Text style={[styles.weekdayText, on && styles.weekdayTextOn]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.triggerNote}>
                {draft.weekdays.length === 0
                  ? 'Kein Tag gewählt heisst jeden Tag.'
                  : `Nur ${weekdayLabel(draft.weekdays)}.`}
              </Text>
              <Pressable
                onPress={() => set({ exceptHolidays: !draft.exceptHolidays })}
                accessibilityRole="switch"
                accessibilityState={{ checked: draft.exceptHolidays }}
                style={styles.holidayToggle}
              >
                <Ionicons
                  name={draft.exceptHolidays ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={draft.exceptHolidays ? colors.accent : colors.inkSoft}
                />
                <Text style={styles.holidayText}>ausser an Feiertagen</Text>
              </Pressable>
              {draft.exceptHolidays ? (
                <Text style={styles.triggerNote}>
                  Der Hub kennt die Luzerner Feiertage – Auffahrt ist dann kein
                  Werktag, und der Sauger bleibt in der Ecke.
                </Text>
              ) : null}
              {/* Schulferien (Punkt 470 der Werkbank): Die Termine liegen
                  seit je im Hub, benutzt hat sie nur die Simulation -
                  «Wecklicht um 06:30» war im Juli falsch, und abgestellt
                  hat das jeden Sommer jemand von Hand. Eigener Haken
                  neben den Feiertagen: Wer beides will, setzt beide. */}
              <Pressable
                onPress={() =>
                  set({ exceptSchoolHolidays: !draft.exceptSchoolHolidays })
                }
                accessibilityRole="switch"
                accessibilityState={{ checked: draft.exceptSchoolHolidays }}
                style={styles.holidayToggle}
              >
                <Ionicons
                  name={draft.exceptSchoolHolidays ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={draft.exceptSchoolHolidays ? colors.accent : colors.inkSoft}
                />
                <Text style={styles.holidayText}>ausser in den Schulferien</Text>
              </Pressable>
              {draft.exceptSchoolHolidays ? (
                <Text style={styles.triggerNote}>
                  Der Hub holt die Luzerner Ferientermine selbst – das Wecklicht
                  bleibt im Juli aus, ohne dass es jemand abstellt.
                </Text>
              ) : null}
            </>
          ) : null}

          {draft.stateConditions.map((entry, index) => {
            const chosen = entities.find((entity) => entity.id === entry.entity_id);
            const setEntry = (patch: Partial<typeof entry>) =>
              set({
                stateConditions: draft.stateConditions.map((other, position) =>
                  position === index ? { ...other, ...patch } : other
                ),
              });
            return (
              <View key={index} style={styles.triggerBox}>
                <View style={styles.triggerHead}>
                  <Text style={styles.triggerBadge}>nur wenn Gerät</Text>
                  <Pressable
                    onPress={() =>
                      set({
                        stateConditions: draft.stateConditions.filter(
                          (_other, position) => position !== index
                        ),
                      })
                    }
                    accessibilityLabel="Bedingung entfernen"
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
                <EntityPicker
                  entities={entities}
                  value={entry.entity_id}
                  onSelect={(entity_id) =>
                    setEntry({
                      entity_id,
                      value:
                        entry.op === 'is'
                          ? fittingState(
                              entities.find((entity) => entity.id === entity_id),
                              entry.value
                            )
                          : entry.value,
                    })
                  }
                />
                <Choice
                  options={[
                    { key: 'is', label: 'ist' },
                    { key: 'above', label: 'über' },
                    { key: 'below', label: 'unter' },
                  ]}
                  value={entry.op}
                  onSelect={(op) =>
                    setEntry({
                      op: op as Compare,
                      // Beim Wechsel den Wert passend machen: «an» taugt
                      // nicht als Zahl und 30 nicht als Zustand.
                      value:
                        op === 'is'
                          ? fittingState(chosen, entry.value)
                          : String(Number(entry.value) || 0),
                      // «ist» vergleicht immer den Zustand selbst.
                      attribute: op === 'is' ? undefined : entry.attribute,
                    })
                  }
                />
                {entry.op === 'is' ? (
                  <Choice
                    options={conditionOptions(chosen)}
                    value={entry.value}
                    onSelect={(value) => setEntry({ value })}
                  />
                ) : (
                  <NumberField
                    value={entry.value}
                    onCommit={(value) => setEntry({ value })}
                    placeholder="z.B. 30"
                  />
                )}
                {entry.op !== 'is' && measurableAttributes(chosen).length > 0 ? (
                  <>
                    <Choice
                      options={[
                        { key: '', label: 'Zustand' },
                        ...measurableAttributes(chosen),
                      ]}
                      value={entry.attribute ?? ''}
                      onSelect={(attribute) => setEntry({ attribute })}
                    />
                    {entry.attribute === 'illumination' ? (
                      <Text style={styles.triggerNote}>
                        Lux, gemessen vom Melder selbst. Als Anhalt: unter 10
                        ist Nacht, 50 eine gemütliche Wohnzimmerbeleuchtung,
                        über 1000 heller Tag. Was dein Melder gerade misst,
                        steht unter Geräte auf seiner Kachel – daran den Wert
                        festmachen, nicht raten.
                      </Text>
                    ) : (
                      <Text style={styles.triggerNote}>
                        Vergleicht diesen Messwert des Geräts.
                      </Text>
                    )}
                  </>
                ) : entry.op !== 'is' ? (
                  <Text style={styles.triggerNote}>
                    Vergleicht den Zahlenwert des Geräts – etwa die Helligkeit
                    eines Dämmerungssensors oder die Anzahl anwesender
                    Personen.
                  </Text>
                ) : null}
              </View>
            );
          })}

          {/* Die zwei Bedingungen, die fast jeder Ablauf braucht, als
              ein Tipp (Punkt 315 der Werkbank). Bauen liessen sie sich
              vorher auch - man musste nur wissen, dass «nur wenn jemand
              zuhause» eine Gerätebedingung auf `geofence.anyone_home`
              ist und «nur wenn dunkel» oben unter «Wann» steht. Genau
              dieses Wissen hat, wer schon fünf Abläufe gebaut hat. */}
          <View style={styles.pausenKnoepfe}>
            {anwesenheit && !hatAnwesenheitsbedingung ? (
              <Pressable
                onPress={() =>
                  set({
                    stateConditions: [
                      ...draft.stateConditions,
                      { entity_id: anwesenheit.id, op: 'is' as Compare, value: 'on' },
                    ],
                  })
                }
                accessibilityRole="button"
                style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.templateText}>+ nur wenn jemand zuhause</Text>
              </Pressable>
            ) : null}
            {draft.conditionKind !== 'sun' ? (
              <Pressable
                onPress={() => set({ conditionKind: 'sun', conditionSun: 'down' })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.templateText}>+ nur wenn dunkel</Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={() =>
              set({
                stateConditions: [
                  ...draft.stateConditions,
                  {
                    entity_id: entities[0]?.id ?? '',
                    op: 'is' as Compare,
                    value: fittingState(entities[0], 'on'),
                  },
                ],
              })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>Gerätebedingung hinzufügen</Text>
          </Pressable>

          {/* Und/Oder-Gruppen (Punkt 152): «dunkel und (jemand da ODER
              Gast-Modus)» brauchte bisher die config.yaml. Eine
              Schachtelungsebene deckt praktisch alle Fälle. */}
          {draft.groups.map((gruppe, gIndex) => {
            const setGruppe = (patch: Partial<typeof gruppe>) =>
              set({
                groups: draft.groups.map((other, position) =>
                  position === gIndex ? { ...other, ...patch } : other
                ),
              });
            return (
              <View key={`gruppe-${gIndex}`} style={styles.triggerBox}>
                <View style={styles.triggerHead}>
                  <Text style={styles.triggerBadge}>Bedingungsgruppe</Text>
                  <Pressable
                    onPress={() =>
                      set({
                        groups: draft.groups.filter(
                          (_other, position) => position !== gIndex
                        ),
                      })
                    }
                    accessibilityLabel="Gruppe entfernen"
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
                <Choice
                  options={[
                    { key: 'any', label: 'eine davon genügt (oder)' },
                    { key: 'all', label: 'alle zusammen (und)' },
                  ]}
                  value={gruppe.match}
                  onSelect={(match) => setGruppe({ match: match as 'all' | 'any' })}
                />
                {gruppe.conditions.map((entry, index) => {
                  const chosen = entities.find(
                    (entity) => entity.id === entry.entity_id
                  );
                  const setEntry = (patch: Partial<typeof entry>) =>
                    setGruppe({
                      conditions: gruppe.conditions.map((other, position) =>
                        position === index ? { ...other, ...patch } : other
                      ),
                    });
                  return (
                    <View key={index} style={styles.rowGap}>
                      <View style={{ flex: 1, gap: 6 }}>
                        <EntityPicker
                          entities={entities}
                          value={entry.entity_id}
                          onSelect={(entity_id) =>
                            setEntry({
                              entity_id,
                              value:
                                entry.op === 'is'
                                  ? fittingState(
                                      entities.find((e) => e.id === entity_id),
                                      entry.value
                                    )
                                  : entry.value,
                            })
                          }
                        />
                        <Choice
                          options={[
                            { key: 'is', label: 'ist' },
                            { key: 'above', label: 'über' },
                            { key: 'below', label: 'unter' },
                          ]}
                          value={entry.op}
                          onSelect={(op) =>
                            setEntry({
                              op: op as Compare,
                              value:
                                op === 'is'
                                  ? fittingState(chosen, entry.value)
                                  : String(Number(entry.value) || 0),
                              attribute: op === 'is' ? undefined : entry.attribute,
                            })
                          }
                        />
                        {entry.op === 'is' ? (
                          <Choice
                            options={conditionOptions(chosen)}
                            value={entry.value}
                            onSelect={(value) => setEntry({ value })}
                          />
                        ) : (
                          <NumberField
                            value={entry.value}
                            onCommit={(value) => setEntry({ value })}
                            placeholder="z.B. 30"
                          />
                        )}
                      </View>
                      <Pressable
                        onPress={() =>
                          setGruppe({
                            conditions: gruppe.conditions.filter(
                              (_other, position) => position !== index
                            ),
                          })
                        }
                        accessibilityLabel="Bedingung aus der Gruppe entfernen"
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={18} color={colors.inkSoft} />
                      </Pressable>
                    </View>
                  );
                })}
                <Pressable
                  onPress={() =>
                    setGruppe({
                      conditions: [
                        ...gruppe.conditions,
                        {
                          entity_id: entities[0]?.id ?? '',
                          op: 'is' as Compare,
                          value: fittingState(entities[0], 'on'),
                        },
                      ],
                    })
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="add" size={16} color={colors.accent} />
                  <Text style={styles.addRowText}>Bedingung in der Gruppe</Text>
                </Pressable>
              </View>
            );
          })}

          <Pressable
            onPress={() =>
              set({
                groups: [
                  ...draft.groups,
                  {
                    match: 'any',
                    conditions: [
                      {
                        entity_id: entities[0]?.id ?? '',
                        op: 'is' as Compare,
                        value: fittingState(entities[0], 'on'),
                      },
                    ],
                  },
                ],
              })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="git-branch-outline" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>Und/Oder-Gruppe hinzufügen</Text>
          </Pressable>

          {draft.extraConditions.length > 0 ? (
            <Text style={styles.triggerNote}>
              Dazu {draft.extraConditions.length === 1
                ? 'eine Bedingungsgruppe'
                : `${draft.extraConditions.length} Bedingungsgruppen`}{' '}
              aus der Konfiguration – zu tief geschachtelt für den Editor,
              sie bleiben beim Speichern erhalten.
            </Text>
          ) : null}

          {buildConditions(draft).length > 1 ? (
            <>
              <Choice
                options={[
                  { key: 'all', label: 'alle müssen stimmen (und)' },
                  { key: 'any', label: 'eine genügt (oder)' },
                ]}
                value={draft.match}
                onSelect={(match) => set({ match: match as 'all' | 'any' })}
              />
              <Text style={styles.triggerNote}>
                {draft.match === 'any'
                  ? 'Der Ablauf läuft, sobald eine der Bedingungen stimmt.'
                  : 'Der Ablauf läuft nur, wenn alle Bedingungen zugleich stimmen.'}
              </Text>
            </>
          ) : null}

          <Text style={styles.triggerNote}>
            Mehrere Auslöser sind immer ein «oder» – sie sind Ereignisse und
            können gar nicht gleichzeitig eintreten. Ein «und» gehört hierher:
            «wenn der Taster gedrückt wird – aber nur, wenn es dunkel ist».
          </Text>
        </Abschnitt>

        <Abschnitt nummer="3" titel="… dann das tun">
          <StepList
            steps={draft.steps}
            entities={entities}
            scenes={scenes}
            andereAblaeufe={andereAblaeufe}
            eigeneId={draft.id}
            hueScenes={hueScenes}
            favoriten={favoriten}
            empfaenger={empfaenger}
            luxSensors={luxSensors}
            onProbeStep={onProbeStep}
            colors={colors}
            styles={styles}
            onChange={(steps) => set({ steps })}
          />
          <Text style={styles.label}>Frühestens wieder nach</Text>
          <Choice
            options={[
              { key: '', label: 'sofort wieder' },
              { key: '1', label: '1 Min' },
              { key: '5', label: '5 Min' },
              { key: '30', label: '30 Min' },
              { key: '120', label: '2 Std' },
            ]}
            value={draft.cooldownMinutes}
            onSelect={(cooldownMinutes) => set({ cooldownMinutes })}
          />
          {draft.cooldownMinutes ? (
            <Text style={styles.triggerNote}>
              Nach einem Durchgang schweigt der Ablauf {draft.cooldownMinutes}{' '}
              Minuten, auch wenn er erneut ausgelöst wird – gegen den
              zuckenden Melder, der aus einer Durchsage zwanzig macht.
            </Text>
          ) : null}
          {/* Der Fall aus dem Haus: «Geschirrspüler ist fertig» um 03:25.
              Ausgeräumt wird um acht, gemeldet also auch. Nur die
              meldenden Schritte fallen weg - der Rest des Ablaufs läuft
              weiter. */}
          {meldetEtwas(draft.steps) || draft.nachtsStill ? (
            <>
              <Text style={styles.label}>Nachts (22–8 Uhr)</Text>
              <Choice
                options={[
                  { key: 'melden', label: 'melden wie sonst' },
                  { key: 'still', label: 'nichts melden' },
                ]}
                value={draft.nachtsStill ? 'still' : 'melden'}
                onSelect={(wahl) => set({ nachtsStill: wahl === 'still' })}
              />
              {draft.nachtsStill ? (
                <>
                  <Text style={styles.triggerNote}>
                    Zwischen {draft.nachtsVon ?? 22} und {draft.nachtsBis ?? 8} Uhr
                    bleiben Nachricht und Durchsage aus; alles andere im Ablauf
                    läuft weiter. Für das, was bis zum Morgen Zeit hat – die
                    Maschine räumt um drei Uhr niemand aus. Was nachts kommen
                    muss («jemand weint im Kinderzimmer»), bleibt auf
                    «melden wie sonst».
                  </Text>
                  {/* Eigene Stunden statt der üblichen 22-8 (Punkt 379) -
                      leer heisst die Vorgabe, deshalb keine Pflichtfelder. */}
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <Text style={styles.triggerNote}>Von</Text>
                    <TextInput
                      style={[styles.input, { width: 56, textAlign: 'center' }]}
                      value={draft.nachtsVon === null ? '' : String(draft.nachtsVon)}
                      onChangeText={(text) => set({ nachtsVon: stundeAusText(text) })}
                      placeholder="22"
                      placeholderTextColor={colors.inkFaint}
                      keyboardType="number-pad"
                      accessibilityLabel="Nachtruhe beginnt um"
                    />
                    <Text style={styles.triggerNote}>bis</Text>
                    <TextInput
                      style={[styles.input, { width: 56, textAlign: 'center' }]}
                      value={draft.nachtsBis === null ? '' : String(draft.nachtsBis)}
                      onChangeText={(text) => set({ nachtsBis: stundeAusText(text) })}
                      placeholder="8"
                      placeholderTextColor={colors.inkFaint}
                      keyboardType="number-pad"
                      accessibilityLabel="Nachtruhe endet um"
                    />
                    <Text style={styles.triggerNote}>Uhr</Text>
                  </View>
                </>
              ) : null}
            </>
          ) : null}
          {/* Der gemeldete Fall: «Das Licht geht nach 30 Minuten aus» -
              und im Kinderzimmer stand man davor und riet, ob es gleich
              ausgeht oder erst in einer halben Stunde. Freiwillig, weil
              es nicht überall erwünscht ist: Die Anwesenheits-Simulation
              soll aussehen wie ein Mensch, der das Licht löscht, und
              nicht wie eine Schaltuhr. */}
          {schaltetSpaeterAus(draft.steps) ? (
            <>
              <Text style={styles.label}>Restzeit anzeigen</Text>
              <Choice
                options={[
                  { key: 'aus', label: 'nicht anzeigen' },
                  { key: 'an', label: 'anzeigen' },
                ]}
                value={draft.restzeitZeigen ? 'an' : 'aus'}
                onSelect={(wahl) => set({ restzeitZeigen: wahl === 'an' })}
              />
              <Text style={styles.triggerNote}>
                {draft.restzeitZeigen
                  ? 'Solange der Ablauf wartet, steht «geht in 12 Min aus» am Gerät selbst, auf der Raumkarte und im «Lichter an»-Blatt der Startkarte. Wer von Hand ausschaltet, nimmt die Anzeige mit.'
                  : 'Ohne Anzeige merkt man das Ausschalten erst, wenn es passiert – bei einem Licht im Kinderzimmer ist das die falsche Überraschung.'}
              </Text>
            </>
          ) : null}
          {hatWartezeit(draft.steps) ? (
            <>
              <Text style={styles.label}>Wenn er dabei erneut ausgelöst wird</Text>
              <Choice
                options={[
                  { key: 'single', label: 'nichts tun' },
                  { key: 'restart', label: 'von vorn beginnen' },
                ]}
                value={draft.mode}
                onSelect={(mode) => set({ mode: mode as 'single' | 'restart' })}
              />
              <Text style={styles.triggerNote}>
                {draft.mode === 'restart'
                  ? 'Der laufende Durchgang wird abgebrochen und beginnt neu – die Wartezeit zählt also ab dem letzten Mal. Das ist der Nachlauf eines Treppenhauslichts: Bewegung schaltet ein, jede weitere Bewegung verlängert.'
                  : 'Ein zweiter Auslöser wird verworfen, solange der Ablauf noch wartet. Richtig für alles, was einmal geschehen soll – eine Nachricht käme sonst doppelt.'}
              </Text>
            </>
          ) : null}

          {/* Befristung (Punkt 464 der Werkbank). «Bis Ende der Ferien»,
              «nur diese Woche» - bis hierher schaltete man so einen
              Ablauf ein und vergass ihn. Der Hub schaltet ihn nach dem
              letzten Tag aus und lässt ihn stehen: Nächstes Jahr braucht
              man ihn wieder. */}
          <Text style={styles.label}>Gültig bis</Text>
          <TextInput
            style={styles.input}
            value={draft.gueltigBis}
            onChangeText={(text) => set({ gueltigBis: text })}
            placeholder="TT.MM.JJJJ – leer heisst unbefristet"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Gültig bis"
          />
          <Text style={styles.triggerNote}>
            {draft.gueltigBis
              ? 'Der letzte Tag zählt noch mit. Danach schaltet der Hub den Ablauf aus – gelöscht wird nichts, und die Frist bleibt stehen.'
              : 'Ohne Frist läuft er, bis ihn jemand ausschaltet. Für «bis Ende der Ferien» ist das genau der Fall, bei dem es niemand tut.'}
          </Text>

          {/* Reihenfolge (Punkt 466). Zwei Abläufe um 07:00 liefen
              bisher in der Reihenfolge, in der sie zufällig in der Liste
              standen - kein Verhalten, sondern ein Zufall, auf den sich
              irgendwann jemand verlässt. */}
          <Text style={styles.label}>Reihenfolge</Text>
          <TextInput
            style={styles.input}
            value={draft.reihenfolge}
            onChangeText={(text) => set({ reihenfolge: text })}
            placeholder="0"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Reihenfolge"
          />
          <Text style={styles.triggerNote}>
            Wenn mehrere Abläufe gleichzeitig dran sind, kommt der mit der
            kleineren Zahl zuerst – «erst Storen hoch, dann Kaffee». 0 heisst
            egal, und das ist bei fast allen die Wahrheit.
          </Text>
        </Abschnitt>

        <Abschnitt nummer="4" titel="… sonst" stand={sonstStand(draft)} zuklappbar>
          {draft.elseSteps.length === 0 ? (
            <>
              <Pressable
                onPress={() => set({ elseSteps: [{ ...EMPTY_STEP }] })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="git-branch-outline" size={16} color={colors.accent} />
                <Text style={styles.addRowText}>Zweig für «Bedingung passt nicht»</Text>
              </Pressable>
              <Text style={styles.triggerNote}>
                Ohne diesen Zweig passiert schlicht nichts, wenn eine
                Bedingung nicht stimmt. Mit ihm spart man sich den zweiten
                Ablauf mit gegenteiliger Bedingung – den man sonst beim
                Ändern jedes Mal mit anfassen muss.
              </Text>
            </>
          ) : (
            <StepList
              steps={draft.elseSteps}
              entities={entities}
              scenes={scenes}
              andereAblaeufe={andereAblaeufe}
              eigeneId={draft.id}
              hueScenes={hueScenes}
              favoriten={favoriten}
              empfaenger={empfaenger}
              luxSensors={luxSensors}
              onProbeStep={onProbeStep}
              colors={colors}
              styles={styles}
              onChange={(elseSteps) => set({ elseSteps })}
            />
          )}
        </Abschnitt>

        {/* Widersprüche (Punkt 462 der Werkbank): Dieselbe Auskunft wie
            in der Liste unter «Widersprüche» - nur in dem Moment, in dem
            der Widerspruch entsteht, statt Tage später an einem Licht,
            das flackert. Ein Hinweis, keine Sperre: «Der eine schaltet
            ein, der andere später aus» ist oft genau das Gewollte. */}
        {widersprueche.length > 0 ? (
          <View style={styles.konfliktBox}>
            <View style={styles.konfliktKopf}>
              <Ionicons name="git-compare-outline" size={16} color={colors.warn} />
              <Text style={styles.konfliktTitel}>
                {widersprueche.length === 1
                  ? 'Ein Gerät wird gegensätzlich geschaltet'
                  : `${widersprueche.length} Geräte werden gegensätzlich geschaltet`}
              </Text>
            </View>
            {widersprueche.slice(0, 4).map((zeile) => {
              const andere = zeile.automations.find(
                (teil) => teil.id !== (draft.id ?? '__entwurf__')
              );
              const geraet =
                entities.find((entity) => entity.id === zeile.entity_id)?.name ??
                zeile.entity_id;
              return (
                <Text key={`${zeile.entity_id}-${andere?.id}`} style={styles.triggerNote}>
                  {geraet}: auch «{andere?.alias ?? 'ein anderer Ablauf'}» schaltet das
                  ({zeile.commands.join(', ')}).
                </Text>
              );
            })}
            <Text style={styles.triggerNote}>
              Oft ist genau das gewollt – der eine schaltet ein, der andere später
              aus. Abhaken lässt es sich danach in der Liste unter «Widersprüche».
            </Text>
          </View>
        ) : null}

        {/* Grau, solange der Ablauf nichts täte. Nicht als Schikane:
            Oben steht als Liste, was fehlt, und die Knöpfe zeigen
            dasselbe noch einmal - man soll gar nicht erst dagegen
            tippen und sich fragen, warum nichts passiert. */}
        <Pressable
          style={[styles.save, !speicherbar && { opacity: 0.45 }]}
          onPress={onSave}
          disabled={!speicherbar}
          accessibilityRole="button"
          accessibilityState={{ disabled: !speicherbar }}
        >
          <Text style={styles.saveText}>
            {draft.templateId ? 'Vorlage sichern' : 'Speichern'}
          </Text>
        </Pressable>
        {/* Zurück innerhalb dieser Sitzung (Punkt 467 der Werkbank).
            «Frühere Fassungen» weiter unten holt gespeicherte Stände
            zurück; hier geht es um die drei Handgriffe von gerade eben,
            die es vorher nur über «Abbrechen und von vorn» gab. */}
        {onZurueck ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={onZurueck}
            accessibilityRole="button"
            accessibilityLabel="Letzte Änderung zurücknehmen"
          >
            <Ionicons name="arrow-undo-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Änderung zurücknehmen</Text>
          </Pressable>
        ) : null}
        {onTest ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={() => {
              onTest();
              setTested(true);
            }}
            accessibilityRole="button"
          >
            <Ionicons name="flash-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>
              {tested ? 'Ausgeführt ✓' : 'Jetzt testen'}
            </Text>
          </Pressable>
        ) : null}
        {onDryRun ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={async () => setPreview(await onDryRun())}
            accessibilityRole="button"
          >
            <Ionicons name="eye-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Trockenlauf</Text>
          </Pressable>
        ) : null}
        {preview ? (
          <View style={styles.preview}>
            <Text style={styles.previewHead}>
              {preview.conditions_hold
                ? 'Die Bedingungen passen gerade.'
                : 'Die Bedingungen passen gerade nicht:'}
            </Text>
            {preview.skipped.map((reason, index) => (
              <Text key={index} style={styles.previewLine}>
                • {reason}
              </Text>
            ))}
            <Text style={styles.previewHead}>
              {preview.would_run.length === 0
                ? 'Es würde nichts passieren.'
                : `Es würde passieren (${preview.branch}):`}
            </Text>
            {preview.would_run.map((line, index) => (
              <Text key={index} style={styles.previewLine}>
                {index + 1}. {line}
              </Text>
            ))}
          </View>
        ) : null}
        {onTest ? (
          <Text style={styles.snapshotHint}>
            «Jetzt testen» führt die Aktionen wirklich aus – ohne auf Auslöser
            oder Bedingung zu warten. Der Trockenlauf zeigt nur, was passieren
            würde. Gespeicherte Änderungen zuerst sichern.
          </Text>
        ) : null}
        {/* Verwaist (Punkt 262): Der Hinweis steht direkt vor «Hätte
            gefeuert», weil das der Weg zur Antwort ist - die Simulation
            (Punkt 254) rechnet nach, ob der Ablauf überhaupt hätte
            feuern können, oder ob Gerät und Bedingung ins Leere zeigen. */}
        {verwaist ? (
          <Text style={[styles.snapshotHint, { color: colors.warn }]}>
            Dieser Ablauf hat{' '}
            {verwaist.lastFired
              ? `zuletzt ${zuletztGefeuert(verwaist.lastFired)}`
              : 'noch nie'}{' '}
            gefeuert. Mit «Hätte gefeuert» lässt sich prüfen, ob er
            überhaupt hätte feuern können - oft steckt ein umbenanntes
            Gerät oder eine nie erfüllte Bedingung dahinter.
          </Text>
        ) : null}
        {/* «Hätte gefeuert» (Punkt 254): Der Trockenlauf kennt nur das
            Jetzt - hier steht, wie oft der Ablauf letzte Woche gelaufen
            wäre. Die ehrlichen Abschnitte («nicht simulierbar»,
            «ungeprüft») gehören dazu: Eine Zahl ohne sie wäre eine
            Schätzung, die sich als Messung ausgibt. */}
        {onSimulation ? (
          <Pressable
            style={({ pressed }) => [styles.snapshot, pressed && { opacity: 0.8 }]}
            onPress={async () => setSimulation(await onSimulation())}
            accessibilityRole="button"
            accessibilityLabel="Hätte gefeuert: die letzten sieben Tage nachrechnen"
          >
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={styles.snapshotText}>Hätte gefeuert (7 Tage)</Text>
          </Pressable>
        ) : null}
        {simulation ? (
          <SimulationsBlatt bericht={simulation} entities={entities} styles={styles} colors={colors} />
        ) : null}
        {onVersions && onRestoreVersion ? (
          <VersionsSection load={onVersions} restore={onRestoreVersion} />
        ) : null}
        {onDuplizieren ? (
          <Pressable
            style={styles.template}
            onPress={onDuplizieren}
            accessibilityRole="button"
            accessibilityLabel="Diesen Ablauf kopieren"
          >
            <Text style={styles.templateText}>Als Kopie anlegen</Text>
          </Pressable>
        ) : null}
        {onDelete ? (
          <Pressable style={styles.delete} onPress={onDelete} accessibilityRole="button">
            <Text style={styles.deleteText}>Ablauf löschen</Text>
          </Pressable>
        ) : null}
    </EditorRahmen>
  );
}

/** Eine frühere Fassung, wie GET /api/edit-history sie liefert. */
export interface Fassung {
  at: number;
  by?: string;
  name?: string;
}

/** «Frühere Fassungen» im Editor – das Gegenstück zum Papierkorb fürs
 *  Überschreiben. Zeigt nichts, solange es keine Fassungen gibt: Wer noch
 *  nie gespeichert hat, braucht auch keinen Rückweg. */
export function VersionsSection({
  load,
  restore,
}: {
  load: () => Promise<Fassung[]>;
  restore: (at: number) => Promise<boolean>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<Fassung[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    load().then((versions) => {
      if (mounted) setRows(versions);
    });
    return () => {
      mounted = false;
    };
  }, [load]);
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Frühere Fassungen</Text>
      {rows.map((row) => (
        <View key={row.at} style={styles.cardHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.detail}>
              {datumUhr(row.at * 1000)}
            </Text>
            <Text style={styles.triggerNote}>
              {row.by && row.by !== '?' ? `gespeichert von ${row.by}` : 'gespeichert'}
            </Text>
          </View>
          <Pressable
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              const ok = await restore(row.at);
              if (!ok) setBusy(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.newButton,
              (pressed || busy) && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="arrow-undo-outline" size={16} color={colors.ink} />
            <Text style={styles.newText}>Zurückholen</Text>
          </Pressable>
        </View>
      ))}
      <Text style={styles.triggerNote}>
        Beim Zurückholen wird der jetzige Stand selbst zur Fassung – es geht
        also nichts verloren.
      </Text>
    </View>
  );
}

/**
 * Das Blatt «Hätte gefeuert» (Punkt 254): je Tag die Zeitpunkte, die
 * Summe - und ehrlich, was sich nicht nachrechnen liess.
 *
 * Die Sätze kommen aus lib/ablaufsimulation.ts; hier steht nur, wo sie
 * stehen. Tage ohne Lauf bleiben als Strich sichtbar: «hat nie gefeuert»
 * ist genau die Antwort, für die man das Blatt aufmacht.
 */
export function SimulationsBlatt({
  bericht,
  entities,
  styles,
  colors,
}: {
  bericht: SimulationsBericht;
  entities: Entity[];
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const name = (id: string) => nameVon(entities, id);
  return (
    <View style={styles.preview}>
      <Text style={styles.previewHead}>{summenSatz(bericht)}</Text>
      {bericht.days.map((tag) => (
        <Text key={tag.date} style={styles.previewLine}>
          {tagZeile(tag)}
        </Text>
      ))}
      {obergrenzeSatz(bericht) ? (
        <Text style={[styles.previewLine, { color: colors.warn }]}>
          {obergrenzeSatz(bericht)}
        </Text>
      ) : null}
      {bericht.not_simulatable.length > 0 ? (
        <>
          <Text style={styles.previewHead}>Nicht simulierbar</Text>
          {bericht.not_simulatable.map((eintrag, index) => (
            <Text key={index} style={styles.previewLine}>
              • {nichtSimulierbarZeile(eintrag, name)}
            </Text>
          ))}
        </>
      ) : null}
      {bericht.unchecked_conditions.length > 0 ? (
        <>
          <Text style={styles.previewHead}>Nicht geprüfte Bedingungen</Text>
          {bericht.unchecked_conditions.map((eintrag, index) => (
            <Text key={index} style={styles.previewLine}>
              • {ungeprueftZeile(eintrag, name)} – gilt in der Rechnung als
              erfüllt.
            </Text>
          ))}
        </>
      ) : null}
      {/* Der Hub sagt selbst, wenn sein Protokoll den Zeitraum nicht
          deckt - der Satz kommt fertig und gehört unverändert hin. */}
      {bericht.hinweis ? (
        <Text style={[styles.previewLine, { color: colors.warn }]}>
          {bericht.hinweis}
        </Text>
      ) : null}
    </View>
  );
}

/** Ein Auslöser im Editor – eigenständige Komponente auf Modulebene, damit
 *  die Texteingaben beim Tippen nicht neu montiert werden. */
export function TriggerRow({
  trigger,
  entities,
  orte,
  index,
  removable,
  onChange,
  onRemove,
}: {
  trigger: TriggerDraft;
  entities: Entity[];
  orte?: { id: string; name?: string }[];
  index: number;
  removable: boolean;
  onChange: (patch: Partial<TriggerDraft>) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const chosen = entities.find((entity) => entity.id === trigger.entityId);
  // Ein einziger Eintrag hiesse «nur Zuhause» - dann ist die Zeile eine
  // Auswahl ohne Wahl und bleibt besser weg.
  const ortsWahl = useMemo(() => ortsauswahl(orte ?? []), [orte]);
  return (
    <View style={styles.triggerBox}>
      {removable ? (
        <View style={styles.triggerHead}>
          <Text style={styles.triggerBadge}>Auslöser {index + 1}</Text>
          <Pressable onPress={onRemove} accessibilityLabel="Auslöser entfernen" hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        </View>
      ) : null}
      <Kachelauswahl
        options={[
          // «Gerät wechselt» stimmt bei einem Taster nicht: Der wechselt
          // nichts, er wird gedrückt.
          {
            key: 'state',
            label: chosen?.kind === 'button' ? 'Taster gedrückt' : 'Gerät wechselt',
            icon: TRIGGER_KIND_ICON.state,
          },
          { key: 'threshold', label: 'Messwert', icon: TRIGGER_KIND_ICON.threshold },
          { key: 'time', label: 'Uhrzeit', icon: TRIGGER_KIND_ICON.time },
          { key: 'sun', label: 'Sonnenstand', icon: TRIGGER_KIND_ICON.sun },
          { key: 'interval', label: 'Regelmässig', icon: TRIGGER_KIND_ICON.interval },
          {
            key: 'availability',
            label: 'Meldet sich nicht',
            icon: TRIGGER_KIND_ICON.availability,
          },
          // Der seltenste Auslöser, deshalb hinten - aber der, den man
          // sucht, wenn nachts um drei das ganze Haus brennt.
          {
            key: 'power_restore',
            label: 'Nach Stromausfall',
            icon: TRIGGER_KIND_ICON.power_restore,
          },
          // Nur anbieten, wenn es auch Zonen gibt – ein leerer Auslöser
          // wäre ein Versprechen, das der Hub nicht halten kann.
          ...(entities.some((entity) => istOrtsmelder(entity.id))
            ? [{ key: 'geofence', label: 'Ort', icon: TRIGGER_KIND_ICON.geofence }]
            : []),
          // Punkt 252: Kommen und Gehen als eigener Auslöser - nur, wo
          // es überhaupt gemeldete Personen gibt.
          ...(anwesenheitsPersonen(entities).length > 0
            ? [
                {
                  key: 'presence',
                  label: 'Person kommt/geht',
                  icon: TRIGGER_KIND_ICON.presence,
                },
              ]
            : []),
          // Dito die Wetterwarnung: ohne MeteoAlarm-Gerät gäbe es
          // nichts zu hören.
          ...(entities.some((entity) => entity.kind === 'alert')
            ? [
                {
                  key: 'weather_warning',
                  label: 'Wetterwarnung',
                  icon: TRIGGER_KIND_ICON.weather_warning,
                },
              ]
            : []),
          // Dito für den Kalender (Punkt 153): ohne angebundenen Kalender
          // gäbe es nichts zu hören.
          ...(entities.some((entity) => Array.isArray(entity.state?.events))
            ? [{ key: 'calendar', label: 'Termin', icon: TRIGGER_KIND_ICON.calendar }]
            : []),
        ]}
        value={trigger.kind}
        onSelect={(kind) =>
          onChange({
            kind: kind as TriggerKind,
            // Die Wetterwarnung hört auf ein Warn-Gerät. Die Gerätewahl
            // eines vorherigen Auslösers (eine Lampe, ein Melder) hier
            // stehen zu lassen, speicherte ein entity_id, auf das nie
            // eine Warnung kommt.
            ...(kind === 'weather_warning' ? { entityId: '' } : {}),
          })
        }
      />
      {trigger.kind === 'sun' ? (
        <>
          <Choice
            options={[
              { key: 'sunrise', label: 'Sonnenaufgang' },
              { key: 'sunset', label: 'Sonnenuntergang' },
            ]}
            value={trigger.sunEvent}
            onSelect={(sunEvent) => onChange({ sunEvent: sunEvent as TriggerDraft['sunEvent'] })}
          />
          <TextInput
            style={styles.input}
            value={trigger.sunOffset}
            onChangeText={(sunOffset) => onChange({ sunOffset })}
            placeholder="Versatz in Minuten, z.B. -30"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.triggerNote}>
            Löst {Number(trigger.sunOffset) ? `${Math.abs(Number(trigger.sunOffset))} Min ` : ''}
            {Number(trigger.sunOffset) < 0 ? 'vor ' : Number(trigger.sunOffset) > 0 ? 'nach ' : ''}
            {trigger.sunEvent === 'sunrise' ? 'Sonnenaufgang' : 'Sonnenuntergang'} aus.
          </Text>
        </>
      ) : trigger.kind === 'state' ? (
        <>
          <EntityPicker
            entities={entities}
            value={trigger.entityId}
            onSelect={(entityId) =>
              onChange({
                entityId,
                // Ein Taster kennt kein «an» – nach dem Wechsel muss der
                // Zustand zum neuen Gerät passen, sonst stünde da ein
                // Auslöser, der nie eintritt. Dasselbe gilt fürs Feld:
                // «klingelt» ergibt bei einer Lampe keinen Sinn.
                ...fittingTrigger(
                  entities.find((entity) => entity.id === entityId),
                  trigger.attribute,
                  trigger.toState
                ),
              })
            }
          />
          <Choice
            options={stateOptions(chosen)}
            value={optionKey(trigger.attribute, trigger.toState)}
            onSelect={(key) => {
              // Der Schlüssel trägt das Feld mit: «ring:on» heisst
              // klingeln, «on» heisst der Zustand selbst. Sonst liesse
              // sich beides nicht auseinanderhalten.
              const gewaehlt = stateOptions(chosen).find(
                (option) => option.key === key
              );
              onChange({
                toState: gewaehlt?.to ?? key,
                attribute: gewaehlt?.attribute ?? '',
                fromState: '',
              });
            }}
          />
          {/* Altlasten sichtbar machen: Ein Ablauf aus früherer Zeit
              kann auf einen Zustand horchen, den es an diesem Gerät gar
              nicht gibt - dann läuft er nie und nennt keinen Grund.
              Ohne diesen Satz steht hier bloss kein Chip ausgewählt. */}
          {unbekannterZustand(chosen, trigger.attribute, trigger.toState) ? (
            <Text style={[styles.triggerNote, { color: colors.warn }]}>
              {unbekannterZustand(chosen, trigger.attribute, trigger.toState)}
            </Text>
          ) : null}
          {chosen?.kind === 'button' ? (
            <Text style={styles.triggerNote}>
              Löst bei jedem Druck aus – auch wenn dieselbe Taste mehrmals
              hintereinander gedrückt wird.
            </Text>
          ) : null}
          {trigger.attribute || trigger.fromState ? (
            <Text style={styles.triggerNote}>
              Löst aus, wenn {trigger.attribute || 'der Zustand'}
              {trigger.fromState ? ` von «${trigger.fromState}»` : ''} auf «{trigger.toState}»
              wechselt.
            </Text>
          ) : null}
          <MinutenWahl
            options={[
              { key: '', label: 'sofort' },
              { key: '5', label: 'bleibt 5 Min. so' },
              { key: '10', label: 'bleibt 10 Min. so' },
              { key: '30', label: 'bleibt 30 Min. so' },
            ]}
            value={trigger.forMinutes}
            onChange={(forMinutes) => onChange({ forMinutes })}
            placeholder="Minuten, z.B. 45"
          />
          {trigger.forMinutes ? (
            <Text style={styles.triggerNote}>
              Löst erst aus, wenn der Zustand {trigger.forMinutes} Minuten
              bestehen bleibt - der kurze Gang zum Briefkasten zählt so
              nicht als «alle weg».
            </Text>
          ) : null}
        </>
      ) : trigger.kind === 'power_restore' ? (
        <>
          <Text style={styles.triggerNote}>
            Läuft, wenn der Hub nach einem Stromausfall hochfährt - nicht
            nach einem Update. Die meisten Lampen gehen bei Stromrückkehr
            von selbst an; hier stellst du ein, was danach gelten soll.
          </Text>
          <Text style={styles.groupLabel}>Wie lange warten?</Text>
          <Choice
            options={[
              { key: '', label: 'kurz (20 Sek.)' },
              { key: '60', label: '1 Min.' },
              { key: '120', label: '2 Min.' },
              { key: '300', label: '5 Min.' },
            ]}
            value={trigger.restoreDelay}
            onSelect={(restoreDelay) => onChange({ restoreDelay })}
          />
          <Text style={styles.triggerNote}>
            Nach einem Stromausfall kommt nicht alles auf einmal zurück:
            Eine Lampe hat Strom, lange bevor Switch, Accesspoint und
            Bridge wieder stehen. Der Ablauf läuft deshalb noch einmal,
            sobald eines seiner Geräte auftaucht - bis zu zehn Minuten
            lang. Wer währenddessen von Hand Licht macht, behält es.
          </Text>
        </>
      ) : trigger.kind === 'availability' ? (
        <>
          <EntityPicker
            entities={entities}
            value={trigger.entityId}
            onSelect={(entityId) => onChange({ entityId })}
          />
          <Choice
            options={[
              { key: 'weg', label: 'verstummt' },
              { key: 'wieder-da', label: 'ist wieder da' },
            ]}
            value={trigger.availabilityTo}
            onSelect={(availabilityTo) =>
              onChange({ availabilityTo: availabilityTo as TriggerDraft['availabilityTo'] })
            }
          />
          <MinutenWahl
            options={[
              { key: '', label: 'sofort' },
              { key: '10', label: 'seit 10 Min.' },
              { key: '60', label: 'seit 1 Std.' },
              { key: '1440', label: 'seit 1 Tag' },
            ]}
            value={trigger.forMinutes}
            onChange={(forMinutes) => onChange({ forMinutes })}
            placeholder="Minuten, z.B. 180"
          />
          <Text style={styles.triggerNote}>
            Löst aus, wenn das Gerät {trigger.availabilityTo === 'weg'
              ? 'nicht mehr antwortet'
              : 'sich zurückmeldet'} – etwa bei leerer Batterie oder
            gestörtem Funk. Der Wächter schickt dafür nur eine
            Push-Nachricht; hiermit kann man es sich auch ansagen lassen.
          </Text>
        </>
      ) : trigger.kind === 'geofence' ? (
        <>
          <EntityPicker
            // Ohne die Sammelanwesenheit: Sie ist keine Person und war
            // nie an einem Ort. «Jemand zuhause kommt bei Off an» war der
            // Satz, der dabei herauskam. Sie steht unter «Gerät wechselt»
            // mit «jemand/niemand ist zuhause» – dort gehört sie hin.
            entities={entities.filter((entity) => istOrtsmelder(entity.id))}
            value={trigger.entityId}
            onSelect={(entityId) => onChange({ entityId })}
          />
          <Choice
            options={[
              { key: 'home', label: 'kommt an' },
              { key: 'away', label: 'geht weg' },
            ]}
            value={trigger.toState === 'away' ? 'away' : 'home'}
            onSelect={(toState) => onChange({ toState })}
          />
          {ortsWahl.length > 1 ? (
            <Choice
              options={ortsWahl}
              value={trigger.ortId || ZUHAUSE}
              onSelect={(ortId) => onChange({ ortId })}
            />
          ) : null}
          <Text style={styles.triggerNote}>
            {trigger.ortId && trigger.ortId !== ZUHAUSE
              ? 'Die Orte kommen aus dem Hub und aus Life360 – dort angelegte ' +
                'Orte erscheinen hier von selbst.'
              : 'Wer meldet, steht unter System → Integrationen. Läuft Life360, ' +
                'kommt die Meldung von dort; sonst vom Telefon selbst.'}
          </Text>
          <MinutenWahl
            options={[
              { key: '', label: 'sofort' },
              { key: '5', label: 'bleibt 5 Min. so' },
              { key: '10', label: 'bleibt 10 Min. so' },
              { key: '30', label: 'bleibt 30 Min. so' },
            ]}
            value={trigger.forMinutes}
            onChange={(forMinutes) => onChange({ forMinutes })}
            placeholder="Minuten, z.B. 45"
          />
          {trigger.forMinutes ? (
            <Text style={styles.triggerNote}>
              Löst erst aus, wenn der Zustand {trigger.forMinutes} Minuten
              bestehen bleibt - der kurze Gang zum Briefkasten zählt so
              nicht als «alle weg».
            </Text>
          ) : null}
        </>
      ) : trigger.kind === 'presence' ? (
        <>
          <Choice
            options={anwesenheitsPersonen(entities).map((person) => ({
              key: person.zone,
              label: person.name,
            }))}
            value={trigger.presencePerson}
            onSelect={(presencePerson) => onChange({ presencePerson })}
          />
          <Choice
            options={[
              { key: 'arrives', label: 'kommt an' },
              { key: 'leaves', label: 'geht weg' },
            ]}
            value={trigger.presenceEvent}
            onSelect={(presenceEvent) =>
              onChange({
                presenceEvent: presenceEvent as TriggerDraft['presenceEvent'],
              })
            }
          />
          {ortsWahl.length > 1 ? (
            <Choice
              options={ortsWahl}
              value={trigger.ortId || ZUHAUSE}
              onSelect={(ortId) => onChange({ ortId })}
            />
          ) : null}
          <Text style={styles.triggerNote}>
            Feuert beim echten Kommen oder Gehen – die Meldewelle nach
            einem Hub-Neustart («unbekannt → zuhause») löst nicht aus.
            Ohne Ortswahl zählt das Zuhause. Anders als der Ort-Auslöser
            hört er auch auf Ankünfte, die ein Ablauf oder ein Knopf
            meldet («Anwesenheit melden»), nicht nur aufs Telefon.
          </Text>
        </>
      ) : trigger.kind === 'weather_warning' ? (
        <>
          <Choice
            options={WARNSTUFEN_WAHL}
            value={trigger.minSeverity}
            onSelect={(minSeverity) => onChange({ minSeverity })}
          />
          {/* Bei mehreren Warn-Geräten (zwei Länder im Feed) lässt sich
              eines wählen; bei einem wäre die Auswahl eine ohne Wahl. */}
          {entities.filter((entity) => entity.kind === 'alert').length > 1 ? (
            <EntityPicker
              entities={entities.filter((entity) => entity.kind === 'alert')}
              noneLabel="Jedes Warn-Gerät"
              value={trigger.entityId}
              onSelect={(entityId) => onChange({ entityId })}
            />
          ) : null}
          <Text style={styles.triggerNote}>
            Feuert für jede Warnung, die neu dazukommt – nicht bei jeder
            Feed-Runde erneut. Eine Warnung ohne Stufe zählt mit: Bei
            Unwetter ist «eine zu viel» der billigere Fehler als eine
            unterschlagene.
          </Text>
        </>
      ) : trigger.kind === 'threshold' ? (
        <>
          <EntityPicker
            entities={entities}
            value={trigger.entityId}
            onSelect={(entityId) => onChange({ entityId })}
          />
          <TextInput
            style={styles.input}
            value={trigger.attribute}
            onChangeText={(attribute) => onChange({ attribute })}
            placeholder="Feld, z.B. power oder temperature (leer = state)"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
          />
          <View style={styles.rowGap}>
            <Choice
              options={[
                { key: 'above', label: 'steigt über' },
                { key: 'below', label: 'fällt unter' },
              ]}
              value={trigger.thresholdOp}
              onSelect={(thresholdOp) =>
                onChange({ thresholdOp: thresholdOp as TriggerDraft['thresholdOp'] })
              }
            />
          </View>
          <TextInput
            style={styles.input}
            value={trigger.thresholdValue}
            onChangeText={(thresholdValue) => onChange({ thresholdValue })}
            placeholder="5"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.triggerNote}>
            Löst beim Übertritt aus, nicht bei jeder Schwankung darunter: Der
            Tumbler ist fertig, wenn die Leistung von über 5 W auf unter 5 W
            fällt – nicht jedes Mal, wenn 2.1 W zu 2.0 W wird.
          </Text>
          <MinutenWahl
            options={[
              { key: '', label: 'sofort' },
              { key: '5', label: 'bleibt 5 Min. so' },
              { key: '10', label: 'bleibt 10 Min. so' },
              { key: '30', label: 'bleibt 30 Min. so' },
            ]}
            value={trigger.forMinutes}
            onChange={(forMinutes) => onChange({ forMinutes })}
            placeholder="Minuten, z.B. 45"
          />
          {trigger.forMinutes ? (
            <Text style={styles.triggerNote}>
              Löst erst aus, wenn der Zustand {trigger.forMinutes} Minuten
              bestehen bleibt - der kurze Gang zum Briefkasten zählt so
              nicht als «alle weg».
            </Text>
          ) : null}
        </>
      ) : trigger.kind === 'interval' ? (
        <>
          <Choice
            options={[
              { key: '300', label: '5 Min.' },
              { key: '600', label: '10 Min.' },
              { key: '1800', label: '30 Min.' },
              { key: '3600', label: '1 Std.' },
            ]}
            value={trigger.intervalSeconds}
            onSelect={(intervalSeconds) => onChange({ intervalSeconds })}
          />
          <Text style={styles.triggerNote}>
            Läuft immer wieder, unabhängig von einem Gerät. Sinnvoll mit einer
            Bedingung davor – sonst passiert es rund um die Uhr.
          </Text>
        </>
      ) : trigger.kind === 'calendar' ? (
        <>
          <TextInput
            style={styles.input}
            value={trigger.calendarContains}
            onChangeText={(calendarContains) => onChange({ calendarContains })}
            placeholder="Wort im Termin-Titel, z.B. Abfuhr (leer = jeder)"
            placeholderTextColor={colors.inkFaint}
          />
          <Choice
            options={[
              { key: 'start', label: 'wenn er beginnt' },
              { key: 'end', label: 'wenn er endet' },
            ]}
            value={trigger.calendarEvent}
            onSelect={(calendarEvent) =>
              onChange({ calendarEvent: calendarEvent as 'start' | 'end' })
            }
          />
          <Choice
            options={[
              { key: '', label: 'pünktlich' },
              { key: '60', label: '1 Std vorher' },
              { key: '720', label: '12 Std vorher' },
              { key: '1440', label: '1 Tag vorher' },
            ]}
            value={trigger.calendarBefore}
            onSelect={(calendarBefore) => onChange({ calendarBefore })}
          />
          <Text style={styles.triggerNote}>
            Hört auf den angebundenen Kalender: «Abfuhr» mit 12 Std Vorlauf
            ist die Erinnerung am Vorabend, ein Termin «Ferien» kann den
            Ferienmodus scharf schalten.
          </Text>
        </>
      ) : (
        <TextInput
          style={styles.input}
          value={trigger.at}
          onChangeText={(at) => onChange({ at })}
          placeholder="18:30"
          placeholderTextColor={colors.inkFaint}
        />
      )}
      {trigger.kind === 'time' || trigger.kind === 'sun' ? (
        <>
          <TextInput
            style={styles.input}
            value={trigger.jitter}
            onChangeText={(jitter) => onChange({ jitter })}
            placeholder="± Minuten zufällig (leer = pünktlich)"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numeric"
          />
          {Number(trigger.jitter) > 0 ? (
            <Text style={styles.triggerNote}>
              Jeden Tag neu gewürfelt, bis {Math.min(240, Number(trigger.jitter))} Min
              früher oder später – Storen, die aufs Sekundengleiche fahren,
              verraten jedem Beobachter die Zeitschaltuhr.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * Die Aktionsliste: nacheinander abgearbeitete Schritte.
 *
 * Vorher gab es genau eine Aktionsart je Ablauf. «Licht an, zwei Minuten
 * warten, Nachricht schicken» brauchte deshalb drei Abläufe, die sich
 * gegenseitig auslösen – und beim Ändern musste man alle drei finden.
 *
 * Auf Modulebene und nicht im Editor verschachtelt: Eine dort definierte
 * Komponente wäre bei jedem Tastendruck eine neue und würde das
 * Eingabefeld beim Tippen jedes Mal neu aufbauen.
 */
/** Die Knöpfe «+ Raum» und «+ Gerät» unter einem Feld.
 *
 * Zweimal dieselbe Zeile - einmal unter dem Titel, einmal unter dem Text
 * -, damit beide Felder gleich bedienbar sind. Der Hub ersetzt die
 * Platzhalter ohnehin in beiden; nur anklicken liess sich vorher bloss
 * eines von beiden. */
function PlatzhalterZeile({
  feld,
  onAnhaengen,
  styles,
}: {
  /** Wie das Feld heisst - nur für die Vorlesehilfe. */
  feld: string;
  onAnhaengen: (halter: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.choices}>
      {PLATZHALTER.map((halter) => (
        <Pressable
          key={halter.key}
          onPress={() => onAnhaengen(halter.key)}
          accessibilityRole="button"
          accessibilityLabel={`${halter.label} in den ${feld} einfügen`}
          style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.templateText}>{halter.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StepList({
  steps,
  entities,
  scenes,
  andereAblaeufe = [],
  eigeneId,
  hueScenes,
  favoriten,
  empfaenger = [],
  luxSensors = [],
  onProbeStep,
  colors,
  styles,
  tiefe = 1,
  onChange,
}: {
  steps: StepDraft[];
  entities: Entity[];
  scenes: Scene[];
  /** Die übrigen Abläufe – für den Hinweis «das schaltet auch …». */
  andereAblaeufe?: { id: string; alias: string }[];
  /** Der eigene Ablauf: Ohne ihn meldete er sich selbst als Mitschalter. */
  eigeneId?: string;
  hueScenes: string[];
  favoriten: string[];
  /** Die Melder dieses Ablaufs, die Helligkeit messen – daraus wird die
   *  Wahl «an Helligkeit angepasst» bei den Lampen. Leer heisst: kein
   *  Auslöser misst Lux, und die Wahl bleibt weg. */
  luxSensors?: Entity[];
  /** Mögliche Nachricht-Empfänger (Punkt 158); leer = keine Auswahl. */
  empfaenger?: string[];
  /** Genau diesen einen Schritt ausführen (Punkt 164) - so, wie er
   *  gerade dasteht, auch ungespeichert. */
  onProbeStep?: (step: StepDraft) => Promise<boolean>;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  /** Wie tief diese Liste steckt: 1 = die Hauptliste, darunter die
   *  Zweige von «Wenn …» und «Wiederholen». Ab MAX_SCHACHTELUNG bietet
   *  die Liste keine weiteren Kontroll-Schritte an - der Hub führte sie
   *  nicht aus, und ein Chip, der ins Leere baut, wäre eine Falle. */
  tiefe?: number;
  onChange: (steps: StepDraft[]) => void;
}) {
  // Welcher Schritt gerade probiert wurde - für das kurze Häkchen.
  const [probiert, setProbiert] = useState<number | null>(null);
  const setStep = (index: number, patch: Partial<StepDraft>) =>
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));
  // «Licht an, warten, Licht aus» für den zweiten Flur tippte man bisher
  // neu – ein Ablauf liess sich kopieren, ein Schritt nicht. Die Kopie
  // ist tief (entwurf.kopieSchritt): «Wenn …» und «Wiederholen» tragen
  // ganze Unterlisten, flach kopiert teilte man sie mit dem Original.
  const copy = (index: number) => {
    onChange([
      ...steps.slice(0, index + 1),
      kopieSchritt(steps[index]),
      ...steps.slice(index + 1),
    ]);
  };
  const kontrolleErlaubt = tiefe <= MAX_SCHACHTELUNG;
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  // Was zu einem `if` oder `repeat` gehört, rückt ein (Punkt 316 der
  // Werkbank). Ohne das steht ein fünfschrittiger Ablauf als flache
  // Liste da, und man sieht nicht, was zur Bedingung gehört und was
  // danach kommt - beim Lesen einer fremden Automation ist das der
  // Unterschied zwischen «verstanden» und «nachbauen».
  const einrueckung = tiefen(steps);

  return (
    <>
      {steps.map((step, index) => (
        <View
          key={index}
          style={{
            ...styles.stepBox,
            marginLeft: einrueckung[index] * 16,
            ...(einrueckung[index] > 0
              ? { borderLeftWidth: 2, borderLeftColor: colors.accent }
              : {}),
          }}
        >
          <View style={styles.stepHead}>
            <Text style={styles.stepNumber}>{index + 1}.</Text>
            <View style={{ flex: 1 }} />
            {steps.length > 1 ? (
              <>
                <Pressable
                  onPress={() => move(index, -1)}
                  accessibilityLabel="Nach oben"
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-up"
                    size={18}
                    color={index === 0 ? colors.inkFaint : colors.ink}
                  />
                </Pressable>
                <Pressable
                  onPress={() => move(index, 1)}
                  accessibilityLabel="Nach unten"
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={index === steps.length - 1 ? colors.inkFaint : colors.ink}
                  />
                </Pressable>
              </>
            ) : null}
            {/* «Wenn …» und «Wiederholen» sind wie das Warten vom
                Einzel-Probelauf ausgenommen: Sie prüfen live Bedingungen
                bzw. drehen Runden - das ist kein Einzelschritt mehr,
                dafür gibt es «Jetzt testen». */}
            {onProbeStep &&
            !['delay', 'wait_until', 'if', 'repeat'].includes(step.kind) ? (
              // Punkt 164: die eine Durchsage, die eine Nachricht
              // ausprobieren, ohne dass die Storen mitfahren - und ohne
              // vorher speichern zu müssen.
              <Pressable
                onPress={async () => {
                  if ((await onProbeStep(step)) === true) {
                    setProbiert(index);
                    setTimeout(() => setProbiert(null), 2500);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Nur diesen Schritt jetzt ausführen"
                hitSlop={8}
              >
                <Ionicons
                  name={probiert === index ? 'checkmark' : 'play-outline'}
                  size={17}
                  color={probiert === index ? colors.on : colors.inkSoft}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => copy(index)}
              accessibilityRole="button"
              accessibilityLabel="Schritt kopieren"
              hitSlop={8}
            >
              <Ionicons name="copy-outline" size={17} color={colors.inkSoft} />
            </Pressable>
            <Pressable
              onPress={() => remove(index)}
              accessibilityLabel="Schritt entfernen"
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>

          <Kachelauswahl
            options={[
              { key: 'command', label: 'Gerät schalten', icon: STEP_KIND_ICON.command },
              // Ein Wandtaster, zwei Räume, ein Zustand (siehe unten).
              {
                key: 'toggle_all',
                label: 'Gemeinsam umschalten',
                icon: STEP_KIND_ICON.toggle_all,
              },
              { key: 'scene', label: 'Szene', icon: STEP_KIND_ICON.scene },
              ...(hueScenes.length > 0
                ? [{ key: 'hue_scene', label: 'Hue-Szene', icon: STEP_KIND_ICON.hue_scene }]
                : []),
              { key: 'notify', label: 'Nachricht', icon: STEP_KIND_ICON.notify },
              ...(entities.some((entity) => entity.commands.includes('play_url'))
                ? [{ key: 'broadcast', label: 'Durchsage', icon: STEP_KIND_ICON.broadcast }]
                : []),
              // «X ist da» ohne Telefon - nur, wo es überhaupt Personen
              // gibt, für die sich das melden liesse.
              ...(anwesenheitsPersonen(entities).length > 0
                ? [
                    {
                      key: 'presence',
                      label: 'Anwesenheit melden',
                      icon: STEP_KIND_ICON.presence,
                    },
                  ]
                : []),
              // Dimmen über Zeit (Punkt 157) - nur wenn eine Lampe die
              // Helligkeit überhaupt kann.
              ...(entities.some((entity) => entity.commands.includes('set_brightness'))
                ? [{ key: 'fade', label: 'Dimmen', icon: STEP_KIND_ICON.fade }]
                : []),
              // Musik-Schritte: Favorit, Schlummer, überall Pause,
              // Nachtruhe. Nur, wo es überhaupt eine Box gibt.
              ...(entities.some((entity) => entity.kind === 'media_player')
                ? [{ key: 'music', label: 'Musik', icon: STEP_KIND_ICON.music }]
                : []),
              { key: 'delay', label: 'Warten', icon: STEP_KIND_ICON.delay },
              { key: 'wait_until', label: 'Warten bis', icon: STEP_KIND_ICON.wait_until },
              // Kontrollfluss (Punkt 251). In der tiefsten Ebene nur
              // dann anbieten, wenn der Schritt schon so heisst - sonst
              // stünde ein gespeicherter Schritt ohne seinen Chip da.
              ...(kontrolleErlaubt || step.kind === 'if'
                ? [{ key: 'if', label: 'Wenn …', icon: STEP_KIND_ICON.if }]
                : []),
              ...(kontrolleErlaubt || step.kind === 'repeat'
                ? [{ key: 'repeat', label: 'Wiederholen', icon: STEP_KIND_ICON.repeat }]
                : []),
            ]}
            value={step.kind}
            onSelect={(kind) =>
              setStep(index, {
                kind: kind as StepKind,
                // Ein frischer Zweig beginnt mit einem leeren Schritt -
                // eine leere Unterliste sähe aus wie ein fertiger Block,
                // der nichts tut.
                ...(kind === 'if' && step.ifThen.length === 0
                  ? { ifThen: [{ ...EMPTY_STEP }] }
                  : {}),
                ...(kind === 'repeat' && step.repeatSteps.length === 0
                  ? { repeatSteps: [{ ...EMPTY_STEP }] }
                  : {}),
              })
            }
          />

          {step.kind === 'command' ? (
            <>
              <SceneDevices
                entities={entities}
                actions={step.commandActions}
                onActions={(commandActions) => setStep(index, { commandActions })}
                showSnapshot={false}
                allowToggle
                luxSensors={luxSensors}
              />
              {/* Der Hub meldet Widersprüche erst hinterher, als Liste
                  unter «Abläufe». Da steht der neue Ablauf längst und
                  schaltet nachts gegen einen anderen an. Hier steht der
                  Hinweis, während man ihn baut - und zwar der milde. */}
              {(() => {
                const namen = mitschalter(
                  step.commandActions.map((aktion) => aktion.entity_id),
                  andereAblaeufe,
                  eigeneId
                ).map((ablauf) => ablauf.alias);
                const satz = mitschalterSatz(namen);
                return satz ? <Text style={styles.triggerNote}>{satz}</Text> : null;
              })()}
            </>
          ) : step.kind === 'toggle_all' ? (
            <>
              <SceneDevices
                entities={entities}
                actions={step.commandActions}
                onActions={(commandActions) => setStep(index, { commandActions })}
                showSnapshot={false}
                nurAuswahl
              />
              <Text style={styles.triggerNote}>
                Alle zusammen an – und beim nächsten Druck alle zusammen aus.
                Ist gerade eines an und eines aus, gehen erst einmal alle an:
                Wer im Dunkeln drückt, will Licht. Einzelnes «umschalten»
                ergäbe hier das Gegenteil, weil jede Lampe für sich kippt.
              </Text>
            </>
          ) : step.kind === 'scene' ? (
            <Picker
              items={scenes.map((scene) => ({ key: scene.id, label: scene.name }))}
              placeholder="Szene suchen …"
              value={step.sceneId}
              onSelect={(sceneId) => setStep(index, { sceneId })}
            />
          ) : step.kind === 'hue_scene' ? (
            <>
              <Picker
                items={hueScenes.map((name) => ({ key: name, label: name }))}
                placeholder="Hue-Szene suchen …"
                value={step.hueScene}
                onSelect={(hueScene) => setStep(index, { hueScene })}
              />
              <Text style={styles.triggerNote}>
                Die Szene liegt auf der Hue-Bridge – Farben und Helligkeiten
                stecken dort, und nur sie kann alles in einem Zug setzen.
                Geändert wird sie in der Hue-App.
              </Text>
            </>
          ) : step.kind === 'notify' ? (
            <>
              <TextInput
                style={styles.input}
                value={step.title}
                onChangeText={(title) => setStep(index, { title })}
                placeholder="Titel"
                placeholderTextColor={colors.inkFaint}
              />
              {/* Platzhalter statt fünf fast gleicher Abläufe: «Jemand
                  weint im Zimmer {raum}» gilt für alle Kinderzimmer, wenn
                  alle Melder Auslöser desselben Ablaufs sind.
                  Auch beim Titel: Der Hub setzt sie dort genauso ein, und
                  «Bewegung im {raum}» ist genau die Zeile, die man auf
                  dem Sperrbildschirm liest - der Text darunter oft gar
                  nicht. Zum Antippen statt von Hand getippt. */}
              <PlatzhalterZeile
                feld="Titel"
                onAnhaengen={(halter) =>
                  setStep(index, { title: `${step.title}${halter}` })
                }
                styles={styles}
              />
              <TextInput
                style={styles.input}
                value={step.body}
                onChangeText={(body) => setStep(index, { body })}
                placeholder="Text"
                placeholderTextColor={colors.inkFaint}
              />
              <PlatzhalterZeile
                feld="Text"
                onAnhaengen={(halter) =>
                  setStep(index, { body: `${step.body}${halter}` })
                }
                styles={styles}
              />
              {/* Punkt 251: Auch Gerätewerte dürfen in den Text - «Die
                  Waschküche hat {sensor.temp} Grad». Die Kennung tippt
                  niemand fehlerfrei ab, darum wird sie zusammengeklickt. */}
              <GeraetewertZeile
                entities={entities}
                feld="Text"
                onEinsetzen={(halter) =>
                  setStep(index, { body: `${step.body}${halter}` })
                }
                colors={colors}
                styles={styles}
              />
              <Text style={styles.triggerNote}>
                Platzhalter setzt der Hub beim Auslösen ein – in Titel und
                Text: {'{raum}'} und {'{gerät}'} nennen den Melder, {'{time}'}{' '}
                die Uhrzeit, ein Gerätewert wie {'{sensor.temperature}'} den
                Messwert von genau dann. Unbekanntes bleibt wörtlich stehen
                – ein Tippfehler ist so auf einen Blick zu sehen.
              </Text>
              {empfaenger.length > 1 ? (
                // Punkt 158: «Waschmaschine fertig» muss nicht das ganze
                // Haus wecken - der Hub kannte das to-Feld längst, nur
                // der Editor bot es nicht an.
                <Choice
                  options={[
                    { key: '', label: 'An alle' },
                    ...empfaenger.map((name) => ({ key: name, label: name })),
                  ]}
                  value={step.notifyTo}
                  onSelect={(notifyTo) => setStep(index, { notifyTo })}
                />
              ) : null}
              {/* «Die des Auslösers» steht vor der Geräteliste: Wer
                  mehrere Kameras in einem Ablauf hat, meint fast immer
                  die, die gerade etwas gesehen hat. */}
              <Choice
                options={[
                  { key: '', label: 'Kamera wählen' },
                  { key: KAMERA_AUSLOESER, label: 'die des Auslösers' },
                ]}
                value={step.notifyCamera === KAMERA_AUSLOESER ? KAMERA_AUSLOESER : ''}
                onSelect={(key) =>
                  setStep(index, {
                    notifyCamera: key === KAMERA_AUSLOESER ? KAMERA_AUSLOESER : '',
                  })
                }
              />
              {step.notifyCamera !== KAMERA_AUSLOESER ? (
                <EntityPicker
                  entities={entities.filter((entity) => entity.kind === 'camera')}
                  noneLabel="Kein Bild"
                  placeholder="Kamera suchen …"
                  value={step.notifyCamera}
                  onSelect={(notifyCamera) => setStep(index, { notifyCamera })}
                />
              ) : null}
              {/* Wann gemeldet wird - der gemeldete Fall: «Jemand hat
                  die Türe geöffnet», und auf dem Bild steht niemand.
                  Der Kontakt meldet, während die Person noch hinter der
                  Türe ist. Das Bild entsteht beim Senden, wartet also
                  mit; alles nach diesem Schritt läuft trotzdem sofort
                  weiter. */}
              <Choice
                options={[
                  { key: '0', label: 'Sofort' },
                  { key: '3', label: 'Nach 3 s' },
                  { key: '5', label: 'Nach 5 s' },
                  { key: '10', label: 'Nach 10 s' },
                ]}
                value={String(step.notifyVerzoegerung ?? 0)}
                onSelect={(key) =>
                  setStep(index, { notifyVerzoegerung: Number(key) || 0 })
                }
              />
              {step.notifyVerzoegerung > 0 ? (
                <Text style={styles.triggerNote}>
                  Die Nachricht geht {step.notifyVerzoegerung} Sekunden nach dem
                  Auslöser raus – und das Bild entsteht erst dann. Genau dafür
                  ist es da: Ein Türkontakt meldet, während die Person noch
                  hinter der Türe ist. Der Rest des Ablaufs wartet nicht mit.
                </Text>
              ) : null}
              <NachrichtenZiel
                ziel={step.notifyZiel}
                onZiel={(notifyZiel) => setStep(index, { notifyZiel })}
                knoepfe={step.notifyKnoepfe ?? []}
                onKnoepfe={(notifyKnoepfe) => setStep(index, { notifyKnoepfe })}
                entities={entities}
                scenes={scenes}
                colors={colors}
                styles={styles}
              />
              <Text style={styles.triggerNote}>
                {step.notifyCamera === KAMERA_AUSLOESER
                  ? 'Das Bild kommt von der Kamera, die ausgelöst hat – ist der Auslöser keine Kamera, von einer im selben Raum. Findet sich keine, geht die Nachricht ohne Bild raus.'
                  : 'Mit einer Kamera zeigt die Nachricht gleich das Bild von diesem Moment – praktisch, wenn es klingelt.'}{' '}
                Dafür muss in der config.yaml des Hubs unter „push“ eine von
                aussen erreichbare Adresse stehen, sonst kommt die Nachricht
                ohne Bild an. Auf dem iPhone braucht es zusätzlich einen
                eigenen App-Build (siehe docs/eigener-app-build.md).
              </Text>
            </>
          ) : step.kind === 'presence' ? (
            <>
              <Text style={styles.triggerNote}>
                Für alle, die kein Telefon tragen: Ein Knopf am
                Schlüsselanhänger oder ein eigener Code am Türschloss meldet
                die Ankunft an ihrer Stelle. Danach gilt die Person als
                zuhause – und der Heimkomm-Ablauf läuft wie bei allen
                anderen.
              </Text>
              <Choice
                options={anwesenheitsPersonen(entities).map((person) => ({
                  key: person.zone,
                  label: person.name,
                }))}
                value={step.presenceZone}
                onSelect={(presenceZone) => setStep(index, { presenceZone })}
              />
              <Choice
                options={[
                  { key: 'enter', label: 'ist zuhause' },
                  { key: 'weg', label: 'ist weg' },
                ]}
                value={step.presenceEvent === 'leave' ? 'weg' : 'enter'}
                onSelect={(wahl) =>
                  setStep(index, {
                    presenceEvent: wahl === 'weg' ? 'leave' : 'enter',
                  })
                }
              />
              {step.presenceEvent === 'leave' ? (
                <Text style={styles.triggerNote}>
                  «Ist weg» wird überhört, solange ein Telefon dieselbe Person
                  meldet: Das Ankommen darf jeder melden, das Weggehen nur die
                  führende Quelle. Sonst schaltete ein Knopf in der Hosentasche
                  das Haus ab, während jemand darin sitzt.
                </Text>
              ) : null}
            </>
          ) : step.kind === 'broadcast' ? (
            <>
              <TextInput
                style={styles.input}
                value={step.broadcastText}
                onChangeText={(broadcastText) => setStep(index, { broadcastText })}
                placeholder="Essen ist fertig!"
                placeholderTextColor={colors.inkFaint}
                maxLength={200}
              />
              {/* Punkt 251: Uhrzeit und Gerätewerte auch in der
                  Durchsage - «Es ist {time}, die Türe steht offen».
                  {raum}/{gerät} gibt es hier nicht: Die füllt nur die
                  Nachricht, und ein Chip, der wörtlich stehen bliebe,
                  wäre eine Attrappe. */}
              <View style={styles.choices}>
                <Pressable
                  onPress={() =>
                    setStep(index, {
                      broadcastText: `${step.broadcastText}{time}`,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Die Uhrzeit in die Durchsage einfügen"
                  style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
                >
                  <Text style={styles.templateText}>+ Uhrzeit</Text>
                </Pressable>
              </View>
              <GeraetewertZeile
                entities={entities}
                feld="Durchsage-Text"
                onEinsetzen={(halter) =>
                  setStep(index, {
                    broadcastText: `${step.broadcastText}${halter}`,
                  })
                }
                colors={colors}
                styles={styles}
              />
              {entities.filter((entity) => entity.commands.includes('play_url'))
                .length > 1 ? (
                <Choice
                  multi
                  options={entities
                    .filter((entity) => entity.commands.includes('play_url'))
                    .map((entity) => ({ key: entity.id, label: entity.name }))}
                  values={step.broadcastSpeakers}
                  onSelect={(id) =>
                    setStep(index, {
                      broadcastSpeakers: step.broadcastSpeakers.includes(id)
                        ? step.broadcastSpeakers.filter((entry) => entry !== id)
                        : [...step.broadcastSpeakers, id],
                    })
                  }
                />
              ) : null}
              <Text style={styles.triggerNote}>
                Der Text wird auf den Cast-Boxen vorgelesen - ohne Auswahl
                auf allen. {'{time}'} und Gerätewerte setzt der Hub beim
                Auslösen ein; Unbekanntes bleibt wörtlich stehen. Braucht
                Internet (Sprachausgabe) und dass die App den Hub
                mindestens einmal erreicht hat.
              </Text>
            </>
          ) : step.kind === 'fade' ? (
            <>
              <EntityPicker
                entities={entities.filter((entity) =>
                  entity.commands.includes('set_brightness')
                )}
                value={step.fadeEntityId}
                placeholder="Lampe suchen …"
                onSelect={(fadeEntityId) => setStep(index, { fadeEntityId })}
              />
              <Choice
                options={[
                  { key: '0', label: 'ausglimmen (0 %)' },
                  { key: '30', label: 'auf 30 %' },
                  { key: '60', label: 'auf 60 %' },
                  { key: '100', label: 'auf 100 %' },
                ]}
                value={step.fadeTo}
                onSelect={(fadeTo) => setStep(index, { fadeTo })}
              />
              <Choice
                options={[
                  { key: '5', label: 'über 5 Min' },
                  { key: '10', label: 'über 10 Min' },
                  { key: '20', label: 'über 20 Min' },
                  { key: '30', label: 'über 30 Min' },
                ]}
                value={step.fadeMinutes}
                onSelect={(fadeMinutes) => setStep(index, { fadeMinutes })}
              />
              <Text style={styles.triggerNote}>
                {Number(step.fadeTo) > 0
                  ? 'Aufwachlicht: Die Lampe geht dunkel an und wird gleichmässig heller - eine halbe Stunde vor dem Wecker gestartet, weckt sie sanfter als jeder Ton.'
                  : 'Ausglimmen statt knipsen: Das Licht wird über die gewählte Zeit dunkler und geht am Ende aus - fürs Kinderzimmer am Abend.'}
              </Text>
            </>
          ) : step.kind === 'music' ? (
            <>
              <Choice
                options={[
                  { key: 'pause_all', label: 'Überall Pause' },
                  { key: 'favorite', label: 'Favorit spielen' },
                  { key: 'sleep', label: 'Schlummer' },
                  { key: 'fade', label: 'Leise starten' },
                  { key: 'night', label: 'Nachtruhe' },
                  { key: 'follow', label: 'Musik folgt' },
                ]}
                value={step.musikTat}
                onSelect={(musikTat) =>
                  setStep(index, { musikTat: musikTat as StepDraft['musikTat'] })
                }
              />
              {step.musikTat === 'favorite' ? (
                <>
                  <Picker
                    items={favoriten.map((name) => ({ key: name, label: name }))}
                    placeholder="Favorit suchen …"
                    value={step.musikFavorit}
                    onSelect={(musikFavorit) => setStep(index, { musikFavorit })}
                  />
                  <Text style={styles.triggerNote}>
                    Favoriten legst du unter Lautsprecher an – dort steht auch,
                    auf welcher Box ein Favorit läuft.
                  </Text>
                </>
              ) : step.musikTat === 'night' ? (
                <>
                  <Choice
                    options={[
                      { key: 'an', label: 'Nachtruhe ein' },
                      { key: 'aus', label: 'Nachtruhe aus' },
                    ]}
                    value={step.musikAn ? 'an' : 'aus'}
                    onSelect={(wert) => setStep(index, { musikAn: wert === 'an' })}
                  />
                  <Text style={styles.triggerNote}>
                    Der Deckel gilt zwischen den Uhrzeiten, die unter
                    Lautsprecher stehen. Hier wird er nur ein- und
                    ausgeschaltet.
                  </Text>
                </>
              ) : step.musikTat === 'pause_all' ? (
                <Text style={styles.triggerNote}>
                  Pause auf jeder Box, auf der etwas läuft – nicht «aus». Eine
                  Box, die pausiert, weiss noch, wo sie war.
                </Text>
              ) : step.musikTat === 'follow' ? (
                <>
                  <EntityPicker
                    entities={entities.filter(
                      (entity) =>
                        entity.kind === 'media_player' &&
                        entity.commands.includes('set_volume')
                    )}
                    value={step.musikEntityId}
                    placeholder="Woher – Box suchen …"
                    onSelect={(musikEntityId) => setStep(index, { musikEntityId })}
                  />
                  <EntityPicker
                    entities={entities.filter(
                      (entity) =>
                        entity.kind === 'media_player' &&
                        entity.commands.includes('set_volume') &&
                        entity.id !== step.musikEntityId
                    )}
                    value={step.musikZiel}
                    placeholder="Wohin – Box suchen …"
                    onSelect={(musikZiel) => setStep(index, { musikZiel })}
                  />
                  <Text style={styles.triggerNote}>
                    Übernimmt den Radiosender von der ersten Box auf die
                    zweite und pausiert die erste - eine Playlist oder ein
                    Streaming-Dienst lässt sich so nicht ehrlich fortsetzen
                    und bleibt darum unangetastet.
                  </Text>
                </>
              ) : (
                <>
                  <EntityPicker
                    entities={entities.filter(
                      (entity) =>
                        entity.kind === 'media_player' &&
                        entity.commands.includes('set_volume')
                    )}
                    value={step.musikEntityId}
                    placeholder="Box suchen …"
                    onSelect={(musikEntityId) => setStep(index, { musikEntityId })}
                  />
                  {step.musikTat === 'sleep' ? (
                    <>
                      <Choice
                        options={[
                          { key: '15', label: 'nach 15 Min' },
                          { key: '30', label: 'nach 30 Min' },
                          { key: '60', label: 'nach 60 Min' },
                          { key: '90', label: 'nach 90 Min' },
                        ]}
                        value={step.musikMinuten}
                        onSelect={(musikMinuten) => setStep(index, { musikMinuten })}
                      />
                      <Text style={styles.triggerNote}>
                        Die letzten dreissig Sekunden blendet der Hub aus – Musik,
                        die mitten im Takt abbricht, weckt eher, als dass sie
                        einschlafen lässt.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Choice
                        options={[
                          { key: '20', label: 'bis 20 %' },
                          { key: '30', label: 'bis 30 %' },
                          { key: '45', label: 'bis 45 %' },
                          { key: '60', label: 'bis 60 %' },
                        ]}
                        value={step.musikLautstaerke}
                        onSelect={(musikLautstaerke) =>
                          setStep(index, { musikLautstaerke })
                        }
                      />
                      <Text style={styles.triggerNote}>
                        Erst starten, dann von Null hochziehen – eine Box, die
                        um sieben Uhr mit 60 % losbrüllt, weckt falsch.
                      </Text>
                    </>
                  )}
                </>
              )}
            </>
          ) : step.kind === 'if' ? (
            <>
              <Text style={styles.triggerNote}>
                Verzweigt mitten im Ablauf: Passen die Bedingungen in dem
                Moment, in dem dieser Schritt dran ist, laufen die
                Dann-Schritte, sonst die Sonst-Schritte – danach geht der
                Ablauf normal weiter.
              </Text>
              <BedingungsListe
                conditions={step.ifConditions}
                entities={entities}
                hinzufuegenText="Bedingung hinzufügen"
                onChange={(ifConditions) => setStep(index, { ifConditions })}
                colors={colors}
                styles={styles}
              />
              {(step.ifExtra?.length ?? 0) > 0 ? (
                <Text style={styles.triggerNote}>
                  Dazu {step.ifExtra.length === 1
                    ? 'eine Bedingung'
                    : `${step.ifExtra.length} Bedingungen`}{' '}
                  aus der Konfiguration (Zeitfenster, Gruppen) – zu viel für
                  den Editor, sie bleiben beim Speichern erhalten.
                </Text>
              ) : null}
              {step.ifConditions.length + (step.ifExtra?.length ?? 0) > 1 ? (
                <Choice
                  options={[
                    { key: 'all', label: 'alle zusammen (und)' },
                    { key: 'any', label: 'eine davon genügt (oder)' },
                  ]}
                  value={step.ifMatch}
                  onSelect={(ifMatch) =>
                    setStep(index, { ifMatch: ifMatch as 'all' | 'any' })
                  }
                />
              ) : null}
              <Text style={styles.label}>dann</Text>
              <View style={zweigStil(colors)}>
                <StepList
                  steps={step.ifThen}
                  entities={entities}
                  scenes={scenes}
                  andereAblaeufe={andereAblaeufe}
                  eigeneId={eigeneId}
                  hueScenes={hueScenes}
                  favoriten={favoriten}
                  empfaenger={empfaenger}
                  luxSensors={luxSensors}
                  onProbeStep={onProbeStep}
                  colors={colors}
                  styles={styles}
                  tiefe={tiefe + 1}
                  onChange={(ifThen) => setStep(index, { ifThen })}
                />
              </View>
              {step.ifElse.length === 0 ? (
                <Pressable
                  onPress={() => setStep(index, { ifElse: [{ ...EMPTY_STEP }] })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="git-branch-outline" size={16} color={colors.accent} />
                  <Text style={styles.addRowText}>Sonst-Zweig hinzufügen</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={styles.label}>sonst</Text>
                  <View style={zweigStil(colors)}>
                    <StepList
                      steps={step.ifElse}
                      entities={entities}
                      scenes={scenes}
                      andereAblaeufe={andereAblaeufe}
                      eigeneId={eigeneId}
                      hueScenes={hueScenes}
                      favoriten={favoriten}
                      empfaenger={empfaenger}
                      luxSensors={luxSensors}
                      onProbeStep={onProbeStep}
                      colors={colors}
                      styles={styles}
                      tiefe={tiefe + 1}
                      onChange={(ifElse) => setStep(index, { ifElse })}
                    />
                  </View>
                </>
              )}
              {/* Ein Schritt aus der config.yaml kann tiefer stecken, als
                  der Hub ausführt - das gehört gesagt, nicht versteckt. */}
              {tiefe > MAX_SCHACHTELUNG ? (
                <Text style={[styles.triggerNote, { color: colors.warn }]}>
                  Tiefer als {MAX_SCHACHTELUNG} Ebenen führt der Hub nicht
                  aus – dieser Zweig würde beim Lauf übersprungen.
                </Text>
              ) : null}
            </>
          ) : step.kind === 'repeat' ? (
            <>
              <Choice
                options={[
                  { key: 'count', label: 'feste Anzahl' },
                  { key: 'while', label: 'solange Bedingung gilt' },
                ]}
                value={step.repeatArt}
                onSelect={(repeatArt) =>
                  setStep(index, { repeatArt: repeatArt as 'count' | 'while' })
                }
              />
              {step.repeatArt === 'count' ? (
                <AnzahlWahl
                  value={step.repeatCount}
                  vorgaben={['2', '3', '5', '10']}
                  onCommit={(repeatCount) => setStep(index, { repeatCount })}
                  styles={styles}
                />
              ) : (
                <>
                  <BedingungsListe
                    conditions={step.repeatWhile}
                    entities={entities}
                    hinzufuegenText="Solange-Bedingung hinzufügen"
                    onChange={(repeatWhile) => setStep(index, { repeatWhile })}
                    colors={colors}
                    styles={styles}
                  />
                  {(step.repeatWhileExtra?.length ?? 0) > 0 ? (
                    <Text style={styles.triggerNote}>
                      Dazu {step.repeatWhileExtra.length === 1
                        ? 'eine Bedingung'
                        : `${step.repeatWhileExtra.length} Bedingungen`}{' '}
                      aus der Konfiguration – sie bleiben beim Speichern
                      erhalten.
                    </Text>
                  ) : null}
                  <Text style={styles.label}>höchstens</Text>
                  <AnzahlWahl
                    value={step.repeatMax}
                    vorgaben={['5', '10', '20', '50']}
                    onCommit={(repeatMax) => setStep(index, { repeatMax })}
                    styles={styles}
                  />
                </>
              )}
              <Text style={styles.triggerNote}>
                {step.repeatArt === 'while'
                  ? `Geprüft wird vor jedem Durchgang: Gilt die Bedingung schon zu Beginn nicht, läuft nichts. Mehr als ${REPEAT_LIMIT} Durchgänge lässt der Hub nie zu – eine Bedingung, die nie kippt (der Sensor ist tot, die Türe bleibt offen), liefe sonst für immer.`
                  : `Führt die Schritte der Reihe nach mehrfach aus – «dreimal blinken». Mehr als ${REPEAT_LIMIT} Durchgänge lässt der Hub nie zu.`}
              </Text>
              <View style={zweigStil(colors)}>
                <StepList
                  steps={step.repeatSteps}
                  entities={entities}
                  scenes={scenes}
                  andereAblaeufe={andereAblaeufe}
                  eigeneId={eigeneId}
                  hueScenes={hueScenes}
                  favoriten={favoriten}
                  empfaenger={empfaenger}
                  luxSensors={luxSensors}
                  onProbeStep={onProbeStep}
                  colors={colors}
                  styles={styles}
                  tiefe={tiefe + 1}
                  onChange={(repeatSteps) => setStep(index, { repeatSteps })}
                />
              </View>
              {tiefe > MAX_SCHACHTELUNG ? (
                <Text style={[styles.triggerNote, { color: colors.warn }]}>
                  Tiefer als {MAX_SCHACHTELUNG} Ebenen führt der Hub nicht
                  aus – diese Wiederholung würde beim Lauf übersprungen.
                </Text>
              ) : null}
            </>
          ) : step.kind === 'delay' ? (
            <>
              <Choice
                // Die kurzen Stufen dazwischen sind kein Zierrat: Ein
                // Nachlauf für ein Treppenhaus liegt bei zwei bis vier
                // Minuten, und zwischen «1 Min.» und «5 Min.» lag genau
                // das, was man dafür braucht.
                options={[
                  { key: '30', label: '30 Sek.' },
                  { key: '60', label: '1 Min.' },
                  { key: '120', label: '2 Min.' },
                  { key: '240', label: '4 Min.' },
                  { key: '300', label: '5 Min.' },
                  { key: '600', label: '10 Min.' },
                  { key: '1800', label: '30 Min.' },
                ]}
                value={step.seconds}
                onSelect={(seconds) => setStep(index, { seconds })}
              />
              <Text style={styles.triggerNote}>
                Wartet {delayLabel(step.seconds)}, bevor es weitergeht.
              </Text>
            </>
          ) : (
            <>
              <EntityPicker
                entities={entities}
                value={step.waitEntityId}
                onSelect={(waitEntityId) => setStep(index, { waitEntityId })}
              />
              <Choice
                options={[
                  { key: 'is', label: 'ist' },
                  { key: 'above', label: 'über' },
                  { key: 'below', label: 'unter' },
                ]}
                value={step.waitOp}
                onSelect={(waitOp) => setStep(index, { waitOp: waitOp as Compare })}
              />
              <TextInput
                style={styles.input}
                value={step.waitValue}
                onChangeText={(waitValue) => setStep(index, { waitValue })}
                placeholder={step.waitOp === 'is' ? 'off' : '5'}
                placeholderTextColor={colors.inkFaint}
              />
              <Choice
                options={[
                  { key: '60', label: 'max. 1 Min.' },
                  { key: '300', label: 'max. 5 Min.' },
                  { key: '900', label: 'max. 15 Min.' },
                  { key: '3600', label: 'max. 1 Std.' },
                ]}
                value={step.waitTimeout}
                onSelect={(waitTimeout) => setStep(index, { waitTimeout })}
              />
              <Text style={styles.triggerNote}>
                Wartet, bis es so weit ist – etwa bis die Tür wieder zu ist.
                Die Frist muss sein: Bleibt die Tür offen, ginge der Ablauf
                sonst nie zu Ende und blockierte auch jeden weiteren Lauf.
              </Text>
            </>
          )}
        </View>
      ))}

      <Pressable
        onPress={() => onChange([...steps, { ...EMPTY_STEP }])}
        accessibilityRole="button"
        style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="add" size={16} color={colors.accent} />
        <Text style={styles.addRowText}>Schritt hinzufügen</Text>
      </Pressable>
    </>
  );
}

/** Wartet dieser Ablauf irgendwo? (rein, testbar)
 *
 * Nur dann bedeutet «erneut ausgelöst» überhaupt etwas: Ein Ablauf, der
 * in Millisekunden durch ist, wird nie mitten im Lauf noch einmal
 * angestossen. Den Wähler trotzdem hinzustellen hiesse, eine Frage zu
 * stellen, die sich nicht stellt.
 */

/** Die Einrückung eines dann/sonst/wiederholen-Zweigs: eine Linie am
 *  linken Rand statt einer eigenen Box - Boxen in Boxen in Boxen wären
 *  bei Tiefe 3 schmaler als ein Chip. */
const zweigStil = (colors: Colors) =>
  ({
    borderLeftWidth: 2,
    borderLeftColor: colors.surfaceBorder,
    paddingLeft: 10,
    gap: 4,
  }) as const;

/**
 * Die Bedingungszeilen eines «Wenn …»- oder «Wiederholen»-Schritts.
 *
 * Derselbe Baustein wie in den Und/Oder-Gruppen (Punkt 152) – dieselbe
 * Bedienung, weil es dieselbe Sache ist: Gerät, Vergleich, Wert. Auf
 * Modulebene, damit die Eingaben beim Tippen nicht neu montiert werden.
 */
export function BedingungsListe({
  conditions,
  entities,
  hinzufuegenText,
  onChange,
  colors,
  styles,
}: {
  conditions: StateCondition[];
  entities: Entity[];
  hinzufuegenText: string;
  onChange: (conditions: StateCondition[]) => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const setEntry = (index: number, patch: Partial<StateCondition>) =>
    onChange(
      conditions.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry
      )
    );
  return (
    <>
      {conditions.map((entry, index) => {
        const chosen = entities.find((entity) => entity.id === entry.entity_id);
        return (
          <View key={index} style={styles.rowGap}>
            <View style={{ flex: 1, gap: 6 }}>
              <EntityPicker
                entities={entities}
                value={entry.entity_id}
                onSelect={(entity_id) =>
                  setEntry(index, {
                    entity_id,
                    // Nach dem Gerätewechsel muss der Zustand zum neuen
                    // Gerät passen - sonst stünde «an» bei einem Taster.
                    value:
                      entry.op === 'is'
                        ? fittingState(
                            entities.find((candidate) => candidate.id === entity_id),
                            entry.value
                          )
                        : entry.value,
                  })
                }
              />
              <Choice
                options={[
                  { key: 'is', label: 'ist' },
                  { key: 'above', label: 'über' },
                  { key: 'below', label: 'unter' },
                ]}
                value={entry.op}
                onSelect={(op) =>
                  setEntry(index, {
                    op: op as Compare,
                    value:
                      op === 'is'
                        ? fittingState(chosen, entry.value)
                        : String(Number(entry.value) || 0),
                    // «ist» vergleicht immer den Zustand selbst.
                    attribute: op === 'is' ? undefined : entry.attribute,
                  })
                }
              />
              {entry.op === 'is' ? (
                <Choice
                  options={conditionOptions(chosen)}
                  value={entry.value}
                  onSelect={(value) => setEntry(index, { value })}
                />
              ) : (
                <NumberField
                  value={entry.value}
                  onCommit={(value) => setEntry(index, { value })}
                  placeholder="z.B. 30"
                />
              )}
              {entry.op !== 'is' && measurableAttributes(chosen).length > 0 ? (
                <Choice
                  options={[
                    { key: '', label: 'Zustand' },
                    ...measurableAttributes(chosen),
                  ]}
                  value={entry.attribute ?? ''}
                  onSelect={(attribute) => setEntry(index, { attribute })}
                />
              ) : null}
            </View>
            <Pressable
              onPress={() =>
                onChange(
                  conditions.filter((_entry, position) => position !== index)
                )
              }
              accessibilityLabel="Bedingung entfernen"
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={colors.inkSoft} />
            </Pressable>
          </View>
        );
      })}
      <Pressable
        onPress={() =>
          onChange([
            ...conditions,
            {
              entity_id: entities[0]?.id ?? '',
              op: 'is' as Compare,
              value: fittingState(entities[0], 'on'),
            },
          ])
        }
        accessibilityRole="button"
        style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="add" size={16} color={colors.accent} />
        <Text style={styles.addRowText}>{hinzufuegenText}</Text>
      </Pressable>
    </>
  );
}

/**
 * Durchgänge wählen: die üblichen Zahlen als Knöpfe, alles andere zum
 * Eintippen – dasselbe Muster wie MinutenWahl (felder.tsx), nur zählt
 * es Male statt Minuten. Eingetipptes wird sofort auf die harte Grenze
 * des Hubs gebracht: Der Editor soll keine 200 versprechen, von denen
 * der Hub 50 hält.
 */
export function AnzahlWahl({
  value,
  vorgaben,
  onCommit,
  styles,
}: {
  value: string;
  vorgaben: string[];
  onCommit: (value: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [offen, setOffen] = useState(false);
  const istVorgabe = vorgaben.includes(value);
  const eigen = offen || !istVorgabe;
  return (
    <>
      <View style={styles.rowGap}>
        <Choice
          options={[
            ...vorgaben.map((key) => ({ key, label: `${key}×` })),
            {
              key: 'eigen',
              label:
                eigen && value && !istVorgabe
                  ? `${begrenzteAnzahl(value, 1)}×`
                  : 'eigene Zahl',
            },
          ]}
          value={eigen ? 'eigen' : value}
          onSelect={(key) => {
            if (key === 'eigen') {
              setOffen(true);
              return;
            }
            setOffen(false);
            onCommit(key);
          }}
        />
      </View>
      {eigen ? (
        <NumberField
          value={value}
          placeholder={`Anzahl, höchstens ${REPEAT_LIMIT}`}
          onCommit={(text) => onCommit(String(begrenzteAnzahl(text, 1)))}
        />
      ) : null}
    </>
  );
}

/**
 * «+ Gerätewert»: baut {kennung} bzw. {kennung.feld} zusammen und setzt
 * den Platzhalter in den Text (Punkt 251).
 *
 * Kennungen tippt niemand fehlerfrei ab – hier wählt man das Gerät wie
 * überall im Editor und tippt den Wert an, der in den Text soll.
 * Angeboten wird nur, was das Gerät wirklich meldet: Ein Platzhalter,
 * der wörtlich stehen bliebe, wäre eine Attrappe.
 */
export function GeraetewertZeile({
  entities,
  feld,
  onEinsetzen,
  colors,
  styles,
}: {
  entities: Entity[];
  /** Wie das Zielfeld heisst – für die Vorlesehilfe. */
  feld: string;
  onEinsetzen: (halter: string) => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [offen, setOffen] = useState(false);
  const [geraet, setGeraet] = useState('');
  const chosen = entities.find((entity) => entity.id === geraet);
  return (
    <>
      <View style={styles.choices}>
        <Pressable
          onPress={() => setOffen((auf) => !auf)}
          accessibilityRole="button"
          accessibilityState={{ expanded: offen }}
          accessibilityLabel={`Einen Gerätewert in den ${feld} einfügen`}
          style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
        >
          <Ionicons
            name={offen ? 'chevron-down' : 'add'}
            size={13}
            color={colors.inkSoft}
          />
          <Text style={styles.templateText}>Gerätewert</Text>
        </Pressable>
      </View>
      {offen ? (
        <>
          <EntityPicker
            entities={entities}
            value={geraet}
            onSelect={setGeraet}
          />
          {chosen ? (
            <View style={styles.choices}>
              {geraetePlatzhalter(chosen).map((halter) => (
                <Pressable
                  key={halter.key}
                  onPress={() => {
                    onEinsetzen(halter.key);
                    setOffen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${halter.label} von ${chosen.name} in den ${feld} einfügen`}
                  style={({ pressed }) => [
                    styles.template,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Text style={styles.templateText}>+ {halter.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </>
  );
}
