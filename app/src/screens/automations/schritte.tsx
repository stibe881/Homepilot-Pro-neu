/**
 * Die Schritte eines Ablaufs im Editor - und die Bedingungslisten, die
 * «wenn» und «wiederholen» darin brauchen.
 *
 * Herausgelöst aus editor.tsx (Punkt 422): Der Editor
 * war auf über 3000 Zeilen gewachsen - Auslöser, Schritte und
 * Bedingungen je in einer Datei, wie es das Dashboard vorgemacht hat.
 */
import { Ionicons } from '@expo/vector-icons';

import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Entity, Scene } from '../../api/types';
import { Colors } from '../../theme';
import {
  MAX_SCHACHTELUNG,
  REPEAT_LIMIT,
  begrenzteAnzahl,
} from '../../lib/kontrollfluss';
import { anwesenheitsPersonen } from '../../lib/ortsausloeser';
import { Compare, EMPTY_STEP, STEP_KIND_ICON, StateCondition, StepDraft, StepKind, conditionOptions, delayLabel, empfaengerLabel, fittingState, geraetePlatzhalter, KAMERA_AUSLOESER, kopieSchritt, PLATZHALTER, measurableAttributes } from './entwurf';
import {
  Choice,
  Kachelauswahl,
  EntityPicker,
  NumberField,
  Picker,
} from './felder';
import { makeStyles } from './stil';
import { tiefen } from '../../lib/ablaufhilfen';
import { mitschalter, mitschalterSatz } from '../../lib/verweise';
import { NachrichtenZiel } from './nachrichtenziel';
import { SceneDevices } from './szenen-editor';

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
              ...(andereAblaeufe.length > 0
                ? [
                    {
                      key: 'automation',
                      label: 'Ablauf starten',
                      icon: STEP_KIND_ICON.automation,
                    },
                  ]
                : []),
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
          ) : step.kind === 'automation' ? (
            <>
              <Picker
                items={andereAblaeufe
                  .filter((ablauf) => ablauf.id !== eigeneId)
                  .map((ablauf) => ({ key: ablauf.id, label: ablauf.alias }))}
                placeholder="Ablauf suchen …"
                value={step.automationId}
                onSelect={(automationId) => setStep(index, { automationId })}
              />
              <Text style={styles.triggerNote}>
                Führt die Schritte des anderen Ablaufs aus – nur seine Schritte,
                nicht seine Bedingungen. «Alles aus» steht so einmal und wird von
                fünf Abläufen aufgerufen, statt fünfmal abgeschrieben.
              </Text>
            </>
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
                    ...empfaenger.map((name) => ({ key: name, label: empfaengerLabel(name) })),
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
                  Durchsage - «Es ist {time}, die Türe steht offen». Und
                  seit die Durchsage denselben Füller wie die Nachricht
                  nutzt (kamera.fill): {gerät}, {raum} und {wert} des
                  Auslösers - «{gerät} im {raum} meldet {wert}» gilt so
                  für alle Melder auf einmal. */}
              <View style={styles.choices}>
                {[
                  ['{time}', '+ Uhrzeit', 'Die Uhrzeit in die Durchsage einfügen'],
                  ['{gerät}', '+ Gerät', 'Das auslösende Gerät in die Durchsage einfügen'],
                  ['{raum}', '+ Raum', 'Den Raum des Auslösers in die Durchsage einfügen'],
                  ['{wert}', '+ Wert', 'Den gemeldeten Wert in die Durchsage einfügen'],
                ].map(([halter, label, vorlesen]) => (
                  <Pressable
                    key={halter}
                    onPress={() =>
                      setStep(index, {
                        broadcastText: `${step.broadcastText}${halter}`,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={vorlesen}
                    style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={styles.templateText}>{label}</Text>
                  </Pressable>
                ))}
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
