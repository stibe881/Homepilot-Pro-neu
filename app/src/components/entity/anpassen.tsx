/**
 * Anpassen-Dialoge einer Kachel: Raum, Name, Gruppe.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CommandData, Entity } from '../../api/types';
import {
  GeraetOption,
  begrenzt,
  naechsterWert,
  optionenVon,
  wertText,
  wertWort,
} from '../../lib/geraeteoptionen';
import { KachelEintrag } from '../../lib/kachelmenue';
import { useColors } from '../../theme';
import { Tastaturplatz } from '../Tastaturplatz';
import { makeStyles } from './stil';

/**
 * Die Zimmer eines Geräts wählen - eines oder mehrere (Punkt 539).
 *
 * Gewünscht im Haus: «man soll einen Sensor auch mehreren Räumen
 * zuweisen können». Der Fall ist der offene Wohnbereich: ein
 * Klimafühler, und Wohnzimmer wie Esszimmer sollen ihn zeigen.
 *
 * Das erste gewählte Zimmer ist der **Standort** - dort liegt die
 * Kachel des Geräts, und daher kommt sein Namensvorschlag. Es steht
 * darum ausdrücklich als solcher da: Ohne den Hinweis sähe die Liste
 * aus wie eine beliebige Mehrfachauswahl, und dass die Reihenfolge
 * etwas bedeutet, merkte man erst, wenn die Kachel woanders auftaucht.
 *
 * Geschlossen wird von Hand und nicht beim ersten Tipp - wer zwei
 * Zimmer wählen will, käme sonst nie zum zweiten.
 */
