/**
 * Der Auslöser eines Ablaufs im Editor: welche Art, welches Gerät, wann.
 *
 * Herausgelöst aus editor.tsx (Punkt 511): Der Editor
 * war auf über 3000 Zeilen gewachsen - Auslöser, Schritte und
 * Bedingungen je in einer Datei, wie es das Dashboard vorgemacht hat.
 */
import { Ionicons } from '@expo/vector-icons';

import React, { useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Entity } from '../../api/types';
import { useColors } from '../../theme';
import {
  WARNSTUFEN_WAHL,
  } from '../../lib/kontrollfluss';
import { ZUHAUSE, anwesenheitsPersonen, istOrtsmelder, ortsauswahl } from '../../lib/ortsausloeser';
import { TRIGGER_KIND_ICON, TriggerDraft, TriggerKind, fittingTrigger, optionKey, stateOptions, unbekannterZustand } from './entwurf';
import {
  Choice,
  Kachelauswahl,
  EntityPicker,
  MinutenWahl,
  } from './felder';
import { makeStyles } from './stil';

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
          { key: 'window', label: 'Zeitraum', icon: TRIGGER_KIND_ICON.window },
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
            <Text style={[styles.triggerNote, { color: colors.warnInk }]}>
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
      ) : trigger.kind === 'window' ? (
        <>
          <View style={styles.choices}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={trigger.at}
              onChangeText={(at) => onChange({ at })}
              placeholder="von, z.B. 07:00"
              placeholderTextColor={colors.inkFaint}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={trigger.until}
              onChangeText={(until) => onChange({ until })}
              placeholder="bis, z.B. 09:00"
              placeholderTextColor={colors.inkFaint}
            />
          </View>
          <Text style={styles.triggerNote}>
            Feuert um {trigger.at || '…'} und lässt den Ablauf nur bis{' '}
            {trigger.until || '…'} laufen – auch wenn ihn ein anderer Auslöser
            anstösst. Vorher brauchte das einen Zeit-Auslöser und eine
            Zeit-Bedingung mit denselben zwei Uhrzeiten.
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
      {trigger.kind === 'time' || trigger.kind === 'sun' || trigger.kind === 'window' ? (
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
