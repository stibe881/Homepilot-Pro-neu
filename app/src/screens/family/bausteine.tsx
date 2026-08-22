/**
 * Die Bausteine der Familien-Seite: Formulare, Zeilen, Kalender - alle auf Modulebene, damit React sie beim Live-Update nicht neu einhängt.
 *
 * Herausgelöst aus FamilyScreen.tsx (Punkt 21 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Entity, HubSettings } from '../../api/types';
import { Card } from '../../components/Card';
import { Colors } from '../../theme';
import { monatJahr, uhr } from '../../lib/format';
import { tapped } from '../../lib/haptics';

/**
 * Ein Eintrag einer Familienliste, wie der Hub ihn speichert (Punkt 60
 * der Werkbank). Ein offenes Objekt mit Absicht: Die Felder je Liste
 * (done, member, due, day, votes …) sauber zu tippen hiesse, die
 * Hub-Schemas hier zu duplizieren - der eine Alias ersetzt dafür die
 * sechzig verstreuten `any` von vorher.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FamilyItem = Record<string, any>;

export type FamilyData = Record<string, FamilyItem[]>;
import { makeStyles } from './stil';

export type Styles = ReturnType<typeof makeStyles>;

export interface Member {
  name: string;
  role: string;
}

export interface Props {
  settings: HubSettings;
  entities: Entity[];
  currentUser?: { name: string; role: string } | null;
  /** Selbst gezogene Reihenfolge der Modul-Kacheln (je Benutzer, vom Hub). */
  moduleOrder?: string[];
  onReorderModules?: (keys: string[]) => void;
  /** Zeitstempel der letzten Familien-Änderung (family_changed über den
   *  WebSocket) – ändert er sich, lädt der Bildschirm neu. */
  changedAt?: number;
}

export type ModuleKey =
  | 'kalender'
  | 'tasks'
  | 'shopping'
  | 'meals'
  | 'pins'
  | 'rewards'
  | 'contacts'
  | 'routines'
  | 'packlists'
  | 'countdowns'
  | 'recipes'
  | 'documents'
  | 'chores'
  | 'woche'
  | 'emergency'
  | 'medications'
  | 'babysitter';

export const WEEK_DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];


// ── Wiederverwendbare Bausteine (bewusst auf Modulebene) ────────────────────

export function BackHead({
  title,
  onBack,
  styles,
  colors,
}: {
  title: string;
  onBack: () => void;
  styles: Styles;
  colors: Colors;
}) {
  return (
    <View style={styles.backHead}>
      <Pressable onPress={onBack} style={styles.backRow} accessibilityRole="button">
        <Ionicons name="chevron-back" size={18} color={colors.onGradient} />
        <Text style={styles.backText}>Familie</Text>
      </Pressable>
      <Text style={styles.viewTitle}>{title}</Text>
    </View>
  );
}

