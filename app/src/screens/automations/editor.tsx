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
import { Compare, ConditionKind, Draft, DryRun, EMPTY_STEP, KontextArt, KontextCondition, StepDraft, TRIGGER_KIND_ICON, TriggerDraft, WEEKDAY_LABELS, buildConditions, conditionOptions, fittingState, hatWartezeit, schaltetSpaeterAus, measurableAttributes, meldetEtwas, melderMitLux, newTrigger, normalisiereZeit, stepsToActions, triggerToConfig, namensVorschlag, angabenStand, bedingungStand, sonstStand, wasFehlt, weekdayLabel, zeitfensterHinweis, stundeAusText } from './entwurf';
import {
  Abschnitt,
  CategoryField,
  Choice,
  EditorRahmen,
  Kachelauswahl,
  Klappe,
  EntityPicker,
  Field,
  NumberField,
  } from './felder';
import { makeStyles } from './stil';
import { zuletztGefeuert } from '../../lib/verwaist';
import { TriggerRow } from './ausloeser';
import { StepList } from './schritte';

export { TriggerRow } from './ausloeser';
export { AnzahlWahl, BedingungsListe, GeraetewertZeile, StepList } from './schritte';

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
                  <Text style={[styles.satzText, { color: colors.warnInk }]}>
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

          {/* Kontext-Bedingungen: Person daheim, Gerät erreichbar, Warnung
              läuft, Termin läuft - die vier Auslöser aus Punkt 252/153 als
              Dauerzustand. «Nur wenn Livia daheim ist» war bisher eine
              Gerätebedingung auf die Zonen-Entität, und dafür musste man
              deren Kennung kennen. */}
          {draft.kontextConditions.map((entry, index) => {
            const setEntry = (patch: Partial<KontextCondition>) =>
              set({
                kontextConditions: draft.kontextConditions.map((other, position) =>
                  position === index ? { ...other, ...patch } : other
                ),
              });
            return (
              <View key={`kontext-${index}`} style={styles.triggerBox}>
                <View style={styles.triggerHead}>
                  <Text style={styles.triggerBadge}>nur wenn</Text>
                  <Pressable
                    onPress={() =>
                      set({
                        kontextConditions: draft.kontextConditions.filter(
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
                <Kachelauswahl
                  options={[
                    { key: 'presence', label: 'Person daheim', icon: TRIGGER_KIND_ICON.presence },
                    {
                      key: 'availability',
                      label: 'Gerät erreichbar',
                      icon: TRIGGER_KIND_ICON.availability,
                    },
                    {
                      key: 'weather_warning',
                      label: 'Wetterwarnung läuft',
                      icon: TRIGGER_KIND_ICON.weather_warning,
                    },
                    { key: 'calendar', label: 'Termin läuft', icon: TRIGGER_KIND_ICON.calendar },
                  ]}
                  value={entry.art}
                  onSelect={(art) => setEntry({ art: art as KontextArt, ziel: '', wert: '' })}
                />
                {entry.art === 'presence' ? (
                  <TextInput
                    style={styles.input}
                    value={entry.ziel}
                    onChangeText={(ziel) => setEntry({ ziel })}
                    placeholder="Name der Person, z.B. Livia"
                    placeholderTextColor={colors.inkFaint}
                  />
                ) : entry.art === 'availability' ? (
                  <EntityPicker
                    entities={entities}
                    value={entry.ziel}
                    onSelect={(ziel) => setEntry({ ziel })}
                  />
                ) : entry.art === 'weather_warning' ? (
                  <Choice
                    options={[
                      { key: '', label: 'jede Stufe' },
                      { key: 'Moderate', label: 'ab markant' },
                      { key: 'Severe', label: 'ab schwer' },
                      { key: 'Extreme', label: 'nur extrem' },
                    ]}
                    value={entry.wert}
                    onSelect={(wert) => setEntry({ wert })}
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    value={entry.wert}
                    onChangeText={(wert) => setEntry({ wert })}
                    placeholder="Wort im Termin-Titel, z.B. Homeoffice (leer = jeder)"
                    placeholderTextColor={colors.inkFaint}
                  />
                )}
                <Choice
                  options={[
                    {
                      key: 'ja',
                      label:
                        entry.art === 'presence'
                          ? 'ist daheim'
                          : entry.art === 'availability'
                            ? 'meldet sich'
                            : 'läuft',
                    },
                    {
                      key: 'nein',
                      label:
                        entry.art === 'presence'
                          ? 'ist nicht daheim'
                          : entry.art === 'availability'
                            ? 'meldet sich nicht'
                            : 'läuft nicht',
                    },
                  ]}
                  value={entry.nicht ? 'nein' : 'ja'}
                  onSelect={(wahl) => setEntry({ nicht: wahl === 'nein' })}
                />
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
          <Pressable
            onPress={() =>
              set({
                kontextConditions: [
                  ...draft.kontextConditions,
                  { art: 'presence', ziel: '', wert: '', nicht: false },
                ],
              })
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>
              Person, Erreichbarkeit, Warnung oder Termin als Bedingung
            </Text>
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
          <Text style={[styles.snapshotHint, { color: colors.warnInk }]}>
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
        <Text style={[styles.previewLine, { color: colors.warnInk }]}>
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
        <Text style={[styles.previewLine, { color: colors.warnInk }]}>
          {bericht.hinweis}
        </Text>
      ) : null}
    </View>
  );
}

/** Ein Auslöser im Editor – eigenständige Komponente auf Modulebene, damit
 *  die Texteingaben beim Tippen nicht neu montiert werden. */
