/**
 * Sechs Module der Familienseite, die für sich stehen.
 *
 * Punkt 423 der Werkbank: `FamilyScreen.tsx` war mit 4851 Zeilen die
 * grösste Datei im Baum - grösser als die Startseite, für die Punkt
 * 268/339 den Schnitt schon beschreibt. Sie ist eine Kette von zwanzig
 * `if (view === …)`-Blöcken, und das ist zugleich die Schnittkante:
 * Jeder Block ist ein Modul, jedes Modul eine Seite.
 *
 * Hier stehen die sechs, die am wenigsten mit dem Rest verwoben sind -
 * sie brauchen nichts als die Daten, die Stile und die drei Handgriffe
 * anlegen/ändern/löschen. Die übrigen vierzehn hängen an
 * Zwischenspeichern, Kameras und dem Babysitter-Abend; sie folgen, wenn
 * jemand an ihnen ohnehin arbeitet.
 *
 * **Warum nicht alle auf einmal**: Derselbe Grund, aus dem Punkt 339 bei
 * der Startseite auf «begonnen» steht. Ein Schnitt quer durch eine
 * Datei, an der in derselben Runde zehn andere Dinge geändert wurden,
 * ist der riskanteste Einzelschritt - und ein halber Umbau, der
 * funktioniert, ist mehr wert als ein ganzer, den niemand mehr prüfen
 * kann.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, Share, Text, TextInput, View } from 'react-native';

import { Card } from '../../components/Card';
import { Colors } from '../../theme';
import { datumUhr } from '../../lib/format';
import { doppeldosisFrage } from '../../lib/doppeldosis';
import { Erinnerung, bestaetigung, offene, wiederholungVon, wiederholungsLabel } from '../../lib/erinnerungen';
import {
  NOTFALL_FELDER,
  gabenVon,
  genommenMap,
  geprueftVor,
  hakeGabe,
  kurFertig,
  medZeile,
  notfallText,
  notfallUeberfaellig,
  notfallZeilen,
  offeneGaben,
} from '../../lib/familie';

import {
  AddRow,
  BackHead,
  CountdownForm,
  ErinnerungForm,
  FamilyItem,
  GroupedChecklist,
  parseSwissDate,
  MedicationAddRow,
  Member,
  Notrufliste,
  Styles,
  TwoFieldForm,
  isoInDays,
} from './bausteine';

/** Was jedes dieser Module braucht.
 *
 *  Ein Objekt und keine sieben einzelnen Eigenschaften: Wer das nächste
 *  Modul herauszieht, erweitert eine Zeile statt sieben Aufrufe - und
 *  genau daran scheitern solche Schnitte sonst auf halbem Weg. */
export interface Modulrahmen {
  data: Record<string, FamilyItem[] | undefined>;
  styles: Styles;
  colors: Colors;
  /** Zurück zur Modul-Übersicht. */
  goBack: () => void;
  add: (collection: string, item: FamilyItem) => void | Promise<unknown>;
  update: (collection: string, id: string, patch: FamilyItem) => void | Promise<unknown>;
  remove: (collection: string, id: string) => void | Promise<unknown>;
  /** Wer im Haushalt auswählbar ist - nur die Medikamente brauchen es. */
  members?: Member[];
  /** Wer gerade angemeldet ist - für «genommen von». */
  ich?: string;
  /** Wer eine Push-Nachricht bekommen kann - nur die Erinnerungen
   *  brauchen es. Leer heisst: keine Auswahl, und das Formular sagt es
   *  dazu (Gäste bekommen vom Hub 403). */
  pushZiele?: string[];
}