export function AddRow({
  placeholder,
  onAdd,
  multiline,
  styles,
  colors,
}: {
  placeholder: string;
  onAdd: (text: string) => void;
  multiline?: boolean;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <View style={styles.addRow}>
      <TextInput
        style={[styles.input, { flex: 1 }, multiline && { minHeight: 60 }]}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        multiline={multiline}
        blurOnSubmit={!multiline}
        onSubmitEditing={multiline ? undefined : submit}
      />
      <Pressable onPress={submit} style={styles.addButton} accessibilityLabel="Hinzufügen">
        <Ionicons name="add" size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

export function CheckRow({
  item,
  sub,
  highlight,
  onToggle,
  onDelete,
  onRemember,
  styles,
  colors,
}: {
  item: FamilyItem;
  sub?: string;
  /** Farbe für die Unterzeile, z.B. Rot bei überfälligen Aufgaben. */
  highlight?: string;
  onToggle: () => void;
  onDelete: () => void;
  /** Langer Druck: als Standardartikel merken. Fehlt der Rückruf, passiert
   *  beim langen Drücken nichts - etwa weil es ihn schon gibt. */
  onRemember?: () => void;
  styles: Styles;
  colors: Colors;
}) {
  return (
    <View style={styles.checkRow}>
      <Pressable
        onPress={() => {
          // Abhaken ist die häufigste Bewegung in diesem Bildschirm –
          // und die einzige, bei der man danach gleich weiterwischt,
          // ohne hinzusehen.
          tapped();
          onToggle();
        }}
        onLongPress={onRemember}
        style={styles.checkTap}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!item.done }}
      >
        <Ionicons
          name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={item.done ? colors.on : colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.checkText, item.done && styles.checkTextDone]}>
            {item.text}
          </Text>
          {sub ? (
            <Text style={[styles.checkSub, highlight ? { color: highlight, fontWeight: '600' } : null]}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable onPress={onDelete} style={styles.deleteTap} accessibilityLabel="Löschen">
        <Ionicons name="close" size={18} color={colors.inkFaint} />
      </Pressable>
    </View>
  );
}

export function GroupedChecklist({
  items,
  groupNoun,
  itemPlaceholder,
  onAdd,
  onToggle,
  onDelete,
  onResetGroup,
  onDeleteGroup,
  styles,
  colors,
}: {
  items: FamilyItem[];
  groupNoun: string;
  itemPlaceholder: string;
  onAdd: (group: string, text: string) => void;
  onToggle: (item: FamilyItem) => void;
  onDelete: (item: FamilyItem) => void;
  onResetGroup: (group: string) => void;
  /** Ganze Gruppe (samt Einträgen) löschen – optional. */
  onDeleteGroup?: (group: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const groups = Array.from(new Set(items.map((item) => String(item.group ?? ''))));
  const [activeGroup, setActiveGroup] = useState(groups[0] ?? '');
  const [newGroup, setNewGroup] = useState('');
  // Fällt die aktive Gruppe weg (letzter Eintrag gelöscht), zur ersten wechseln.
  const current = groups.includes(activeGroup) ? activeGroup : groups[0] ?? activeGroup;

  return (
    <View style={styles.stack}>
      <View style={styles.chipRow}>
        {groups.map((group) => (
          <Pressable
            key={group}
            onPress={() => setActiveGroup(group)}
            style={[styles.chip, current === group && styles.chipActive]}
          >
            <Text style={[styles.chipText, current === group && styles.chipTextActive]}>
              {group}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={newGroup}
          onChangeText={setNewGroup}
          placeholder={`Neue ${groupNoun} anlegen …`}
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={() => {
            if (newGroup.trim()) {
              setActiveGroup(newGroup.trim());
              setNewGroup('');
            }
          }}
        />
      </View>
      {current ? (
        <Card style={styles.listCard}>
          <View style={styles.groupHead}>
            <Text style={styles.groupTitle}>{current}</Text>
            <Pressable onPress={() => onResetGroup(current)}>
              <Text style={styles.resetText}>Zurücksetzen</Text>
            </Pressable>
            {onDeleteGroup ? (
              <Pressable
                onPress={() => {
                  if (confirmDelete) {
                    onDeleteGroup(current);
                    setConfirmDelete(false);
                  } else {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 4000);
                  }
                }}
                accessibilityLabel={`${groupNoun} löschen`}
              >
                <Text style={[styles.resetText, { color: colors.danger }]}>
                  {confirmDelete ? 'Wirklich löschen?' : 'Löschen'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {items
            .filter((item) => item.group === current)
            .map((item) => (
              <CheckRow
                key={item.id}
                item={item}
                onToggle={() => onToggle(item)}
                onDelete={() => onDelete(item)}
                styles={styles}
                colors={colors}
              />
            ))}
          <AddRow
            placeholder={itemPlaceholder}
            onAdd={(text) => onAdd(current, text)}
            styles={styles}
            colors={colors}
          />
        </Card>
      ) : (
        <Text style={styles.hint}>Zuerst oben eine {groupNoun} anlegen (Eingabe mit ⏎ bestätigen).</Text>
      )}
    </View>
  );
}

/** Termin anlegen: Titel, Datum, optional Uhrzeit (leer = ganztägig). */
export function EventForm({
  onAdd,
  styles,
  colors,
}: {
  onAdd: (summary: string, date: string, time: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  return (
    <View style={styles.formCard}>
      <TextInput
        style={styles.input}
        value={summary}
        onChangeText={setSummary}
        placeholder="Titel (z.B. Zahnarzt)"
        placeholderTextColor={colors.inkFaint}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={date}
          onChangeText={setDate}
          placeholder="Datum (TT.MM.JJJJ)"
          placeholderTextColor={colors.inkFaint}
          keyboardType="numbers-and-punctuation"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={time}
          onChangeText={setTime}
          placeholder="Zeit (leer = ganztägig)"
          placeholderTextColor={colors.inkFaint}
          keyboardType="numbers-and-punctuation"
        />
      </View>
      <Pressable
        onPress={() => {
          if (!summary.trim() || !date.trim()) return;
          onAdd(summary.trim(), date.trim(), time.trim());
          setSummary('');
          setDate('');
          setTime('');
        }}
        style={styles.addWide}
      >
        <Text style={styles.addWideText}>Termin anlegen</Text>
      </Pressable>
    </View>
  );
}

/** Aufgabe anlegen: Text, optional zuständige Person und Punktwert.
 *  Beim Abhaken werden die Punkte der Person automatisch gutgeschrieben. */
/**
 * Die nächste Fälligkeit einer wiederkehrenden Aufgabe (rein, testbar).
 *
 * Gerechnet wird ab der bisherigen Frist, nicht ab heute: Wer den
 * Montags-Abfall am Dienstag abhakt, soll nicht künftig dienstags
 * erinnert werden. Liegt die Frist schon in der Vergangenheit, rückt sie
 * weiter, bis sie in der Zukunft liegt - sonst stapelten sich nach zwei
 * Wochen Ferien vierzehn überfällige Einträge. Dieselbe Regel gilt im
 * Hub (core/chores.py), damit beide Seiten dasselbe Datum errechnen.
 */
export function nextDue(current: string | null | undefined, repeat: string): string {
  const heute = new Date();
  heute.setHours(12, 0, 0, 0);
  const start = current ? new Date(`${String(current).slice(0, 10)}T12:00:00`) : heute;
  const basis = Number.isNaN(start.getTime()) ? new Date(heute) : start;
  const tag = basis.getDate();
  let naechste = new Date(basis);
  // Immer ab dem Ausgangsdatum rechnen, nie ab dem zuletzt errechneten:
  // Sonst wandert eine Frist auf dem 31. über den Februar (28.) für immer
  // auf den 28. - der geklammerte Tag wäre der neue Ausgangswert.
  for (let schritte = 1; schritte < 400; schritte += 1) {
    if (repeat === 'monthly') {
      naechste = new Date(basis.getFullYear(), basis.getMonth() + schritte, 1, 12);
      const letzter = new Date(
        naechste.getFullYear(),
        naechste.getMonth() + 1,
        0
      ).getDate();
      naechste.setDate(Math.min(tag, letzter));
    } else {
      naechste = new Date(basis);
      naechste.setDate(basis.getDate() + (repeat === 'daily' ? 1 : 7) * schritte);
    }
    if (naechste > heute) break;
  }
  return `${naechste.getFullYear()}-${String(naechste.getMonth() + 1).padStart(2, '0')}-${String(
    naechste.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Wer ist als Nächstes dran? (rein, testbar)
 *
 * Steht die aktuelle Person nicht mehr in der Reihe - jemand ist
 * ausgezogen oder wurde aus dem Ämtli genommen -, beginnt die Reihe
 * wieder vorn, statt stehenzubleiben. Dieselbe Regel wie im Hub
 * (core/chores.py).
 */
export function rotateMember(members: string[], current: unknown): string | null {
  const reihe = members.map((name) => String(name).trim()).filter(Boolean);
  if (reihe.length === 0) return null;
  if (reihe.length === 1) return reihe[0];
  const index = reihe.indexOf(String(current));
  return index < 0 ? reihe[0] : reihe[(index + 1) % reihe.length];
}

/** ISO-Datum (YYYY-MM-DD) für «in n Tagen ab heute» (rein genug, testbar). */
export function isoInDays(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** Fälligkeit einer Aufgabe als Text plus «überfällig?» (rein, testbar). */
export function dueInfo(due: string | undefined): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const target = new Date(`${due}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const diff = Math.round(
    (new Date(target).setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (diff < 0) return { label: `überfällig (${-diff} Tag${diff === -1 ? '' : 'e'})`, overdue: true };
  if (diff === 0) return { label: 'fällig heute', overdue: true };
  if (diff === 1) return { label: 'fällig morgen', overdue: false };
  return { label: `fällig in ${diff} Tagen`, overdue: false };
}

export const DUE_OPTIONS: { key: string; label: string; days: number | null }[] = [
  { key: 'none', label: 'ohne Frist', days: null },
  { key: 'today', label: 'heute', days: 0 },
  { key: 'tomorrow', label: 'morgen', days: 1 },
  { key: 'week', label: 'in 1 Woche', days: 7 },
];

/** Wie oft sich eine Aufgabe wiederholt. «Einmalig» ist die Vorgabe -
 *  die meisten Aufgaben sind es. */
export const REPEAT_OPTIONS = [
  { key: 'none', label: 'einmalig' },
  { key: 'daily', label: 'täglich' },
  { key: 'weekly', label: 'wöchentlich' },
  { key: 'monthly', label: 'monatlich' },
];

export function PollAddRow({
  onAdd,
  styles,
  colors,
}: {
  onAdd: (frage: string, optionen: string[]) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [frage, setFrage] = useState('');
  const [optionen, setOptionen] = useState('');
  const submit = () => {
    // Ohne mindestens zwei Antworten ist es keine Abstimmung, sondern eine
    // Ankündigung - dafür gibt es die Pinnwand darüber.
    const liste = optionen
      .split(/[,\n]/)
      .map((teil) => teil.trim())
      .filter(Boolean);
    if (!frage.trim() || liste.length < 2) return;
    onAdd(frage.trim(), liste);
    setFrage('');
    setOptionen('');
  };
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        style={styles.input}
        value={frage}
        onChangeText={setFrage}
        placeholder="Frage, z.B. Was gibt's am Sonntag?"
        placeholderTextColor={colors.inkFaint}
      />
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={optionen}
          onChangeText={setOptionen}
          placeholder="Antworten, mit Komma getrennt"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={submit}
        />
        <Pressable
          onPress={submit}
          style={styles.addButton}
          accessibilityLabel="Abstimmung anlegen"
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

export function MedicationAddRow({
  members,
  onAdd,
  styles,
  colors,
}: {
  members: Member[];
  onAdd: (text: string, member: string | null, days: number) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [member, setMember] = useState<string | null>(null);
  const [days, setDays] = useState(0);
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), member, days);
    setText('');
    setMember(null);
    setDays(0);
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder="Was, z.B. Amoxicillin 3× täglich …"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={submit}
        />
        <Pressable onPress={submit} style={styles.addButton} accessibilityLabel="Hinzufügen">
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.chipRow}>
        {members.map((m) => (
          <Pressable
            key={m.name}
            onPress={() => setMember(member === m.name ? null : m.name)}
            style={[styles.chip, member === m.name && styles.chipActive]}
          >
            <Text style={[styles.chipText, member === m.name && styles.chipTextActive]}>
              {m.name}
            </Text>
          </Pressable>
        ))}
        {[5, 7, 10].map((value) => (
          <Pressable
            key={value}
            onPress={() => setDays(days === value ? 0 : value)}
            accessibilityLabel={`Kur über ${value} Tage`}
            style={[styles.chip, days === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, days === value && styles.chipTextActive]}>
              {value} Tage
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ChoreAddRow({
  members,
  onAdd,
  styles,
  colors,
}: {
  members: Member[];
  onAdd: (text: string, reihe: string[], points: number, repeat: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [reihe, setReihe] = useState<string[]>([]);
  const [points, setPoints] = useState(0);
  const [repeat, setRepeat] = useState('weekly');
  const submit = () => {
    // Ohne Reihe wäre es kein Ämtli, sondern eine Aufgabe - dafür gibt es
    // die Aufgabenliste.
    if (!text.trim() || reihe.length === 0) return;
    onAdd(text.trim(), reihe, points, repeat);
    setText('');
    setReihe([]);
    setPoints(0);
    setRepeat('weekly');
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder="Neues Ämtli, z.B. Bad putzen …"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={submit}
        />
        <Pressable
          onPress={submit}
          style={[styles.addButton, reihe.length === 0 && { opacity: 0.5 }]}
          accessibilityLabel="Ämtli anlegen"
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <Text style={styles.formHintSmall}>
        Wer steht in der Reihe? Die Reihenfolge ist die des Antippens.
      </Text>
      <View style={styles.chipRow}>
        {members.map((m) => {
          const platz = reihe.indexOf(m.name);
          return (
            <Pressable
              key={m.name}
              onPress={() =>
                setReihe((prev) =>
                  prev.includes(m.name)
                    ? prev.filter((name) => name !== m.name)
                    : [...prev, m.name]
                )
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: platz >= 0 }}
              style={[styles.chip, platz >= 0 && styles.chipActive]}
            >
              <Text style={[styles.chipText, platz >= 0 && styles.chipTextActive]}>
                {platz >= 0 ? `${platz + 1}. ` : ''}
                {m.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.chipRow}>
        {REPEAT_OPTIONS.filter((option) => option.key !== 'none').map((option) => (
          <Pressable
            key={option.key}
            onPress={() => setRepeat(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeat === option.key }}
            style={[styles.chip, repeat === option.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, repeat === option.key && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
        {[1, 2, 5].map((value) => (
          <Pressable
            key={value}
            onPress={() => setPoints(points === value ? 0 : value)}
            style={[styles.chip, points === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, points === value && styles.chipTextActive]}>
              {value} P
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function TaskAddRow({
  members,
  onAdd,
  styles,
  colors,
}: {
  members: Member[];
  onAdd: (
    text: string,
    member: string | null,
    points: number,
    due: string | null,
    repeat: string
  ) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [member, setMember] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [dueKey, setDueKey] = useState('none');
  const [repeat, setRepeat] = useState('none');
  const submit = () => {
    if (!text.trim()) return;
    const option = DUE_OPTIONS.find((o) => o.key === dueKey);
    // Eine Wiederholung ohne Frist hat nichts, ab dem sie weiterrücken
    // könnte - dann gilt heute als Start.
    const due =
      option && option.days != null
        ? isoInDays(option.days)
        : repeat !== 'none'
          ? isoInDays(0)
          : null;
    onAdd(text.trim(), member, points, due, repeat);
    setText('');
    setMember(null);
    setPoints(0);
    setDueKey('none');
    setRepeat('none');
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder="Neue Aufgabe …"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={submit}
        />
        <Pressable onPress={submit} style={styles.addButton} accessibilityLabel="Hinzufügen">
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.chipRow}>
        {members.map((m) => (
          <Pressable
            key={m.name}
            onPress={() => setMember(member === m.name ? null : m.name)}
            style={[styles.chip, member === m.name && styles.chipActive]}
          >
            <Text style={[styles.chipText, member === m.name && styles.chipTextActive]}>
              {m.name}
            </Text>
          </Pressable>
        ))}
        {[1, 2, 5].map((value) => (
          <Pressable
            key={value}
            onPress={() => setPoints(points === value ? 0 : value)}
            style={[styles.chip, points === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, points === value && styles.chipTextActive]}>
              {value} P
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chipRow}>
        {REPEAT_OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => setRepeat(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeat === option.key }}
            style={[styles.chip, repeat === option.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, repeat === option.key && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chipRow}>
        {DUE_OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => setDueKey(option.key)}
            style={[styles.chip, dueKey === option.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, dueKey === option.key && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Einkaufs-Kategorien in der Reihenfolge eines üblichen Ladenrundgangs. */
export const SHOP_CATEGORIES = [
  'Früchte & Gemüse',
  'Milchprodukte',
  'Brot & Backwaren',
  'Fleisch & Fisch',
  'Getränke',
  'Tiefkühl',
  'Vorrat',
  'Haushalt',
  'Sonstiges',
];

export function ShoppingAddRow({
  onAdd,
  styles,
  colors,
}: {
  onAdd: (text: string, category: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState(SHOP_CATEGORIES[SHOP_CATEGORIES.length - 1]);
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), category);
    setText('');
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder="Was fehlt? …"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={submit}
        />
        <Pressable onPress={submit} style={styles.addButton} accessibilityLabel="Hinzufügen">
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipRow}>
          {SHOP_CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => setCategory(cat)}
              style={[styles.chip, category === cat && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>
                {cat}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Foto aus der Galerie wählen – quadratisch zugeschnitten, stark
 *  komprimiert und als data-URI zurückgegeben (landet mit dem Kontakt auf
 *  dem Hub, damit alle Familienmitglieder dasselbe Bild sehen). */
export async function pickPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.25,
    base64: true,
    exif: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset?.base64) return null;
  return `data:image/jpeg;base64,${asset.base64}`;
}

/** Rundes Kontaktfoto bzw. farbiger Anfangsbuchstabe als Platzhalter. */
export function ContactPhoto({
  contact,
  size,
  styles,
}: {
  contact: FamilyItem;
  size: number;
  styles: Styles;
}) {
  if (contact.photo) {
    return (
      <Image
        source={{ uri: contact.photo }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={[
        styles.contactInitial,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.contactInitialText, { fontSize: size * 0.4 }]}>
        {String(contact.text ?? '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** Kontakt anlegen: Name, Nummer und Foto. */
export function ContactForm({
  onAdd,
  styles,
  colors,
}: {
  onAdd: (text: string, phone: string, photo: string | null, birthday: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthday, setBirthday] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <View style={styles.formCard}>
      <View style={styles.contactFormRow}>
        <Pressable
          onPress={async () => setPhoto((await pickPhoto()) ?? photo)}
          accessibilityLabel="Foto wählen"
        >
          {photo ? (
            <Image source={{ uri: photo }} style={styles.contactFormPhoto} />
          ) : (
            <View style={[styles.contactFormPhoto, styles.contactPhotoEmpty]}>
              <Ionicons name="camera-outline" size={22} color={colors.inkSoft} />
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 8 }}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name (z.B. Mami)"
            placeholderTextColor={colors.inkFaint}
          />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Telefonnummer"
            placeholderTextColor={colors.inkFaint}
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            value={birthday}
            onChangeText={setBirthday}
            placeholder="Geburtstag (TT.MM. – freiwillig)"
            placeholderTextColor={colors.inkFaint}
          />
        </View>
      </View>
      <Pressable
        onPress={() => {
          if (!name.trim() || !phone.trim()) return;
          onAdd(name.trim(), phone.trim(), photo, birthday.trim());
          setName('');
          setPhone('');
          setBirthday('');
          setPhoto(null);
        }}
        style={styles.addWide}
      >
        <Text style={styles.addWideText}>Hinzufügen</Text>
      </Pressable>
    </View>
  );
}

/** Tage bis zum nächsten Geburtstag (Jahr egal), aus «TT.MM.» oder
 *  «TT.MM.JJJJ» (rein, testbar). Null, wenn nichts Brauchbares dasteht. */
export function daysUntilBirthday(value: unknown): number | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), month, day);
  if (Number.isNaN(next.getTime())) return null;
  if (next < today) next = new Date(today.getFullYear() + 1, month, day);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/** Geburtstags-Text: «heute! 🎉», «morgen» oder «in N Tagen». */
export function birthdayLabel(value: unknown): string | null {
  const days = daysUntilBirthday(value);
  if (days == null) return null;
  if (days === 0) return 'Geburtstag heute! 🎉';
  if (days === 1) return 'Geburtstag morgen';
  return `Geburtstag in ${days} Tagen`;
}

/** Datum «TT.MM.JJJJ» oder ISO → Date (Mitternacht lokal). */
export function parseSwissDate(value: unknown): Date | null {
  if (!value) return null;
  const swiss = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value).trim());
  if (swiss) {
    return new Date(Number(swiss[3]), Number(swiss[2]) - 1, Number(swiss[1]));
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Zeile im Essensplaner: antippen, tippen, fertig. */
export function MealRow({
  day,
  entry,
  rezept,
  heute,
  onOpenRezept,
  onSave,
  colors,
  styles,
}: {
  day: string;
  entry: FamilyItem | undefined;
  /** Das hinterlegte Rezept (Punkt 146): Dann zeigt die Zeile Foto und
   *  Kochzeit statt blossem Text, und Antippen öffnet das Rezept. */
  rezept?: FamilyItem;
  /** Der heutige Wochentag ist hervorgehoben - der Blick aufs iPad am
   *  Kühlschrank beantwortet «was gibts heute?» ohne Suchen. */
  heute?: boolean;
  onOpenRezept?: () => void;
  onSave: (text: string) => void;
  colors: Colors;
  styles: Styles;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const finish = () => {
    setEditing(false);
    if (draft.trim() !== (entry?.text ?? '')) onSave(draft.trim());
  };
  if (rezept && !editing) {
    const minuten = ['prep_time', 'cook_time', 'rest_time']
      .map((key) => Number(rezept[key]) || 0)
      .reduce((a, b) => a + b, 0);
    const meta = [
      minuten > 0 ? `${minuten} Min` : '',
      Number(entry?.servings) > 0 ? `${entry?.servings} Port.` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <View style={[styles.mealRow, heute && styles.mealHeute]}>
        <Text style={[styles.mealDay, heute && { color: colors.accent }]}>
          {day.slice(0, 2)}
        </Text>
        <Pressable
          onPress={onOpenRezept}
          accessibilityRole="button"
          accessibilityLabel={`Rezept ${String(entry?.text ?? '')} öffnen`}
          style={styles.mealTile}
        >
          {rezept.image_url ? (
            <Image source={{ uri: String(rezept.image_url) }} style={styles.mealThumb} />
          ) : (
            <View style={[styles.mealThumb, styles.mealThumbLeer]}>
              <Ionicons name="restaurant-outline" size={16} color={colors.inkSoft} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.checkText} numberOfLines={1}>
              {String(entry?.text ?? '')}
            </Text>
            {meta ? <Text style={styles.mealTileMeta}>{meta}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
        </Pressable>
        <Pressable
          onPress={() => {
            setDraft(entry?.text ?? '');
            setEditing(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${day} bearbeiten`}
        >
          <Ionicons name="pencil-outline" size={16} color={colors.inkSoft} />
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.mealRow, heute && styles.mealHeute]}>
      <Text style={[styles.mealDay, heute && { color: colors.accent }]}>
        {day.slice(0, 2)}
      </Text>
      {editing ? (
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={draft}
          onChangeText={setDraft}
          autoFocus
          placeholder="Was gibt's?"
          placeholderTextColor={colors.inkFaint}
          onBlur={finish}
          onSubmitEditing={finish}
        />
      ) : (
        <Pressable
          style={{ flex: 1 }}
          onPress={() => {
            setDraft(entry?.text ?? '');
            setEditing(true);
          }}
        >
          <Text style={entry?.text ? styles.checkText : styles.mealEmpty}>
            {entry?.text ?? 'Antippen zum Planen'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Zweifeld-Formular (Kontakte, Countdowns, Rezepte, Dokumente). */
export function TwoFieldForm({
  labels,
  multilineSecond,
  onAdd,
  styles,
  colors,
}: {
  labels: string[];
  multilineSecond?: boolean;
  onAdd: (first: string, second: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  return (
    <View style={styles.formCard}>
      <TextInput
        style={styles.input}
        value={first}
        onChangeText={setFirst}
        placeholder={labels[0]}
        placeholderTextColor={colors.inkFaint}
      />
      <TextInput
        style={[styles.input, multilineSecond && { minHeight: 70 }]}
        value={second}
        onChangeText={setSecond}
        placeholder={labels[1]}
        placeholderTextColor={colors.inkFaint}
        multiline={multilineSecond}
      />
      <Pressable
        onPress={() => {
          if (!first.trim()) return;
          onAdd(first.trim(), second.trim());
          setFirst('');
          setSecond('');
        }}
        style={styles.addWide}
      >
        <Text style={styles.addWideText}>Hinzufügen</Text>
      </Pressable>
    </View>
  );
}

/** Countdown erfassen: Anlass, Datum und ob er auf die Startseite soll. */
export function CountdownForm({
  onAdd,
  styles,
  colors,
}: {
  onAdd: (text: string, date: string, onStart: boolean) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [onStart, setOnStart] = useState(false);
  return (
    <View style={styles.formCard}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Anlass (z.B. Ferien)"
        placeholderTextColor={colors.inkFaint}
      />
      <TextInput
        style={styles.input}
        value={date}
        onChangeText={setDate}
        placeholder="Datum (TT.MM.JJJJ)"
        placeholderTextColor={colors.inkFaint}
      />
      <Pressable
        onPress={() => setOnStart((value) => !value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: onStart }}
        style={styles.toggleRow}
      >
        <Ionicons
          name={onStart ? 'checkbox' : 'square-outline'}
          size={22}
          color={onStart ? colors.accent : colors.inkFaint}
        />
        <Text style={styles.toggleLabel}>Auf der Startseite anzeigen</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          if (!text.trim()) return;
          onAdd(text.trim(), date.trim(), onStart);
          setText('');
          setDate('');
          setOnStart(false);
        }}
        style={styles.addWide}
      >
        <Text style={styles.addWideText}>Hinzufügen</Text>
      </Pressable>
    </View>
  );
}

/** Monatsraster mit Punkten an Tagen mit Terminen; ein Tag antippen zeigt
 *  seine Termine darunter. Blättern über die Pfeile im Kopf. */
export function MonthCalendar({
  events,
  styles,
  colors,
}: {
  events: FamilyItem[];
  styles: Styles;
  colors: Colors;
}) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);

  const key = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  // Termine je Tagesschlüssel sammeln.
  const byDay = new Map<string, FamilyItem[]>();
  for (const event of events) {
    const date = new Date(event.start);
    if (Number.isNaN(date.getTime())) continue;
    const k = key(date);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(event);
  }

  const year = month.getFullYear();
  const mon = month.getMonth();
  const first = new Date(year, mon, 1);
  // Montag = 0 … Sonntag = 6.
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, mon, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedEvents = selected ? byDay.get(selected) ?? [] : [];

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.calHead}>
        <Pressable
          onPress={() => setMonth(new Date(year, mon - 1, 1))}
          hitSlop={8}
          accessibilityLabel="Vorheriger Monat"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.calTitle}>
          {monatJahr(month)}
        </Text>
        <Pressable
          onPress={() => setMonth(new Date(year, mon + 1, 1))}
          hitSlop={8}
          accessibilityLabel="Nächster Monat"
        >
          <Ionicons name="chevron-forward" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <View style={styles.calGrid}>
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label) => (
          <Text key={label} style={styles.calWeekday}>
            {label}
          </Text>
        ))}
        {cells.map((date, index) => {
          if (!date) return <View key={index} style={styles.calCell} />;
          const k = key(date);
          const isToday = k === key(today);
          const hasEvents = byDay.has(k);
          const isSelected = k === selected;
          return (
            <Pressable
              key={index}
              onPress={() => setSelected(isSelected ? null : k)}
              style={[
                styles.calCell,
                isSelected && styles.calCellSelected,
                isToday && !isSelected && styles.calCellToday,
              ]}
            >
              <Text
                style={[
                  styles.calDay,
                  (isSelected || isToday) && { color: colors.ink, fontWeight: '700' },
                ]}
              >
                {date.getDate()}
              </Text>
              {hasEvents ? <View style={styles.calDot} /> : null}
            </Pressable>
          );
        })}
      </View>

      {selected ? (
        <Card style={styles.listCard}>
          {selectedEvents.length > 0 ? (
            selectedEvents.map((event, index) => (
              <View key={index} style={styles.eventRow}>
                <View style={styles.eventDot} />
                <Text style={[styles.checkText, { flex: 1 }]} numberOfLines={2}>
                  {event.summary ?? '—'}
                </Text>
                <Text style={styles.checkSub}>
                  {event.all_day
                    ? 'ganztägig'
                    : uhr(new Date(event.start))}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.hint}>Keine Termine an diesem Tag.</Text>
          )}
        </Card>
      ) : null}
    </View>
  );
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────