export function RoomPicker({
  visible,
  current,
  rooms,
  onClose,
  onSelect,
}: {
  visible: boolean;
  /** Die zugewiesenen Zimmer, Standort zuerst. */
  current: string[];
  rooms: string[];
  onClose: () => void;
  onSelect: (rooms: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [gewaehlt, setGewaehlt] = useState<string[]>(current);
  // Beim Öffnen den gespeicherten Stand nehmen: Das Blatt bleibt
  // montiert, und ohne das stünde beim zweiten Öffnen die Wahl von
  // vorhin da - auch wenn sie inzwischen verworfen wurde.
  useEffect(() => {
    if (visible) setGewaehlt(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const umschalten = (name: string) =>
    setGewaehlt((vorher) =>
      vorher.includes(name) ? vorher.filter((eintrag) => eintrag !== name) : [...vorher, name]
    );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Räume wählen</Text>
          <ScrollView>
            <Pressable
              onPress={() => setGewaehlt([])}
              accessibilityRole="button"
              accessibilityState={{ selected: gewaehlt.length === 0 }}
              style={[styles.roomOption, gewaehlt.length === 0 && styles.roomOptionActive]}
            >
              <Text style={styles.roomOptionText}>Kein Raum</Text>
              {gewaehlt.length === 0 ? (
                <Ionicons name="checkmark" size={20} color={colors.accent} />
              ) : null}
            </Pressable>
            {rooms.map((name) => {
              const rang = gewaehlt.indexOf(name);
              const aktiv = rang >= 0;
              return (
                <Pressable
                  key={name}
                  onPress={() => umschalten(name)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: aktiv }}
                  accessibilityLabel={
                    rang === 0 ? `${name}, Standort` : name
                  }
                  style={[styles.roomOption, aktiv && styles.roomOptionActive]}
                >
                  <Text style={styles.roomOptionText}>{name}</Text>
                  {rang === 0 ? <Text style={styles.roomStandort}>Standort</Text> : null}
                  {aktiv ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {gewaehlt.length > 1 ? (
            <Text style={styles.roomHinweis}>
              Das Gerät zählt in allen gewählten Zimmern. Seine Kachel steht im
              Standort – das ist das zuerst gewählte.
            </Text>
          ) : null}
          <Pressable
            onPress={() => onSelect(gewaehlt)}
            accessibilityRole="button"
            style={styles.roomFertig}
          >
            <Text style={styles.roomFertigText}>Fertig</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Das Anpassen-Blatt einer Kachel.
 *
 * Die Knöpfe standen bisher auf der Kachel selbst: zwei Chips für Raum
 * und Gruppe, darunter bis zu fünf beschriftete Symbole. Auf einer
 * halbbreiten Telefonkachel brauchen vier davon rund 320 Punkte Breite
 * und bekommen 180 - sie brachen also um, die Chips ebenso, und der
 * Griff zum Verschieben lag über dem Raum-Chip. Der Inhalt der Kachel
 * rutschte so weit nach unten, dass zwei Stück einen Bildschirm
 * füllten.
 *
 * Hier ist Platz: eine Zeile je Einstellung, über die ganze Breite,
 * mit ausgeschriebenem Namen und dem, was gerade gilt. Und alles zu
 * einem Gerät an einem Ort statt verteilt auf Chips, Symbole und einen
 * langen Druck.
 */
export function AnpassenBlatt({
  visible,
  titel,
  zeilen,
  onClose,
  entity,
  onCommand,
}: {
  visible: boolean;
  titel: string;
  /** Das Gerät selbst - für die Abschnitte «Gerät einstellen» (Punkt
   *  631) und «Nach Stromausfall» (Punkt 630) unter den Zeilen. Beide
   *  schicken Befehle, darum der Griff dazu; fehlt er, fehlen sie. */
  entity?: Entity;
  onCommand?: (command: string, data?: CommandData) => void;
  zeilen: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    /** Was gerade gilt – steht rechts, klein und ruhig. */
    wert?: string;
    /** Gesetzt: die Zeile bekommt Farbe. */
    aktiv?: boolean;
    onPress: () => void;
  }[];
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <View style={styles.blattKopf}>
            <Text style={[styles.roomSheetTitle, { flex: 1, marginBottom: 0 }]} numberOfLines={2}>
              {titel}
            </Text>
            <Pressable onPress={onClose} accessibilityLabel="Fertig" hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView>
            {zeilen.map((zeile) => (
              <Pressable
                key={zeile.key}
                onPress={zeile.onPress}
                accessibilityRole="button"
                accessibilityLabel={
                  zeile.wert ? `${zeile.label}: ${zeile.wert}` : zeile.label
                }
                style={({ pressed }) => [styles.blattZeile, pressed && { opacity: 0.6 }]}
              >
                <Ionicons
                  name={zeile.icon}
                  size={19}
                  color={zeile.aktiv ? colors.accent : colors.inkSoft}
                />
                <Text
                  style={[styles.blattLabel, zeile.aktiv && { color: colors.accent }]}
                  numberOfLines={1}
                >
                  {zeile.label}
                </Text>
                {zeile.wert ? (
                  <Text style={styles.blattWert} numberOfLines={1}>
                    {zeile.wert}
                  </Text>
                ) : null}
              </Pressable>
            ))}
            {entity && onCommand ? (
              <GeraetEinstellungen entity={entity} onCommand={onCommand} />
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * «Gerät einstellen» im Anpassen-Blatt (Punkt 631 der Werkbank).
 *
 * Nachlaufzeit, Empfindlichkeit, Temperatur-Abgleich, LED - was das
 * Gerät stellen lässt, gab es nur in der Zigbee2MQTT-Oberfläche auf
 * Port 8099. Jetzt steht es dort, wo man das Gerät ohnehin anpasst.
 *
 * Je Art ein Bedienelement: Zahlen mit «−», Feld und «+» (der Schritt
 * kommt aus lib/geraeteoptionen.ts), Ja/Nein und Auswahllisten als
 * Chips. Gezeigt wird immer, was der Hub zuletzt vom Gerät gehört hat -
 * kein eigener Zwischenstand, der nach einem abgelehnten Befehl falsch
 * dastünde. Ein schlafender Melder nimmt den Wert erst beim nächsten
 * Aufwachen; bis dahin steht der alte da, und das ist die Wahrheit.
 */
function GeraetEinstellungen({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const optionen = optionenVon(entity);
  if (optionen.length === 0) return null;
  const setze = (name: string, value: number | string | boolean) =>
    onCommand('set_option', { name, value });
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceBorder }}>
      <Text style={[styles.roomSheetTitle, { fontSize: 14, marginTop: 12 }]}>
        Gerät einstellen
      </Text>
      {optionen.map((option) => (
        <View key={option.name} style={{ paddingVertical: 8, gap: 6 }}>
          <View style={styles.feinZeile}>
            <Text style={styles.blattLabel}>{option.label}</Text>
            {option.type === 'numeric' ? (
              <Text style={styles.blattWert}>{wertText(option)}</Text>
            ) : null}
          </View>
          {option.type === 'numeric' ? (
            <ZahlenSteller option={option} onWert={(wert) => setze(option.name, wert)} />
          ) : option.type === 'binary' ? (
            <View style={styles.vorgabenRaster}>
              {[
                { key: true, label: 'An' },
                { key: false, label: 'Aus' },
              ].map((wahl) => (
                <Chip
                  key={String(wahl.key)}
                  label={wahl.label}
                  aktiv={option.value === wahl.key}
                  onPress={() => setze(option.name, wahl.key)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.vorgabenRaster}>
              {(option.values ?? []).map((wert) => (
                <Chip
                  key={wert}
                  label={wertWort(wert)}
                  aktiv={option.value === wert}
                  onPress={() => setze(option.name, wert)}
                />
              ))}
            </View>
          )}
        </View>
      ))}
      <Text style={styles.roomHinweis}>
        Der Hub zeigt, was das Gerät zuletzt gemeldet hat. Ein Melder mit Batterie
        übernimmt eine Änderung erst, wenn er das nächste Mal aufwacht.
      </Text>
    </View>
  );
}

/** Ein Chip der Auswahl - gewählt ist der dunkle. */
function Chip({ label, aktiv, onPress }: { label: string; aktiv: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: aktiv }}
      style={({ pressed }) => [styles.vorgabe, aktiv && styles.vorgabeAn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.vorgabeText, aktiv && styles.vorgabeTextAn]}>{label}</Text>
    </Pressable>
  );
}

/**
 * «−», ein Feld, «+» für eine Zahl mit Bereich.
 *
 * Das Feld nimmt das Getippte erst beim Verlassen: Wer «−0.8» tippt,
 * soll nicht nach dem Minus schon einen Befehl auslösen.
 */
function ZahlenSteller({
  option,
  onWert,
}: {
  option: GeraetOption;
  onWert: (wert: number) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gemeldet = option.value === null || option.value === undefined ? '' : String(option.value);
  const [text, setText] = useState(gemeldet);
  // Meldet das Gerät einen neuen Wert, gilt der - auch im Feld.
  useEffect(() => setText(gemeldet), [gemeldet]);
  const uebernehmen = () => {
    const zahl = Number(text.replace(',', '.').replace('−', '-'));
    if (!Number.isFinite(zahl)) {
      setText(gemeldet);
      return;
    }
    const ziel = begrenzt(option, zahl);
    if (String(ziel) !== gemeldet) onWert(ziel);
    else setText(gemeldet);
  };
  const knopf = (zeichen: '−' | '+', richtung: 1 | -1) => (
    <Pressable
      onPress={() => onWert(naechsterWert(option, richtung))}
      accessibilityRole="button"
      accessibilityLabel={`${option.label} ${zeichen === '+' ? 'erhöhen' : 'verringern'}`}
      hitSlop={6}
      style={({ pressed }) => [styles.vorgabe, { flexBasis: 56, flexGrow: 0 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.vorgabeText}>{zeichen}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.vorgabenRaster, { alignItems: 'center', flexWrap: 'nowrap' }]}>
      {knopf('−', -1)}
      <TextInput
        style={[styles.renameInput, { flex: 1, marginBottom: 0, paddingVertical: 8, textAlign: 'center' }]}
        value={text}
        onChangeText={setText}
        onBlur={uebernehmen}
        onSubmitEditing={uebernehmen}
        keyboardType="numbers-and-punctuation"
        placeholder="–"
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={option.label}
      />
      {knopf('+', 1)}
    </View>
  );
}

/**
 * Die kleine Auswahl nach einem langen Druck auf eine Kachel.
 *
 * Sie erscheint nur, wenn es wirklich etwas zu wählen gibt: Bleibt ein
 * Eintrag übrig, führt die Kachel ihn sofort aus. Eine Auswahl mit einer
 * einzigen Zeile wäre ein Klick mehr für nichts.
 */
export function KachelMenue({
  visible,
  titel,
  ursache,
  kette,
  eintraege,
  onClose,
  onSelect,
}: {
  visible: boolean;
  titel: string;
  /** «seit 20 Min · Ablauf «Bewegung Flur»» – die Antwort auf «warum ist
   *  das an?», dort, wo man das Gerät gerade in der Hand hat. */
  ursache?: string | null;
  /** «Bewegung Flur → Licht bei Bewegung → Licht Wohnzimmer» – die
   *  Kette dahinter, wo der Hub sie kennt. Die kurze Antwort zog sonst
   *  jedes Mal die nächste Frage nach sich: welche Bewegung? */
  kette?: string | null;
  eintraege: KachelEintrag[];
  onClose: () => void;
  onSelect: (eintrag: KachelEintrag) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle} numberOfLines={1}>
            {titel}
          </Text>
          {ursache ? <Text style={styles.menueUrsache}>{ursache}</Text> : null}
          {kette ? <Text style={styles.menueKette}>{kette}</Text> : null}
          {eintraege.map((eintrag) => (
            <Pressable
              key={eintrag.id}
              onPress={() => onSelect(eintrag)}
              accessibilityRole="button"
              accessibilityLabel={eintrag.label}
              style={({ pressed }) => [
                styles.roomOption,
                pressed && styles.roomOptionActive,
              ]}
            >
              <Text style={styles.roomOptionText}>{eintrag.label}</Text>
              <Ionicons
                name={eintrag.icon as keyof typeof Ionicons.glyphMap}
                size={19}
                color={colors.inkFaint}
              />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Umbenennen-Dialog: ein Textfeld mit dem aktuellen Namen vorbelegt. */
export function RenameDialog({
  visible,
  current,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(current);
  // Bei jedem Öffnen mit dem aktuellen Namen starten.
  useEffect(() => {
    if (visible) setName(current);
  }, [visible, current]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Der neue Gerätename wird getippt - ohne das läge die Tastatur auf
          dem Feld (Punkt 265 der Werkbank). */}
      <Tastaturplatz>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Gerät umbenennen</Text>
          <TextInput
            style={styles.renameInput}
            value={name}
            onChangeText={setName}
            placeholder="Neuer Name"
            placeholderTextColor={colors.inkFaint}
            autoFocus
          />
          <View style={styles.renameRow}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameGhost, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.renameGhostText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(name.trim())}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.renameSaveText}>Speichern</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
      </Tastaturplatz>
    </Modal>
  );
}

/** Gruppenauswahl im Anpassen-Modus: bestehende Gruppen plus «neue anlegen». */
export function GroupPicker({
  visible,
  current,
  groups,
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string | null;
  groups: string[];
  onClose: () => void;
  onSelect: (group: string | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [fresh, setFresh] = useState('');
  useEffect(() => {
    if (visible) setFresh('');
  }, [visible]);
  const options: { key: string; label: string; value: string | null }[] = [
    { key: '__none', label: 'Keine Gruppe', value: null },
    ...groups.map((name) => ({ key: name, label: name, value: name })),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Der Name einer neuen Gruppe wird getippt, und sein Feld sitzt
          zuunterst im Blatt - dort, wo die Tastatur aufliegt (Punkt 265
          der Werkbank). */}
      <Tastaturplatz>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Gruppe wählen</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const active = option.value === current;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => onSelect(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.roomOption, active && styles.roomOptionActive]}
                >
                  <Text style={styles.roomOptionText}>{option.label}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.renameRow}>
            <TextInput
              style={[styles.renameInput, { flex: 1, marginBottom: 0 }]}
              value={fresh}
              onChangeText={setFresh}
              placeholder="Neue Gruppe …"
              placeholderTextColor={colors.inkFaint}
            />
            <Pressable
              onPress={() => fresh.trim() && onSelect(fresh.trim())}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.renameSaveText}>Anlegen</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
      </Tastaturplatz>
    </Modal>
  );
}

/**
 * Ein Knopf der Anpassen-Leiste: Symbol mit Beschriftung darunter.
 *
 * Die Beschriftung stand lange nur im accessibilityLabel – sichtbar waren
 * vier Symbole nebeneinander. Ein Schloss neben Stift, Stern und Auge liest
 * sich wie «Türschloss» und nicht wie «fragt vor dem Schalten nach»; die
 * Sperre wurde deshalb schlicht nicht gefunden. `caption` ist das kurze
 * Wort für das Auge, `label` bleibt der ganze Satz für die Vorlesefunktion.
 */
export function EditButton({
  icon,
  active,
  label,
  caption,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  label: string;
  /** Kurzes Wort unter dem Symbol. Ohne Angabe bleibt der Knopf nackt. */
  caption?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.editItem, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.editButton}>
        <Ionicons name={icon} size={18} color={active ? colors.accent : colors.ink} />
      </View>
      {caption ? (
        <Text
          style={[styles.editCaption, active && { color: colors.accent }]}
          numberOfLines={1}
        >
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Türöffner (z.B. Ring Intercom): Öffnen braucht zwei Tipps – der erste
 *  bewaffnet den Knopf für vier Sekunden, erst der zweite öffnet wirklich.
 *  Eine Haustür soll sich nicht durch Wischen aus Versehen öffnen. */
