/**
 * Was ein Tipp auf die Nachricht tut.
 *
 * Zwei Fragen, die bisher niemand stellen konnte: Wohin führt der Tipp,
 * und was steht dort zur Wahl. Eine Nachricht «Waschmaschine fertig»
 * öffnete die App, und dann suchte man den Trockner.
 *
 * Beides gehört zum Ablauf und nicht in die App: Ein Ablauf weiss, worum
 * es geht - dem Hub kann man es nicht ansehen.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Entity, Scene } from '../../api/types';
import { Colors, useColors } from '../../theme';
import { NotifyKnopf, zielArt, zielMitArt, zielWert } from './entwurf';
import { Choice, EntityPicker } from './felder';

/** Die Arten von Zielen, in der Reihenfolge, in der man sie sucht. */
const ARTEN = [
  { key: '', label: 'Nur öffnen' },
  { key: 'raum', label: 'Raum' },
  { key: 'geraet', label: 'Gerät' },
  { key: 'familie', label: 'Familie' },
  { key: 'bereich', label: 'Bereich' },
  { key: 'sorgen', label: 'Nicht in Ordnung' },
];

/** Die Kacheln der Familie, die als Ziel taugen. */
const MODULE = [
  { key: 'shopping', label: 'Einkauf' },
  { key: 'tasks', label: 'Aufgaben' },
  { key: 'chores', label: 'Ämtli' },
  { key: 'kalender', label: 'Kalender' },
  { key: 'medications', label: 'Medikamente' },
  { key: 'meals', label: 'Essensplan' },
  { key: 'woche', label: 'Wochenplan' },
  { key: 'reminders', label: 'Erinnerungen' },
];

/** Bereiche, in die eine Nachricht sinnvoll führt. */
const BEREICHE = [
  { key: 'alarm', label: 'Alarmanlage' },
  { key: 'cameras', label: 'Kameras' },
  { key: 'energy', label: 'Energie' },
  { key: 'system', label: 'System' },
  { key: 'devices', label: 'Geräte' },
  { key: 'activity', label: 'Was war los' },
  { key: 'personen', label: 'Familie und Freunde' },
];

/** Was ein Knopf mit einem Gerät tun kann. Absichtlich wenige: Ein
 *  Handgriff unter einer Nachricht ist ein Handgriff, keine Fernbedienung. */
const BEFEHLE = [
  { key: 'turn_on', label: 'einschalten' },
  { key: 'turn_off', label: 'ausschalten' },
  { key: 'toggle', label: 'umschalten' },
  { key: 'open', label: 'öffnen' },
  { key: 'close', label: 'schliessen' },
];

export function NachrichtenZiel({
  ziel,
  onZiel,
  knoepfe,
  onKnoepfe,
  entities,
  scenes,
  colors: _colors,
  styles,
}: {
  ziel: string;
  onZiel: (ziel: string) => void;
  knoepfe: NotifyKnopf[];
  onKnoepfe: (knoepfe: NotifyKnopf[]) => void;
  entities: Entity[];
  scenes: Scene[];
  colors: Colors;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styles: any;
}) {
  const colors = useColors();
  const art = zielArt(ziel);
  const wert = zielWert(ziel);
  const raeume = useMemo(
    () =>
      Array.from(
        new Set(entities.map((entity) => entity.room).filter(Boolean) as string[])
      ).sort((a, b) => a.localeCompare(b)),
    [entities]
  );

  const setzeKnopf = (index: number, teil: Partial<NotifyKnopf>) =>
    onKnoepfe(knoepfe.map((knopf, i) => (i === index ? { ...knopf, ...teil } : knopf)));

  return (
    <>
      <Text style={styles.triggerNote}>
        Wohin ein Tipp auf die Nachricht führt. Ohne Angabe öffnet sich die
        App, wie sie zuletzt stand – bei «Wasser im Keller» ist das der
        falsche Ort.
      </Text>
      <Choice options={ARTEN} value={art} onSelect={(key) => onZiel(zielMitArt(ziel, key))} />

      {art === 'raum' && raeume.length > 0 ? (
        <Choice
          options={raeume.map((raum) => ({ key: raum, label: raum }))}
          value={wert}
          onSelect={(raum) => onZiel(`raum:${raum}`)}
        />
      ) : null}
      {art === 'geraet' ? (
        <EntityPicker
          entities={entities}
          value={wert}
          onSelect={(id) => onZiel(`geraet:${id}`)}
          placeholder="Gerät suchen …"
        />
      ) : null}
      {art === 'familie' ? (
        <Choice
          options={MODULE}
          value={wert}
          onSelect={(modul) => onZiel(`familie:${modul}`)}
        />
      ) : null}
      {art === 'bereich' ? (
        <Choice
          options={BEREICHE}
          value={wert}
          onSelect={(bereich) => onZiel(`bereich:${bereich}`)}
        />
      ) : null}

      {/* Die Handgriffe. Sie stehen erst in der App zur Wahl, hinter der
          Anmeldung - ein Knopf am Sperrbildschirm, der schaltet, wäre
          etwas anderes. */}
      <Text style={styles.triggerNote}>
        Und was dort gleich zur Wahl steht: «Waschmaschine fertig» – und
        darunter der Knopf, der den Trockner einschaltet. Höchstens drei.
      </Text>
      {knoepfe.map((knopf, index) => (
        <View key={index} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={knopf.label}
              onChangeText={(label) => setzeKnopf(index, { label })}
              placeholder="Was auf dem Knopf steht"
              placeholderTextColor={colors.inkFaint}
            />
            <Pressable
              onPress={() => onKnoepfe(knoepfe.filter((_, i) => i !== index))}
              accessibilityRole="button"
              accessibilityLabel="Knopf entfernen"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color={colors.inkFaint} />
            </Pressable>
          </View>
          <Choice
            options={[
              { key: 'scene', label: 'Szene' },
              { key: 'entity', label: 'Gerät' },
            ]}
            value={knopf.sceneId !== undefined && knopf.sceneId !== '' ? 'scene' : knopf.entityId ? 'entity' : ''}
            onSelect={(key) =>
              setzeKnopf(
                index,
                key === 'scene'
                  ? { sceneId: scenes[0]?.id ?? '', entityId: undefined, command: undefined }
                  : { sceneId: undefined, entityId: '', command: 'turn_on' }
              )
            }
          />
          {knopf.sceneId !== undefined && knopf.sceneId !== '' ? (
            <Choice
              options={scenes.map((szene) => ({ key: szene.id, label: szene.name }))}
              value={knopf.sceneId}
              onSelect={(sceneId) => setzeKnopf(index, { sceneId })}
            />
          ) : null}
          {knopf.entityId !== undefined ? (
            <>
              <EntityPicker
                entities={entities}
                value={knopf.entityId}
                onSelect={(entityId) => setzeKnopf(index, { entityId })}
                placeholder="Gerät suchen …"
              />
              <Choice
                options={BEFEHLE}
                value={knopf.command ?? 'turn_on'}
                onSelect={(command) => setzeKnopf(index, { command })}
              />
            </>
          ) : null}
        </View>
      ))}
      {knoepfe.length < 3 ? (
        <Pressable
          onPress={() =>
            onKnoepfe([...knoepfe, { label: '', sceneId: scenes[0]?.id ?? '' }])
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="add" size={16} color={colors.accent} />
          <Text style={styles.addRowText}>Knopf hinzufügen</Text>
        </Pressable>
      ) : null}
    </>
  );
}