export function Notfallblatt({
  data,
  styles,
  colors,
  goBack,
  add,
  update,
  remove,
}: Modulrahmen) {
  // Welcher Eintrag gerade aufgeklappt ist. Lebt jetzt hier statt im
  // Bildschirm darüber: Er wurde nirgends sonst gebraucht, und ein
  // Zustand, der eine Datei weiter oben wohnt als sein einziger
  // Benutzer, ist genau die Art Faden, die so eine Datei gross macht.
  const [notfallOffen, setNotfallOffen] = useState<string | null>(null);
  const eintraege: FamilyItem[] = data.emergency ?? [];
  const heute = new Date();
  // Der jüngste Prüfvermerk zählt fürs ganze Blatt: Geprüft wird es als
  // Ganzes, nicht Person für Person.
  const zuletzt = eintraege
    .map((eintrag) => String(eintrag.checked ?? ''))
    .filter(Boolean)
    .sort()
    .pop();
  const ueberfaellig = eintraege.length > 0 && notfallUeberfaellig(zuletzt, heute);
  const tage = geprueftVor(zuletzt, heute);

  return (
    <View style={styles.stack}>
      <BackHead title="Notfallblatt" onBack={goBack} styles={styles} colors={colors} />
      <Text style={styles.hint}>
        Was jemand wissen muss, der im Ernstfall bei euch ist. Bewusst
        kurz und auf einer Seite: Im Notfall liest niemand einen Ordner,
        und niemand sucht – man liest der Reihe nach.
      </Text>
      <Text style={styles.formHintSmall}>
        Keine Passwörter und keine Kartennummern hier hinein – dieses Blatt
        zeigt man im Zweifel einer fremden Person.
      </Text>

      {/* Die Notrufnummern pflegt niemand, und im Ernstfall sucht sie
          auch niemand. */}
      <Notrufliste styles={styles} colors={colors} />

      {eintraege.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            onPress={() =>
              Share.share({ message: notfallText(eintraege) }).catch(() => {})
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="share-outline" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>Als eine Seite teilen</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Ein Blatt von vorletztem Jahr ist gefährlicher als keines: Man
          verlässt sich darauf, und die Nummer der Kinderärztin stimmt
          nicht mehr. */}
      {eintraege.length > 0 ? (
        <Card style={styles.listCard}>
          <View style={styles.checkRow}>
            <Ionicons
              name={ueberfaellig ? 'alert-circle' : 'checkmark-circle'}
              size={20}
              color={ueberfaellig ? colors.warn : colors.on}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkText}>
                {tage === null
                  ? 'Noch nie geprüft'
                  : tage === 0
                    ? 'Heute geprüft'
                    : `Zuletzt geprüft vor ${tage} Tagen`}
              </Text>
              <Text style={styles.checkSub}>
                Stimmen Nummern, Allergien und Versicherung noch?
              </Text>
            </View>
            <Pressable
              onPress={() => {
                const stempel = isoInDays(0);
                for (const eintrag of eintraege) {
                  update('emergency', eintrag.id, { checked: stempel });
                }
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.chipText}>Geprüft</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {eintraege.map((eintrag: FamilyItem) => (
        <Card key={eintrag.id} style={styles.listCard}>
          <View style={styles.checkRow}>
            <Text style={[styles.contactName, { flex: 1 }]}>{eintrag.text}</Text>
            <Pressable
              onPress={() =>
                setNotfallOffen(notfallOffen === eintrag.id ? null : eintrag.id)
              }
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${eintrag.text} bearbeiten`}
            >
              <Ionicons
                name={notfallOffen === eintrag.id ? 'chevron-up' : 'create-outline'}
                size={18}
                color={colors.inkSoft}
              />
            </Pressable>
            <Pressable
              onPress={() => remove('emergency', eintrag.id)}
              style={styles.deleteTap}
              accessibilityLabel={`${eintrag.text} löschen`}
            >
              <Ionicons name="close" size={18} color={colors.inkFaint} />
            </Pressable>
          </View>

          {notfallOffen === eintrag.id ? (
            <>
              {NOTFALL_FELDER.map((feld) => (
                <View key={feld.key} style={{ gap: 4 }}>
                  <Text style={styles.formHintSmall}>{feld.label}</Text>
                  <TextInput
                    style={styles.input}
                    defaultValue={String(eintrag[feld.key] ?? '')}
                    placeholder={feld.placeholder}
                    placeholderTextColor={colors.inkFaint}
                    onEndEditing={(event) =>
                      update('emergency', eintrag.id, {
                        [feld.key]: event.nativeEvent.text.trim(),
                      })
                    }
                  />
                </View>
              ))}
              <Text style={styles.formHintSmall}>Sonst noch</Text>
              <TextInput
                style={[styles.input, { minHeight: 70 }]}
                defaultValue={String(eintrag.body ?? '')}
                multiline
                placeholder="Alles, wofür es oben kein Feld gibt"
                placeholderTextColor={colors.inkFaint}
                onEndEditing={(event) =>
                  update('emergency', eintrag.id, {
                    body: event.nativeEvent.text.trim(),
                  })
                }
              />
            </>
          ) : (
            <>
              {notfallZeilen(eintrag).map((zeile) => (
                <View key={zeile.label} style={styles.checkRow}>
                  <Text style={styles.checkSub}>{zeile.label}</Text>
                  <Text style={[styles.checkText, { flex: 1 }]} selectable>
                    {zeile.wert}
                  </Text>
                </View>
              ))}
              {eintrag.body ? (
                <Text style={styles.checkSub} selectable>
                  {eintrag.body}
                </Text>
              ) : null}
              {notfallZeilen(eintrag).length === 0 && !eintrag.body ? (
                <Text style={styles.checkSub}>
                  Noch nichts ausgefüllt – auf den Stift tippen.
                </Text>
              ) : null}
            </>
          )}
        </Card>
      ))}

      {/* Anlegen braucht nur den Namen: Die Felder füllt man danach, und
          ein Formular mit sieben leeren Zeilen schreckt ab. */}
      <AddRow
        placeholder="Für wen? (z.B. Lina)"
        onAdd={(text) => add('emergency', { text, checked: isoInDays(0) })}
        styles={styles}
        colors={colors}
      />
    </View>
  );
}

export function Medikamente({
  data,
  styles,
  colors,
  goBack,
  add,
  update,
  remove,
  members = [],
  ich,
}: Modulrahmen) {
  // Welcher Verlauf gerade aufgeklappt ist, und die Rückfrage bei einer
  // zweiten Gabe. Beides lebte im Bildschirm darüber und wurde nirgends
  // sonst gebraucht - ein Zustand, der eine Datei weiter oben wohnt als
  // sein einziger Benutzer, ist genau die Art Faden, die so eine Datei
  // gross macht.
  const [medVerlauf, setMedVerlauf] = useState<string | null>(null);
  const [dosisFrage, setDosisFrage] = useState<{
    medId: string;
    gabe: string;
    text: string;
  } | null>(null);
  const liste: FamilyItem[] = data.medications ?? [];
  const heute = isoInDays(0);
  const stunde = new Date().getHours();

  const hakeGabeAb = (med: FamilyItem, gabe: string, schon: boolean) => {
    const stand = hakeGabe(med, heute, gabe);
    update('medications', med.id, {
      taken: stand.taken,
      done: stand.done,
      log: [
        ...(Array.isArray(med.log) ? med.log : []),
        {
          day: heute,
          slot: gabe,
          by: ich ?? '?',
          at: new Date().toISOString(),
          undo: schon,
        },
      ].slice(-60),
    });
  };

  return (
    <View style={styles.stack}>
      <BackHead title="Medikamente" onBack={goBack} styles={styles} colors={colors} />
      <Text style={styles.hint}>
        Für Kuren über mehrere Tage: Antibiotika, Tropfen, Salben. Ein
        Häkchen je Gabe – so sieht man am Abend, ob es schon jemand
        gegeben hat, statt zu raten. Was fällig wird, meldet der Hub.
      </Text>
      <Card style={styles.listCard}>
        <MedicationAddRow
          members={members}
          onAdd={(werte) =>
            add('medications', {
              text: werte.text,
              member: werte.member,
              days: werte.days,
              times: werte.times,
              ...(werte.dose ? { dose: werte.dose } : {}),
              ...(werte.reason ? { reason: werte.reason } : {}),
              taken: {},
              done: false,
            })
          }
          styles={styles}
          colors={colors}
        />
      </Card>

      {liste.map((med: FamilyItem) => {
        const fertig = kurFertig(med);
        const genommen = genommenMap(med)[heute] ?? [];
        const faellig = offeneGaben(med, heute, stunde);
        return (
          <Card
            key={med.id}
            style={{ ...styles.listCard, ...(fertig ? { opacity: 0.5 } : {}) }}
          >
            <View style={styles.checkRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>{med.text}</Text>
                <Text style={styles.checkSub}>{medZeile(med, heute)}</Text>
                {med.reason ? (
                  <Text style={styles.checkSub}>{med.reason}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() =>
                  setMedVerlauf(medVerlauf === med.id ? null : med.id)
                }
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Verlauf von ${med.text}`}
              >
                <Ionicons
                  name={medVerlauf === med.id ? 'chevron-up' : 'time-outline'}
                  size={18}
                  color={colors.inkSoft}
                />
              </Pressable>
              <Pressable
                onPress={() => remove('medications', med.id)}
                style={styles.deleteTap}
                accessibilityLabel={`${med.text} löschen`}
              >
                <Ionicons name="close" size={18} color={colors.inkFaint} />
              </Pressable>
            </View>

            {/* Ein Knopf je Gabe statt einem je Tag: Antibiotika sind
                meist dreimal täglich, und die Abendgabe ist die, die
                untergeht. Was noch nicht an der Reihe ist, bleibt blass -
                abhaken kann man es trotzdem, wenn es früher passt. */}
            {!fertig ? (
              <View style={styles.chipRow}>
                {gabenVon(med).map((gabe) => {
                  const schon = genommen.includes(gabe);
                  const jetzt = faellig.includes(gabe);
                  return (
                    <Pressable
                      key={gabe}
                      onPress={() => {
                        // Der gefährliche Fall: abgehakt, zurückgenommen,
                        // wieder offen - dann erst fragen, dann geben
                        // (lib/doppeldosis.ts).
                        const frage = doppeldosisFrage(
                          Array.isArray(med.log) ? med.log : [],
                          heute,
                          gabe,
                          schon
                        );
                        if (frage) {
                          setDosisFrage({ medId: med.id, gabe, text: frage });
                          return;
                        }
                        hakeGabeAb(med, gabe, schon);
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: schon }}
                      accessibilityLabel={`${med.text} ${gabe} abhaken`}
                      style={[
                        styles.chip,
                        schon && styles.chipActive,
                        !schon && jetzt && { borderColor: colors.warn },
                      ]}
                    >
                      <Ionicons
                        name={schon ? 'checkmark-circle' : 'ellipse-outline'}
                        size={14}
                        color={schon ? '#FFFFFF' : jetzt ? colors.warn : colors.inkFaint}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          schon && styles.chipTextActive,
                          !schon && !jetzt && { color: colors.inkFaint },
                        ]}
                      >
                        {gabe}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* «Wann von wem» – genau danach fragt der Arzt beim nächsten
                Termin, und genau das weiss abends niemand mehr. */}
            {medVerlauf === med.id ? (
              <View style={{ gap: 4 }}>
                {(Array.isArray(med.log) ? [...med.log].reverse() : [])
                  .slice(0, 12)
                  .map((eintrag: FamilyItem, index: number) => (
                    <Text key={index} style={styles.checkSub}>
                      {eintrag.undo ? '↩ ' : '✓ '}
                      {eintrag.day} {eintrag.slot} – {eintrag.by}
                    </Text>
                  ))}
                {!Array.isArray(med.log) || med.log.length === 0 ? (
                  <Text style={styles.checkSub}>Noch nichts abgehakt.</Text>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {liste.length === 0 ? (
        <Text style={styles.hint}>Nichts eingetragen.</Text>
      ) : null}

      {/* Die Doppeldosis-Rückfrage: nachfragen, nicht verbieten -
          vielleicht war das Zurücknehmen ja richtig. */}
      <Modal
        visible={dosisFrage != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDosisFrage(null)}
      >
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Ionicons name="warning-outline" size={26} color={colors.warn} />
            <Text style={styles.title}>Schon einmal abgehakt</Text>
            <Text style={styles.hint}>{dosisFrage?.text}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setDosisFrage(null)}
                accessibilityRole="button"
                style={[styles.chip, { flex: 1, alignItems: 'center' }]}
              >
                <Text style={styles.chipText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const frage = dosisFrage;
                  setDosisFrage(null);
                  const med = liste.find((eintrag) => eintrag.id === frage?.medId);
                  if (med && frage) hakeGabeAb(med, frage.gabe, false);
                }}
                accessibilityRole="button"
                style={[styles.chip, { flex: 1, alignItems: 'center' }]}
              >
                <Text style={[styles.chipText, { color: colors.warnInk, fontWeight: '700' }]}>
                  Trotzdem abhaken
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function Packlisten({
  data,
  styles,
  colors,
  goBack,
  add,
  update,
  remove,
}: Modulrahmen) {
  return (
    <View style={styles.stack}>
      <BackHead title="Packlisten" onBack={goBack} styles={styles} colors={colors} />
      <GroupedChecklist
        items={data.packlists ?? []}
        groupNoun="Packliste"
        itemPlaceholder="Was mitkommt …"
        onAdd={(group, text) => add('packlists', { group, text, done: false })}
        onToggle={(item) => update('packlists', item.id, { done: !item.done })}
        onDelete={(item) => remove('packlists', item.id)}
        onResetGroup={(group) =>
          (data.packlists ?? [])
            .filter((item) => item.group === group && item.done)
            .forEach((item) => update('packlists', item.id, { done: false }))
        }
        onDeleteGroup={(group) =>
          (data.packlists ?? [])
            .filter((item) => item.group === group)
            .forEach((item) => remove('packlists', item.id))
        }
        styles={styles}
        colors={colors}
      />
    </View>
  );
}

export function Erinnerungen({
  data,
  styles,
  colors,
  goBack,
  add,
  update,
  remove,
  pushZiele = [],
}: Modulrahmen) {
  // Welche Erinnerung gerade im Formular zum Bearbeiten steht - der
  // ganze Eintrag, nicht nur die id: Das Formular setzt daraus seine
  // Startwerte, und die sollen der Stand vom Moment des Stift-Tippens
  // sein, nicht was ein Live-Update dazwischenschiebt.
  //
  // Der Bildschirm darüber brauchte dafür einen Aufräum-Effekt («beim
  // Verlassen der Kachel auf null»). Hier braucht es ihn nicht mehr:
  // Beim Verlassen wird diese Komponente abgebaut, und der Zustand geht
  // mit - genau das ist der Gewinn des Schnitts (Punkt 423).
  const [erinnerungBearbeiten, setErinnerungBearbeiten] = useState<Erinnerung | null>(null);
  const erinnerungen = offene(data.reminders as Erinnerung[] | undefined);
  const jetzt = Date.now();
  return (
    <View style={styles.stack}>
      <BackHead title="Erinnerungen" onBack={goBack} styles={styles} colors={colors} />
      <Text style={styles.hint}>
        Zur eingestellten Zeit erscheint die Erinnerung gross auf jedem
        offenen Bildschirm - und bleibt, bis jemand sie bestätigt. Auf
        Wunsch schickt der Hub sie stattdessen oder zusätzlich als
        Push-Nachricht an ausgewählte Haushaltsmitglieder.
      </Text>
      {erinnerungen.map((erinnerung) => {
        const at = Number(erinnerung.at);
        const faellig = at <= jetzt;
        // Woran erkennt man in der Liste, was diese Erinnerung tut?
        // Bildschirm ist die Regel und bleibt unerwähnt; Push und
        // «nur Push» stehen dabei, samt Empfängern.
        const mitPush = erinnerung.push === true;
        const pushAn = Array.isArray(erinnerung.push_an)
          ? erinnerung.push_an.filter((name): name is string => typeof name === 'string')
          : [];
        const wiederholt = wiederholungVon(erinnerung);
        const zusatz =
          (wiederholt ? ` · ${wiederholungsLabel(wiederholt)}` : '') +
          (mitPush
            ? ` · Push an ${pushAn.length > 0 ? pushAn.join(', ') : 'alle'}${
                erinnerung.anzeigen === false ? ' (ohne Bildschirm)' : ''
              }`
            : '');
        return (
          <Card key={erinnerung.id} style={styles.rewardCard}>
            <Ionicons
              name={faellig ? 'alarm' : 'alarm-outline'}
              size={22}
              color={faellig ? colors.warn : colors.inkSoft}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkText}>{String(erinnerung.text ?? '')}</Text>
              <Text style={[styles.checkSub, faellig && { color: colors.warnInk }]}>
                {faellig
                  ? `Fällig seit ${datumUhr(at)} - wartet auf Bestätigung`
                  : datumUhr(at) + zusatz}
              </Text>
            </View>
            {faellig ? (
              <Pressable
                // Wiederkehrende erledigt das Häkchen nicht - es stellt
                // sie auf den nächsten Termin weiter (bestaetigung()).
                onPress={() =>
                  update('reminders', erinnerung.id, bestaetigung(erinnerung, Date.now()))
                }
                style={styles.deleteTap}
                accessibilityRole="button"
                accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» bestätigen`}
              >
                <Ionicons name="checkmark-circle" size={22} color={colors.on} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setErinnerungBearbeiten(erinnerung)}
              style={styles.deleteTap}
              accessibilityRole="button"
              accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» bearbeiten`}
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={
                  erinnerungBearbeiten?.id === erinnerung.id
                    ? colors.accent
                    : colors.inkFaint
                }
              />
            </Pressable>
            <Pressable
              onPress={() => remove('reminders', erinnerung.id)}
              style={styles.deleteTap}
              accessibilityRole="button"
              accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» löschen`}
            >
              <Ionicons name="close" size={18} color={colors.inkFaint} />
            </Pressable>
          </Card>
        );
      })}
      {/* Der key wechselt mit dem Eintrag: Das Formular setzt seine
          Startwerte nur beim Aufbau - so springt es beim Stift-Tipp
          sauber auf den gewählten Eintrag um. */}
      <ErinnerungForm
        key={erinnerungBearbeiten?.id ?? 'neu'}
        vorgabe={erinnerungBearbeiten ?? undefined}
        onCancel={
          erinnerungBearbeiten ? () => setErinnerungBearbeiten(null) : undefined
        }
        onAdd={(eintrag) => {
          if (erinnerungBearbeiten) {
            // Bearbeitet heisst neu aufgesetzt: Ein schon verschickter
            // Push und die «schon gesehen»-Liste gehörten zum alten
            // Termin - wer die Zeit verschiebt, will wieder gemeldet
            // werden.
            update('reminders', erinnerungBearbeiten.id, {
              ...eintrag,
              quittiert: [],
              pushed: false,
            });
            setErinnerungBearbeiten(null);
          } else {
            add('reminders', eintrag);
          }
        }}
        mitglieder={pushZiele}
        styles={styles}
        colors={colors}
      />
    </View>
  );
}

export function Countdowns({
  data,
  styles,
  colors,
  goBack,
  add,
  update,
  remove,
}: Modulrahmen) {
  const countdowns: FamilyItem[] = data.countdowns ?? [];
  return (
    <View style={styles.stack}>
      <BackHead title="Countdowns" onBack={goBack} styles={styles} colors={colors} />
      <Text style={styles.hint}>
        Der Stern zeigt einen Countdown zusätzlich auf der Startseite.
      </Text>
      {countdowns.map((countdown) => {
        const target = parseSwissDate(countdown.date);
        const days =
          target != null ? Math.ceil((target.getTime() - Date.now()) / 86_400_000) : null;
        return (
          <Card key={countdown.id} style={styles.rewardCard}>
            <View style={styles.daysBubble}>
              <Text style={styles.daysNumber}>{days ?? '?'}</Text>
              <Text style={styles.daysLabel}>Tage</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkText}>{countdown.text}</Text>
              <Text style={styles.checkSub}>{countdown.date}</Text>
            </View>
            <Pressable
              onPress={() =>
                update('countdowns', countdown.id, { on_start: !countdown.on_start })
              }
              style={styles.deleteTap}
              accessibilityLabel="Auf Startseite anzeigen"
            >
              <Ionicons
                name={countdown.on_start ? 'star' : 'star-outline'}
                size={20}
                color={countdown.on_start ? colors.warn : colors.inkFaint}
              />
            </Pressable>
            <Pressable
              onPress={() => remove('countdowns', countdown.id)}
              style={styles.deleteTap}
              accessibilityRole="button"
              accessibilityLabel={`Countdown «${countdown.text}» löschen`}
            >
              <Ionicons name="close" size={18} color={colors.inkFaint} />
            </Pressable>
          </Card>
        );
      })}
      <CountdownForm
        onAdd={(text, date, onStart) =>
          add('countdowns', { text, date, on_start: onStart })
        }
        styles={styles}
        colors={colors}
      />
    </View>
  );
}

export function Dokumente({
  data,
  styles,
  colors,
  goBack,
  add,
  remove,
}: Modulrahmen) {
  const documents: FamilyItem[] = data.documents ?? [];
  return (
    <View style={styles.stack}>
      <BackHead title="Dokumentsafe" onBack={goBack} styles={styles} colors={colors} />
      <Text style={styles.hint}>
        Wichtige Angaben und Ablageorte (z.B. «Pass im Tresor», Policen-Nummern,
        Links). Dateien selbst gehören in deine Cloud-Ablage.
      </Text>
      {documents.map((document) => (
        <Card key={document.id} style={styles.pinCard}>
          <Text style={styles.checkText}>{document.text}</Text>
          {document.body ? (
            <Text selectable style={styles.checkSub}>
              {document.body}
            </Text>
          ) : null}
          <View style={styles.pinFoot}>
            <Text style={styles.checkSub}>{document.author}</Text>
            <Pressable
              onPress={() => remove('documents', document.id)}
              style={styles.deleteTap}
              accessibilityRole="button"
              accessibilityLabel={`Eintrag «${document.text}» löschen`}
            >
              <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
            </Pressable>
          </View>
        </Card>
      ))}
      <TwoFieldForm
        labels={['Titel (z.B. Hausrat-Police)', 'Angaben / Ablageort']}
        multilineSecond
        onAdd={(text, body) => add('documents', { text, body })}
        styles={styles}
        colors={colors}
      />
    </View>
  );
}
