/**
 * Der Ablauf-Editor: Auslöser, Bedingungen, Schritte, frühere Fassungen.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Entity, Scene } from '../../api/types';
import { Colors, useColors } from '../../theme';
import { ablaufSatz } from '../../lib/ablaufsatz';
import { datumUhr } from '../../lib/format';
import { Compare, ConditionKind, Draft, DryRun, EMPTY_STEP, StepDraft, StepKind, TriggerDraft, TriggerKind, WEEKDAY_LABELS, buildConditions, conditionOptions, delayLabel, fittingState, fittingTrigger, KAMERA_AUSLOESER, PLATZHALTER, hatWartezeit, measurableAttributes, melderMitLux, newTrigger, normalisiereZeit, optionKey, stateOptions, stepsToActions, triggerToConfig, weekdayLabel, zeitfensterHinweis } from './entwurf';
import {
  CategoryField,
  Choice,
  EntityPicker,
  Field,
  MinutenWahl,
  NumberField,
  Picker,
} from './felder';
import { makeStyles } from './stil';
import { SceneDevices } from './szenen-editor';

export function Editor({
  draft,
  entities,
  scenes,
  categories,
  hueScenes,
  empfaenger,
  onProbeStep,
  onChange,
  onSave,
  onDelete,
  onTest,
  onDryRun,
  onVersions,
  onRestoreVersion,
  onCancel,
}: {
  draft: Draft | null;
  entities: Entity[];
  scenes: Scene[];
  /** Schon vergebene Kategorien – als Vorschläge im Feld. */
  categories: string[];
  /** Szenen der Hue-Bridge; leer, wenn keine Bridge verbunden ist. */
  hueScenes: string[];
  /** Mögliche Nachricht-Empfänger (Punkt 158); leer = keine Auswahl. */
  empfaenger?: string[];
  /** Einen einzelnen Schritt sofort ausführen (Punkt 164). */
  onProbeStep?: (step: StepDraft) => Promise<boolean>;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete?: () => void;
  /** Nur bei gespeicherten Abläufen: einmal sofort ausführen. */
  onTest?: () => void;
  /** Nur bei gespeicherten Abläufen: zeigen, was jetzt passieren würde. */
  onDryRun?: () => Promise<DryRun | null>;
  /** Frühere Fassungen laden bzw. eine zurückholen (nur beim Bearbeiten). */
  onVersions?: () => Promise<Fassung[]>;
  onRestoreVersion?: (at: number) => Promise<boolean>;
  onCancel: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tested, setTested] = useState(false);
  const [preview, setPreview] = useState<DryRun | null>(null);
  if (!draft) return null;

  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

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

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent}>
        <View style={styles.cardHead}>
          <Text style={styles.editorTitle}>
            {draft.templateId
              ? draft.templateId === 'neu'
                ? 'Neue Vorlage'
                : 'Vorlage bearbeiten'
              : draft.id
                ? 'Ablauf bearbeiten'
                : 'Neuer Ablauf'}
          </Text>
          <Pressable onPress={onCancel} accessibilityLabel="Abbrechen">
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

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
          const satz = ablaufSatz(
            {
              triggers: draft.triggers.map(triggerToConfig),
              conditions: buildConditions(draft),
              actions: stepsToActions(draft.steps),
              otherwise: stepsToActions(draft.elseSteps),
              match: draft.match,
            },
            entities,
            scenes
          );
          return satz ? (
            <View style={styles.satzBox}>
              <Ionicons name="chatbox-ellipses-outline" size={15} color={colors.accent} />
              <Text style={styles.satzText}>{satz}</Text>
            </View>
          ) : null;
        })()}

        <Field label="Name">
          <TextInput
            style={styles.input}
            value={draft.alias}
            onChangeText={(alias) => set({ alias })}
            placeholder="z.B. Licht bei Bewegung"
            placeholderTextColor={colors.inkFaint}
          />
        </Field>

        <CategoryField
          value={draft.category}
          known={categories}
          onChange={(category) => set({ category })}
        />

        <Field label="Aktiv">
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
        </Field>

        <Field label={draft.triggers.length > 1 ? 'Wenn eines passiert' : 'Wenn … passiert'}>
          {draft.triggers.map((trigger, index) => (
            <TriggerRow
              key={index}
              trigger={trigger}
              entities={entities}
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
        </Field>

        <Field label="Nur wenn (Bedingung)">
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
        </Field>

        <Field label="… dann das tun">
          <StepList
            steps={draft.steps}
            entities={entities}
            scenes={scenes}
            hueScenes={hueScenes}
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
        </Field>

        <Field label="… sonst">
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
              hueScenes={hueScenes}
              empfaenger={empfaenger}
              luxSensors={luxSensors}
              onProbeStep={onProbeStep}
              colors={colors}
              styles={styles}
              onChange={(elseSteps) => set({ elseSteps })}
            />
          )}
        </Field>

        <Pressable style={styles.save} onPress={onSave} accessibilityRole="button">
          <Text style={styles.saveText}>
            {draft.templateId ? 'Vorlage sichern' : 'Speichern'}
          </Text>
        </Pressable>
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
        {onVersions && onRestoreVersion ? (
          <VersionsSection load={onVersions} restore={onRestoreVersion} />
        ) : null}
        {onDelete ? (
          <Pressable style={styles.delete} onPress={onDelete} accessibilityRole="button">
            <Text style={styles.deleteText}>Ablauf löschen</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Modal>
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

/** Ein Auslöser im Editor – eigenständige Komponente auf Modulebene, damit
 *  die Texteingaben beim Tippen nicht neu montiert werden. */
export function TriggerRow({
  trigger,
  entities,
  index,
  removable,
  onChange,
  onRemove,
}: {
  trigger: TriggerDraft;
  entities: Entity[];
  index: number;
  removable: boolean;
  onChange: (patch: Partial<TriggerDraft>) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const chosen = entities.find((entity) => entity.id === trigger.entityId);
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
      <Choice
        options={[
          // «Gerät wechselt» stimmt bei einem Taster nicht: Der wechselt
          // nichts, er wird gedrückt.
          {
            key: 'state',
            label: chosen?.kind === 'button' ? 'Taster gedrückt' : 'Gerät wechselt',
          },
          { key: 'threshold', label: 'Messwert' },
          { key: 'time', label: 'Uhrzeit' },
          { key: 'sun', label: 'Sonnenstand' },
          { key: 'interval', label: 'Regelmässig' },
          { key: 'availability', label: 'Meldet sich nicht' },
          // Nur anbieten, wenn es auch Zonen gibt – ein leerer Auslöser
          // wäre ein Versprechen, das der Hub nicht halten kann.
          ...(entities.some((entity) => entity.id.startsWith('geofence.'))
            ? [{ key: 'geofence', label: 'Ort' }]
            : []),
          // Dito für den Kalender (Punkt 153): ohne angebundenen Kalender
          // gäbe es nichts zu hören.
          ...(entities.some((entity) => Array.isArray(entity.state?.events))
            ? [{ key: 'calendar', label: 'Termin' }]
            : []),
        ]}
        value={trigger.kind}
        onSelect={(kind) => onChange({ kind: kind as TriggerKind })}
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
            entities={entities.filter((entity) => entity.id.startsWith('geofence.'))}
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
          <Text style={styles.triggerNote}>
            Das Telefon meldet den Wechsel selbst – auf dem iPhone über die
            Kurzbefehle-App («Wenn ich ankomme» → Inhalte von URL abrufen).
            Steht in docs/geofence.md.
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
  hueScenes,
  empfaenger = [],
  luxSensors = [],
  onProbeStep,
  colors,
  styles,
  onChange,
}: {
  steps: StepDraft[];
  entities: Entity[];
  scenes: Scene[];
  hueScenes: string[];
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
  onChange: (steps: StepDraft[]) => void;
}) {
  // Welcher Schritt gerade probiert wurde - für das kurze Häkchen.
  const [probiert, setProbiert] = useState<number | null>(null);
  const setStep = (index: number, patch: Partial<StepDraft>) =>
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));
  // «Licht an, warten, Licht aus» für den zweiten Flur tippte man bisher
  // neu – ein Ablauf liess sich kopieren, ein Schritt nicht.
  const copy = (index: number) => {
    const kopie = {
      ...steps[index],
      commandActions: steps[index].commandActions.map((entry) => ({ ...entry })),
      broadcastSpeakers: [...steps[index].broadcastSpeakers],
    };
    onChange([...steps.slice(0, index + 1), kopie, ...steps.slice(index + 1)]);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <>
      {steps.map((step, index) => (
        <View key={index} style={styles.stepBox}>
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
            {onProbeStep &&
            !['delay', 'wait_until'].includes(step.kind) ? (
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

          <Choice
            options={[
              { key: 'command', label: 'Gerät schalten' },
              // Ein Wandtaster, zwei Räume, ein Zustand (siehe unten).
              { key: 'toggle_all', label: 'Gemeinsam umschalten' },
              { key: 'scene', label: 'Szene' },
              ...(hueScenes.length > 0 ? [{ key: 'hue_scene', label: 'Hue-Szene' }] : []),
              { key: 'notify', label: 'Nachricht' },
              ...(entities.some((entity) => entity.commands.includes('play_url'))
                ? [{ key: 'broadcast', label: 'Durchsage' }]
                : []),
              // Dimmen über Zeit (Punkt 157) - nur wenn eine Lampe die
              // Helligkeit überhaupt kann.
              ...(entities.some((entity) => entity.commands.includes('set_brightness'))
                ? [{ key: 'fade', label: 'Dimmen' }]
                : []),
              { key: 'delay', label: 'Warten' },
              { key: 'wait_until', label: 'Warten bis' },
            ]}
            value={step.kind}
            onSelect={(kind) => setStep(index, { kind: kind as StepKind })}
          />

          {step.kind === 'command' ? (
            <SceneDevices
              entities={entities}
              actions={step.commandActions}
              onActions={(commandActions) => setStep(index, { commandActions })}
              showSnapshot={false}
              allowToggle
              luxSensors={luxSensors}
            />
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
              <Text style={styles.triggerNote}>
                {'{raum}'} und {'{gerät}'} setzt der Hub beim Auslösen ein –
                in Titel und Text. So genügt ein Ablauf für alle Zimmer,
                statt je Melder einen mit eigenem Text.
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
                auf allen. Braucht Internet (Sprachausgabe) und dass die
                App den Hub mindestens einmal erreicht hat.
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
