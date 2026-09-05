/**
 * Wiederverwendete Eingabe-Bausteine des Editors: Felder, Auswahl, Geräte-Wähler.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Entity } from '../../api/types';
import { useColors } from '../../theme';
import { deviceKindIcon, deviceKindLabel } from '../../lib/geraeteart';
import {
  NACHLAUF_STUFEN,
  NO_CATEGORY,
  minutenLabel,
  minutenWert,
  nachlaufLabel,
  sekundenWert,
} from './entwurf';
import { makeStyles } from './stil';

export function CategoryField({
  value,
  known,
  onChange,
}: {
  value: string;
  known: string[];
  onChange: (value: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = value.trim();
  return (
    <Field label="Kategorie (optional)">
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="z.B. Beleuchtung"
        placeholderTextColor={colors.inkFaint}
      />
      {known.length > 0 ? (
        <View style={styles.choices}>
          {known.map((name) => {
            const on = name === current;
            return (
              <Pressable
                key={name}
                onPress={() => onChange(on ? '' : name)}
                accessibilityRole="button"
                style={[styles.template, on && styles.templateOn]}
              >
                <Text style={[styles.templateText, on && { color: '#FFFFFF' }]}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Field>
  );
}

/** Zahlenfeld mit eigenem Zwischenstand – auf Modulebene, damit es beim
 *  Tippen nicht bei jedem Zeichen neu montiert wird. */
export function NumberField({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState(value);
  return (
    <TextInput
      style={styles.input}
      value={text}
      onChangeText={setText}
      onBlur={() => onCommit(String(Number(text) || 0))}
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      keyboardType="numbers-and-punctuation"
    />
  );
}

/** Schlüssel des Knopfs, der das Eingabefeld aufklappt. Kann keine
 *  Minutenzahl sein und kollidiert darum mit keiner Vorgabe. */
const EIGEN = 'eigen';

/**
 * Haltedauer: die üblichen Zeiten als Knöpfe, alles andere zum Eintippen.
 *
 * Vorher gab es genau 5, 10 und 30 Minuten. Wer «erst, wenn seit zwei
 * Stunden niemand da ist» wollte, war damit am Ende – die Zahl stand als
 * Sekunden in der gespeicherten Form längst frei, nur eintippen liess sie
 * sich nicht. Wer den Ablauf danach in der App öffnete und speicherte,
 * verlor seinen Wert sogar an die nächste Vorgabe.
 *
 * Ein eingetippter Wert bleibt darum als eigener Knopf stehen und
 * beschriftet sich selbst: «120» steht als «2 Std.» da, damit man beim
 * Hinsehen merkt, wenn eine Null zu viel im Feld gelandet ist.
 */
export function MinutenWahl({
  value,
  options,
  onChange,
  placeholder = 'Minuten, z.B. 45',
}: {
  /** Minuten als Text; leer heisst «sofort». */
  value: string;
  /** Die vorgegebenen Knöpfe, ohne den eigenen. */
  options: { key: string; label: string }[];
  onChange: (minutes: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const vorgabe = options.some((option) => option.key === value);
  // Ein Wert, den keine Vorgabe trifft, klappt das Feld von selbst auf –
  // sonst stünde ein gespeichertes «120» da, ohne dass eine Auswahl
  // markiert wäre.
  const [offen, setOffen] = useState(!vorgabe && !!value);
  const eigen = offen || (!vorgabe && !!value);

  return (
    <>
      <View style={styles.rowGap}>
        <Choice
          options={[
            ...options,
            {
              key: EIGEN,
              label: eigen && value && !vorgabe ? minutenLabel(value) : 'eigene Zeit',
            },
          ]}
          value={eigen ? EIGEN : value}
          onSelect={(key) => {
            if (key === EIGEN) {
              setOffen(true);
              return;
            }
            setOffen(false);
            onChange(key);
          }}
        />
      </View>
      {eigen ? (
        <NumberField
          value={value}
          placeholder={placeholder}
          onCommit={(text) => onChange(minutenWert(text))}
        />
      ) : null}
    </>
  );
}

/**
 * Wie lange eine Lampe an bleibt – der Nachlauf eines Licht-Schritts.
 *
 * Dasselbe Muster wie die Haltedauer oben, aber in Sekunden: Eine halbe
 * Minute im WC ist eine ehrliche Angabe, und der Hub rechnet ohnehin in
 * Sekunden. Eingetippt wird trotzdem in Minuten – wer «45» meint, meint
 * dort keine Sekunden.
 */
export function NachlaufWahl({
  value,
  onChange,
}: {
  /** Sekunden als Text; leer heisst «an lassen». */
  value: string;
  onChange: (seconds: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const vorgabe = NACHLAUF_STUFEN.some((stufe) => stufe.key === value);
  const [offen, setOffen] = useState(!vorgabe && !!value);
  const eigen = offen || (!vorgabe && !!value);

  return (
    <>
      <View style={styles.rowGap}>
        <Choice
          options={[
            ...NACHLAUF_STUFEN,
            {
              key: EIGEN,
              label: eigen && value && !vorgabe ? nachlaufLabel(value) : 'eigene Zeit',
            },
          ]}
          value={eigen ? EIGEN : value}
          onSelect={(key) => {
            if (key === EIGEN) {
              setOffen(true);
              return;
            }
            setOffen(false);
            onChange(key);
          }}
        />
      </View>
      {eigen ? (
        <NumberField
          value={value ? String(Math.round(Number(value) / 60)) : ''}
          placeholder="Minuten, z.B. 15"
          onCommit={(text) => onChange(sekundenWert(text))}
        />
      ) : null}
    </>
  );
}

/** Suchfeld – je Abschnitt eines, damit die Listen unabhängig bleiben. */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.deviceSearch}>
      <Ionicons name="search" size={15} color={colors.inkFaint} />
      <TextInput
        style={styles.deviceSearchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
      />
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Eingabe leeren"
        >
          <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Die Einträge nach Kategorie, jede Kategorie zuklappbar.
 *
 * Bei genau einer Gruppe ohne Namen entfällt die Überschrift: Wer keine
 * Kategorien vergibt, soll auch keine sehen. */
export function Groups<T extends { id: string }>({
  groups,
  open,
  openAll = false,
  onToggle,
  renderItem,
  empty,
}: {
  groups: { category: string; items: T[] }[];
  /** Aufgeklappte Kategorien – alles andere ist zu. */
  open: string[];
  /** Während einer Suche alles offen: Ein Treffer in einer zugeklappten
   *  Kategorie wäre sonst unsichtbar. */
  openAll?: boolean;
  onToggle: (category: string) => void;
  renderItem: (item: T) => React.ReactNode;
  empty: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (groups.length === 0) {
    return <Text style={styles.note}>{empty}</Text>;
  }
  const plain = groups.length === 1 && groups[0].category === NO_CATEGORY;
  if (plain) {
    return <>{groups[0].items.map(renderItem)}</>;
  }

  return (
    <>
      {groups.map((group) => {
        const shut = !openAll && !open.includes(group.category);
        return (
          <View key={group.category} style={{ gap: 10 }}>
            <Pressable
              onPress={() => onToggle(group.category)}
              accessibilityRole="button"
              accessibilityState={{ expanded: !shut }}
              style={styles.groupHead}
            >
              <Ionicons
                name={shut ? 'chevron-forward' : 'chevron-down'}
                size={16}
                color={colors.inkSoft}
              />
              <Text style={styles.groupTitle}>{group.category}</Text>
              <Text style={styles.groupCount}>{group.items.length}</Text>
            </Pressable>
            {!shut ? group.items.map(renderItem) : null}
          </View>
        );
      })}
    </>
  );
}

/**
 * Der Rahmen beider Editoren: Vollbild, feste Kopfleiste, Scrollbereich.
 *
 * Beide Editoren – Ablauf und Szene – hatten denselben Aufbau selbst
 * gebaut und darum auch denselben Fehler: die Kopfzeile als erste Zeile
 * im Scrollbereich, hinter einem festen `paddingTop: 60`. Auf einem
 * Telefon mit hoher Statusleiste stand der Titel unter der Uhr, und
 * unten im Formular war weder «Abbrechen» noch «Speichern» erreichbar,
 * ohne mehrere Bildschirme weit zurückzuscrollen.
 *
 * Abbrechen links, Speichern rechts – die Anordnung, die jedes andere
 * Formular auf dem Gerät auch hat. Dasselbe Wort wie der grosse Knopf
 * am Ende des Formulars: Zwei Knöpfe, die dasselbe tun, dürfen nicht
 * verschieden heissen.
 */
export function EditorRahmen({
  titel,
  onCancel,
  onSave,
  saveGesperrt = false,
  children,
}: {
  titel: string;
  onCancel: () => void;
  /** Fehlt sie, bleibt die rechte Seite leer – der Titel bleibt mittig. */
  onSave?: () => void;
  /** Grau statt weg: Ein Knopf, der verschwindet, sobald ein Feld leer
   *  ist, sieht nach Fehler aus. Grau sieht nach «noch nicht» aus - und
   *  im Formular steht, was fehlt. */
  saveGesperrt?: boolean;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      {/* Der Abstand kommt vom Gerät, nicht aus einer geratenen Zahl.
          Im Browser meldet es 0 - dort genügen die 10 Punkte der
          Leiste selbst, darum das Maximum mit einem kleinen Wert. */}
      <View style={[styles.editor, { paddingTop: Math.max(insets.top, 10) }]}>
        <View style={styles.editorBar}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Abbrechen"
            style={({ pressed }) => [styles.editorBarKnopf, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.editorBarText}>Abbrechen</Text>
          </Pressable>
          <Text style={styles.editorBarTitle} numberOfLines={1}>
            {titel}
          </Text>
          {onSave ? (
            <Pressable
              onPress={onSave}
              disabled={saveGesperrt}
              accessibilityRole="button"
              accessibilityState={{ disabled: saveGesperrt }}
              style={({ pressed }) => [
                styles.editorBarKnopf,
                { alignItems: 'flex-end' },
                saveGesperrt && { opacity: 0.4 },
                pressed && !saveGesperrt && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.editorBarText}>Speichern</Text>
            </Pressable>
          ) : (
            // Ein leerer Platzhalter derselben Breite: Sonst rutscht der
            // Titel aus der Mitte, sobald rechts nichts steht.
            <View style={styles.editorBarKnopf} />
          )}
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.editorContent,
            { paddingBottom: insets.bottom + 40 },
          ]}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * Ein Hauptabschnitt des Ablauf-Editors: «Wenn», «Nur wenn», «Dann», «Sonst».
 *
 * Der gemeldete Fall: «Man sieht fast nicht, wenn ein neuer Abschnitt
 * kommt.» Die Abschnitte trugen dieselbe kleine Beschriftung wie jedes
 * Feld darin - zwischen dreissig Chips und zwei Gerätelisten ging die
 * Gliederung unter. Jetzt ist jeder Abschnitt eine eigene Karte mit
 * Nummer und grosser Überschrift: Die Nummern erzählen den Satz («1
 * Wenn … 2 Nur wenn … 3 Dann …»), und die Kartenränder sagen auch beim
 * schnellen Scrollen, wo man ist.
 *
 * `zuklappbar` übernimmt, was vorher die Klappe tat - gleiche Regeln:
 * offen, sobald etwas drinsteht (`stand`), sonst zu.
 */
export function Abschnitt({
  nummer,
  titel,
  stand,
  zuklappbar = false,
  children,
}: {
  nummer: string;
  titel: string;
  /** Was eingestellt ist – steht zugeklappt im Kopf und öffnet den
   *  Abschnitt von selbst. */
  stand?: string;
  zuklappbar?: boolean;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(!zuklappbar || !!stand);

  return (
    <View style={styles.abschnitt}>
      <Pressable
        onPress={zuklappbar ? () => setOffen((auf) => !auf) : undefined}
        disabled={!zuklappbar}
        accessibilityRole={zuklappbar ? 'button' : 'header'}
        accessibilityState={zuklappbar ? { expanded: offen } : undefined}
        accessibilityLabel={stand ? `${titel}: ${stand}` : titel}
        style={styles.abschnittKopf}
      >
        <View style={styles.abschnittNummer}>
          <Text style={styles.abschnittNummerText}>{nummer}</Text>
        </View>
        <Text style={styles.abschnittTitel} numberOfLines={1}>
          {titel}
        </Text>
        {zuklappbar && stand && !offen ? (
          <Text style={styles.klappeStand} numberOfLines={1}>
            {stand}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {zuklappbar ? (
          <Ionicons
            name={offen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.inkSoft}
          />
        ) : null}
      </Pressable>
      {offen ? <View style={styles.abschnittInhalt}>{children}</View> : null}
    </View>
  );
}

/**
 * Ein Abschnitt, der zugeklappt anfängt.
 *
 * Der Editor zeigte beim Anlegen alles auf einmal: Name, Kategorie,
 * Aktiv, Auslöser, Bedingung, Und/Oder-Gruppen, Schritte, Wartesperre,
 * Sonst-Zweig. Für den häufigen Fall - «wenn der Melder anschlägt, mach
 * das Licht an» - ist gut die Hälfte davon Beiwerk, das man beim
 * Scrollen erst einmal wegblättern muss.
 *
 * Zugeklappt heisst nicht versteckt: Der Kopf sagt, was drinsteht, und
 * wo schon etwas eingestellt ist, steht das daneben - und der Abschnitt
 * geht von selbst auf. Sonst öffnete man beim Bearbeiten eines
 * bestehenden Ablaufs blind alle Klappen, um zu sehen, was drin ist.
 */
// `Klappe` wohnt jetzt in components/: Die Benutzerverwaltung braucht
// sie auch, und ein Bildschirm, der aus dem Ordner eines anderen
// importiert, ist eine Abhängigkeit, die niemand erwartet.
export { Klappe } from '../../components/Klappe';

export function Choice({
  options,
  value,
  values,
  multi,
  onSelect,
}: {
  options: { key: string; label: string }[];
  value?: string;
  /** Bei multi: alle ausgewählten Schlüssel. */
  values?: string[];
  multi?: boolean;
  onSelect: (key: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isActive = (key: string) => (multi ? !!values?.includes(key) : value === key);
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => onSelect(option.key)}
          accessibilityRole={multi ? 'checkbox' : 'radio'}
          accessibilityState={
            multi ? { checked: isActive(option.key) } : { selected: isActive(option.key) }
          }
          style={[styles.choice, isActive(option.key) && styles.choiceActive]}
        >
          <Text
            style={[styles.choiceText, isActive(option.key) && styles.choiceTextActive]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Auswahlliste als Knopfreihe – ein echtes Auswahlmenü gibt es in React
    Native nicht plattformübergreifend, und bei einer Handvoll Geräten ist
    das ohnehin schneller. */
export function Picker({
  items,
  value,
  onSelect,
  placeholder = 'Gerät suchen …',
}: {
  items: { key: string; label: string }[];
  value: string;
  onSelect: (key: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  // Ab hier wird die Liste zum Wischen zu lang; darunter wäre ein
  // Suchfeld nur im Weg.
  const searchable = items.length > 8;
  const shown = searchable ? pickerMatches(items, query, value) : items;

  return (
    <View style={{ gap: 8 }}>
      {searchable ? (
        <SearchBox value={query} onChange={setQuery} placeholder={placeholder} />
      ) : null}
      {shown.length === 0 ? (
        <Text style={styles.triggerNote}>Nichts gefunden.</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
      <View style={styles.choices}>
        {shown.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === item.key }}
            style={[styles.choice, value === item.key && styles.choiceActive]}
          >
            <Text
              style={[styles.choiceText, value === item.key && styles.choiceTextActive]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      </ScrollView>
    </View>
  );
}

/** Die Geräte, die zur Suche passen – nach Raum gebündelt (rein, testbar).
 *
 * Gesucht wird über Name, Raum **und Geräteart**: «Bewegung» findet den
 * Melder auch dann, wenn er «Flur 2» heisst. Genau daran scheiterte die
 * alte Auswahl – wer den Namen nicht auswendig wusste, fand nichts.
 *
 * Das bereits Gewählte bleibt immer dabei, auch wenn es nicht zur Suche
 * passt: Sonst stünde beim Tippen plötzlich nirgends mehr, was gerade
 * eingestellt ist.
 */
export function groupEntities(
  entities: Entity[],
  query: string,
  chosen?: string
): { room: string; items: Entity[] }[] {
  const needle = query.trim().toLowerCase();
  const hits = needle
    ? entities.filter(
        (entity) =>
          entity.id === chosen ||
          entity.name.toLowerCase().includes(needle) ||
          (entity.room ?? '').toLowerCase().includes(needle) ||
          deviceKindLabel(entity).toLowerCase().includes(needle)
      )
    : entities;

  const rooms = Array.from(new Set(hits.map((entity) => entity.room || 'Weitere')));
  // «Weitere» ganz nach unten – dort steht, was keinem Raum zugeordnet
  // ist, und das sucht man am seltensten.
  rooms.sort((a, b) => (a === 'Weitere' ? 1 : b === 'Weitere' ? -1 : a.localeCompare(b)));
  return rooms.map((room) => ({
    room,
    items: hits
      .filter((entity) => (entity.room || 'Weitere') === room)
      // Innerhalb des Raums nach Art, dann nach Name: So stehen die
      // Lichter beieinander und die Melder auch.
      .sort(
        (a, b) =>
          deviceKindLabel(a).localeCompare(deviceKindLabel(b)) ||
          a.name.localeCompare(b.name)
      ),
  }));
}

/**
 * Ein Gerät auswählen: Suchfeld, nach Raum gebündelt, eine Zeile je Gerät
 * mit Symbol, Name und Geräteart.
 *
 * Vorher war das eine einzige waagrechte Reihe von Chips. Bei über
 * hundert Geräten hiess das: wischen, bis man das Richtige sieht – und
 * weil in den Chips nur der Name stand, war «Flur» genauso gut das Licht
 * wie der Melder. Beides ist hier behoben.
 */
export function EntityPicker({
  entities,
  value,
  onSelect,
  placeholder = 'Gerät, Raum oder Art suchen …',
  noneLabel,
}: {
  entities: Entity[];
  value: string;
  onSelect: (id: string) => void;
  placeholder?: string;
  /** Beschriftung für «nichts davon» – ohne sie gibt es die Zeile nicht. */
  noneLabel?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const chosen = entities.find((entity) => entity.id === value);
  // Mit noneLabel ist auch «nichts» eine getroffene Wahl.
  const gewaehltEtwas = !!chosen || (noneLabel !== undefined && value === '');
  // Der gemeldete Fall: «Man muss sehr viel scrollen.» Die Liste stand
  // dauerhaft offen - auch dann noch, wenn längst gewählt war. Solange
  // nichts gewählt ist, bleibt sie offen (man soll sehen, was zur Wahl
  // steht); nach der Wahl schrumpft sie auf eine Zeile mit «Ändern».
  const [aufgeklappt, setAufgeklappt] = useState(!gewaehltEtwas);
  const offen = aufgeklappt || !gewaehltEtwas;
  // Kurze Listen brauchen kein Suchfeld; es stünde nur im Weg.
  const searchable = entities.length > 8;
  const groups = useMemo(
    () => groupEntities(entities, searchable ? query : '', value),
    [entities, query, searchable, value]
  );
  const waehlen = (id: string) => {
    onSelect(id);
    setAufgeklappt(false);
    setQuery('');
  };

  const row = (
    key: string,
    label: string,
    sub: string | null,
    icon: string,
    selected: boolean,
    onPress: () => void
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={({ pressed }) => [
        styles.pickRow,
        selected && styles.pickRowActive,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons
        name={icon as keyof typeof Ionicons.glyphMap}
        size={19}
        color={selected ? colors.accent : colors.inkFaint}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickName, selected && styles.pickNameActive]} numberOfLines={1}>
          {label}
        </Text>
        {sub ? <Text style={styles.pickKind}>{sub}</Text> : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
      ) : null}
    </Pressable>
  );

  if (!offen) {
    // Die Wahl als eine Zeile: Symbol, Name, Art - und «Ändern» als
    // sichtbares Versprechen, dass sich dahinter die Liste öffnet.
    return (
      <Pressable
        onPress={() => setAufgeklappt(true)}
        accessibilityRole="button"
        accessibilityLabel={`Gewählt: ${chosen ? chosen.name : noneLabel ?? ''}. Ändern`}
        style={({ pressed }) => [styles.gewaehltZeile, pressed && { opacity: 0.75 }]}
      >
        <Ionicons
          name={
            (chosen ? deviceKindIcon(chosen) : 'remove-circle-outline') as keyof typeof Ionicons.glyphMap
          }
          size={19}
          color={colors.accent}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.pickName} numberOfLines={1}>
            {chosen ? chosen.name : noneLabel}
          </Text>
          {chosen ? <Text style={styles.pickKind}>{deviceKindLabel(chosen)}</Text> : null}
        </View>
        <Text style={styles.gewaehltAendern}>Ändern</Text>
        <Ionicons name="chevron-down" size={16} color={colors.inkSoft} />
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {searchable ? (
        <View style={styles.deviceSearch}>
          <Ionicons name="search" size={15} color={colors.inkFaint} />
          <TextInput
            style={styles.deviceSearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={colors.inkFaint}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Suche löschen">
              <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Bei langen Listen wandert das Gewählte beim Tippen ausser Sicht.
          Eine Zeile oben sagt, woran man gerade ist. */}
      {searchable && chosen ? (
        <Text style={styles.snapshotHint}>
          Gewählt: {chosen.name} · {deviceKindLabel(chosen)}
        </Text>
      ) : null}

      {/* Eigener Scrollbereich mit fester Höhe: Sonst schöbe eine Liste
          mit hundert Geräten den Rest des Editors ausser Sicht. */}
      <ScrollView
        style={styles.pickList}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {noneLabel
          ? row(
              '__ohne',
              noneLabel,
              null,
              'remove-circle-outline',
              value === '',
              () => waehlen('')
            )
          : null}
        {groups.length === 0 ? (
          <Text style={styles.snapshotHint}>Nichts gefunden.</Text>
        ) : null}
        {groups.map((group) => (
          <View key={group.room}>
            <Text style={styles.groupLabel}>{group.room}</Text>
            {group.items.map((entity) =>
              row(
                entity.id,
                entity.name,
                deviceKindLabel(entity),
                deviceKindIcon(entity),
                value === entity.id,
                () => waehlen(entity.id)
              )
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Treffer der Suche im Auswahlfeld (rein, testbar).
 *
 * Das Gewählte bleibt immer sichtbar, auch wenn es nicht zur Suche passt –
 * sonst stünde beim Tippen plötzlich nirgends mehr, was gerade eingestellt
 * ist. */
export function pickerMatches(
  items: { key: string; label: string }[],
  query: string,
  value: string
): { key: string; label: string }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  const hits = items.filter((item) => item.label.toLowerCase().includes(needle));
  if (hits.some((item) => item.key === value)) return hits;
  const chosen = items.find((item) => item.key === value);
  return chosen ? [chosen, ...hits] : hits;
}

