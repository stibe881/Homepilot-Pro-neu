import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Entity, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { DraggableList } from '../components/DraggableList';
import { Shops } from '../components/Shops';
import { Colors, radius, space, useColors } from '../theme';
import { RecipeBook } from './RecipeBook';
import { ingredientsToShopping, shopCategory } from '../lib/einkauf';
import { tapped } from '../lib/haptics';
import { ROLE_LABELS } from './UsersScreen';

/**
 * Familie: geteilte Listen und Planung für den Haushalt.
 *
 * Alle Daten liegen auf dem Hub (/api/family) – jedes Familienmitglied sieht
 * und pflegt dieselben Aufgaben, Einkaufslisten, Pins usw. Gäste sehen das
 * Modul nicht. Kalender und Geburtstage kommen aus dem Google-Kalender.
 *
 * Wichtig: Alle Unterkomponenten stehen auf Modulebene. Innerhalb der
 * Komponente definiert würden sie bei jedem Live-Update vom Hub neu erzeugt
 * (neuer Komponententyp) – React würde sie neu einhängen, und Eingaben wie
 * Tippen im Textfeld oder ein laufender Tastendruck gingen verloren.
 */

type FamilyData = Record<string, any[]>;
type Styles = ReturnType<typeof makeStyles>;

interface Member {
  name: string;
  role: string;
}

interface Props {
  settings: HubSettings;
  entities: Entity[];
  currentUser?: { name: string; role: string } | null;
  /** Selbst gezogene Reihenfolge der Modul-Kacheln (je Benutzer, vom Hub). */
  moduleOrder?: string[];
  onReorderModules?: (keys: string[]) => void;
}

type ModuleKey =
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

const WEEK_DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// ── Wiederverwendbare Bausteine (bewusst auf Modulebene) ────────────────────

function BackHead({
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

function AddRow({
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

function CheckRow({
  item,
  sub,
  highlight,
  onToggle,
  onDelete,
  onRemember,
  styles,
  colors,
}: {
  item: any;
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

function GroupedChecklist({
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
  items: any[];
  groupNoun: string;
  itemPlaceholder: string;
  onAdd: (group: string, text: string) => void;
  onToggle: (item: any) => void;
  onDelete: (item: any) => void;
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
function EventForm({
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
function isoInDays(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** Fälligkeit einer Aufgabe als Text plus «überfällig?» (rein, testbar). */
function dueInfo(due: string | undefined): { label: string; overdue: boolean } | null {
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

const DUE_OPTIONS: { key: string; label: string; days: number | null }[] = [
  { key: 'none', label: 'ohne Frist', days: null },
  { key: 'today', label: 'heute', days: 0 },
  { key: 'tomorrow', label: 'morgen', days: 1 },
  { key: 'week', label: 'in 1 Woche', days: 7 },
];

/** Wie oft sich eine Aufgabe wiederholt. «Einmalig» ist die Vorgabe -
 *  die meisten Aufgaben sind es. */
const REPEAT_OPTIONS = [
  { key: 'none', label: 'einmalig' },
  { key: 'daily', label: 'täglich' },
  { key: 'weekly', label: 'wöchentlich' },
  { key: 'monthly', label: 'monatlich' },
];

function PollAddRow({
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

function MedicationAddRow({
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

function ChoreAddRow({
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

function TaskAddRow({
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
const SHOP_CATEGORIES = [
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

function ShoppingAddRow({
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
async function pickPhoto(): Promise<string | null> {
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
function ContactPhoto({
  contact,
  size,
  styles,
}: {
  contact: any;
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
function ContactForm({
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
function daysUntilBirthday(value: any): number | null {
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
function birthdayLabel(value: any): string | null {
  const days = daysUntilBirthday(value);
  if (days == null) return null;
  if (days === 0) return 'Geburtstag heute! 🎉';
  if (days === 1) return 'Geburtstag morgen';
  return `Geburtstag in ${days} Tagen`;
}

/** Datum «TT.MM.JJJJ» oder ISO → Date (Mitternacht lokal). */
function parseSwissDate(value: any): Date | null {
  if (!value) return null;
  const swiss = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value).trim());
  if (swiss) {
    return new Date(Number(swiss[3]), Number(swiss[2]) - 1, Number(swiss[1]));
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Zeile im Essensplaner: antippen, tippen, fertig. */
function MealRow({
  day,
  entry,
  onSave,
  colors,
  styles,
}: {
  day: string;
  entry: any | undefined;
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
  return (
    <View style={styles.mealRow}>
      <Text style={styles.mealDay}>{day.slice(0, 2)}</Text>
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
function TwoFieldForm({
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
function CountdownForm({
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
function MonthCalendar({
  events,
  styles,
  colors,
}: {
  events: any[];
  styles: Styles;
  colors: Colors;
}) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);

  const key = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  // Termine je Tagesschlüssel sammeln.
  const byDay = new Map<string, any[]>();
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
          {month.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })}
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
                    : new Date(event.start).toLocaleTimeString('de-CH', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
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

export function FamilyScreen({
  settings,
  entities,
  currentUser,
  moduleOrder,
  onReorderModules,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${settings.token}` }),
    [settings.token]
  );

  const [data, setData] = useState<FamilyData>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<ModuleKey | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calMode, setCalMode] = useState<'list' | 'month'>('list');

  const load = useCallback(() => {
    fetch(`${settings.url}/api/family`, { headers })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err) => setError(`Familiendaten nicht abrufbar (${err})`));
  }, [settings.url, headers]);

  useEffect(load, [load]);

  useEffect(() => {
    fetch(`${settings.url}/api/users`, { headers })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setMembers)
      .catch(() =>
        setMembers(currentUser ? [{ name: currentUser.name, role: currentUser.role }] : [])
      );
  }, [settings.url, headers, currentUser]);

  // ── Änderungen an den Hub ──────────────────────────────────────────────

  const add = useCallback(
    async (collection: string, item: Record<string, any>) => {
      try {
        const response = await fetch(`${settings.url}/api/family/${collection}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        if (!response.ok) throw new Error(String(response.status));
        load();
      } catch (err: any) {
        setError(`Speichern fehlgeschlagen (${err.message ?? err})`);
      }
    },
    [settings.url, headers, load]
  );

  const update = useCallback(
    async (collection: string, id: string, patch: Record<string, any>) => {
      try {
        await fetch(`${settings.url}/api/family/${collection}/${id}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
      } finally {
        load();
      }
    },
    [settings.url, headers, load]
  );

  const remove = useCallback(
    async (collection: string, id: string) => {
      try {
        await fetch(`${settings.url}/api/family/${collection}/${id}`, {
          method: 'DELETE',
          headers,
        });
      } finally {
        load();
      }
    },
    [settings.url, headers, load]
  );

  // ── Abgeleitete Werte ──────────────────────────────────────────────────

  const calendar = entities.find((entity) => entity.kind === 'calendar');
  const events: any[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  const today = new Date();
  const isToday = (value: any) => {
    const date = new Date(value);
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };
  const todayCount = events.filter((event) => isToday(event.start)).length;
  const openTasks = (data.tasks ?? []).filter((task) => !task.done).length;
  const pinCount = (data.pins ?? []).length;
  // Wer gerade dran ist, steht auf der Kachel - das ist die Frage, die
  // man sich beim Blick auf «Ämtli» stellt.
  const chores: any[] = data.chores ?? [];
  const meineChores = chores.filter(
    (chore: any) => chore.member && chore.member === currentUser?.name
  );
  const notfall: any[] = data.emergency ?? [];
  const notfallSub =
    notfall.length > 0 ? `${notfall.length} Einträge` : 'Noch nichts hinterlegt';
  const meds: any[] = data.medications ?? [];
  const offeneMeds = meds.filter((med: any) => !med.done).length;
  const medSub = offeneMeds > 0 ? `${offeneMeds} laufend` : 'Nichts einzunehmen';
  const choreSub =
    chores.length === 0
      ? 'Reihe festlegen'
      : meineChores.length > 0
        ? `${meineChores.length} bei dir`
        : `${chores.length} in der Reihe`;

  const eventWhen = (event: any) =>
    event.all_day
      ? new Date(event.start).toLocaleDateString('de-CH', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      : new Date(event.start).toLocaleString('de-CH', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  const presenceOf = (name: string): 'home' | 'away' | null => {
    const first = name.split(' ')[0].toLowerCase();
    const tracker = entities.find(
      (entity) =>
        entity.kind === 'binary_sensor' && entity.name.toLowerCase().includes(first)
    );
    if (!tracker) return null;
    return tracker.state.state === 'on' ? 'home' : 'away';
  };

  const goBack = () => setView(null);

  // ── Die einzelnen Modul-Ansichten ──────────────────────────────────────

  if (view === 'kalender') {
    const upcoming = events.slice(0, 10);
    return (
      <View style={styles.stack}>
        <BackHead title="Kalender" onBack={goBack} styles={styles} colors={colors} />
        <View style={styles.chipRow}>
          {(['list', 'month'] as const).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => setCalMode(mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected: calMode === mode }}
              style={[styles.chip, calMode === mode && styles.chipActive]}
            >
              <Ionicons
                name={mode === 'list' ? 'list-outline' : 'calendar-outline'}
                size={14}
                color={calMode === mode ? '#FFFFFF' : colors.inkSoft}
              />
              <Text style={[styles.chipText, calMode === mode && styles.chipTextActive]}>
                {mode === 'list' ? 'Liste' : 'Kalender'}
              </Text>
            </Pressable>
          ))}
        </View>
        {calMode === 'month' ? (
          <MonthCalendar events={events} styles={styles} colors={colors} />
        ) : (
        <Card style={styles.listCard}>
          {upcoming.length > 0 ? (
            upcoming.map((event, index) => (
              <View key={index} style={styles.eventRow}>
                <View style={styles.eventDot} />
                <Text style={[styles.checkText, { flex: 1 }]} numberOfLines={1}>
                  {event.summary ?? '—'}
                </Text>
                <Text style={styles.checkSub}>{eventWhen(event)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.hint}>
              {calendar
                ? 'Keine anstehenden Termine.'
                : 'Google Kalender in der config.yaml einbinden, dann stehen hier die echten Termine.'}
            </Text>
          )}
        </Card>
        )}
        {calendar && calendar.commands.includes('create_event') ? (
          <EventForm
            onAdd={async (summary, date, time) => {
              try {
                const response = await fetch(
                  `${settings.url}/api/entities/${encodeURIComponent(calendar.id)}/command`,
                  {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      command: 'create_event',
                      data: { summary, date, time },
                    }),
                  }
                );
                if (!response.ok) {
                  const body = await response.json().catch(() => null);
                  throw new Error(body?.detail ?? response.status);
                }
              } catch (err: any) {
                setError(`Termin nicht angelegt (${err.message ?? err})`);
              }
            }}
            styles={styles}
            colors={colors}
          />
        ) : null}
      </View>
    );
  }

  if (view === 'tasks') {
    const tasks: any[] = data.tasks ?? [];
    // Eltern (Besitzer/Bewohner) dürfen Punkte bestätigen; Kinder/Gäste nicht.
    const isParent =
      currentUser?.role === 'besitzer' || currentUser?.role === 'bewohner';
    const pending = tasks.filter((task) => task.pending_reward);

    const toggleTask = (task: any) => {
      tapped();
      // Wiederkehrendes verschwindet nicht, es rückt weiter: Der Haushalt
      // hört ja nicht auf. Punkte werden dabei trotzdem fällig.
      if (!task.done && task.repeat && task.repeat !== 'none') {
        if (task.member && Number(task.points) > 0) {
          add('rewards', {
            member: task.member,
            points: Number(task.points),
            reason: task.text,
          });
        }
        update('tasks', task.id, {
          done: false,
          pending_reward: false,
          due: nextDue(task.due, task.repeat),
        });
        return;
      }
      // Punkte-Aufgaben werden beim Abhaken NICHT sofort gutgeschrieben,
      // sondern warten auf die Bestätigung eines Elternteils (#20).
      if (!task.done && task.member && Number(task.points) > 0 && !task.rewarded) {
        update('tasks', task.id, { done: true, pending_reward: true });
      } else {
        update('tasks', task.id, { done: !task.done, pending_reward: false });
      }
    };
    const confirmReward = (task: any) => {
      add('rewards', {
        member: task.member,
        points: Number(task.points),
        reason: task.text,
      });
      update('tasks', task.id, { rewarded: true, pending_reward: false });
    };
    const rejectReward = (task: any) =>
      update('tasks', task.id, { pending_reward: false, done: false });

    const taskSub = (task: any) => {
      const parts = [];
      if (task.member) parts.push(`für ${task.member}`);
      if (Number(task.points) > 0) parts.push(`${task.points} Punkte`);
      const due = dueInfo(task.due);
      if (due && !task.done) parts.push(due.label);
      if (task.repeat && task.repeat !== 'none') {
        parts.push(
          REPEAT_OPTIONS.find((option) => option.key === task.repeat)?.label ??
            task.repeat
        );
      }
      if (task.pending_reward) parts.push('wartet auf Bestätigung');
      return parts.join(' · ') || undefined;
    };
    // Offene zuerst, darin die mit der nächsten Frist oben; Erledigte unten.
    const sorted = [...tasks].sort((a, b) => {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return String(a.due ?? '9999').localeCompare(String(b.due ?? '9999'));
    });

    return (
      <View style={styles.stack}>
        <BackHead title="Aufgaben" onBack={goBack} styles={styles} colors={colors} />

        {pending.length > 0 && isParent ? (
          <>
            <Text style={styles.groupLabel}>Punkte bestätigen</Text>
            <Card style={styles.listCard}>
              {pending.map((task) => (
                <View key={task.id} style={styles.confirmRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkText}>{task.text}</Text>
                    <Text style={styles.checkSub}>
                      {task.member} · {task.points} Punkte
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => confirmReward(task)}
                    style={styles.confirmOk}
                    accessibilityLabel="Punkte gutschreiben"
                  >
                    <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                  </Pressable>
                  <Pressable
                    onPress={() => rejectReward(task)}
                    style={styles.confirmNo}
                    accessibilityLabel="Ablehnen"
                  >
                    <Ionicons name="close" size={18} color={colors.ink} />
                  </Pressable>
                </View>
              ))}
            </Card>
          </>
        ) : null}
        {pending.length > 0 && !isParent ? (
          <Text style={styles.hint}>
            {pending.length} erledigte Aufgabe(n) warten auf die Bestätigung
            eines Elternteils, dann gibt es die Punkte.
          </Text>
        ) : null}

        <Card style={styles.listCard}>
          {sorted.map((task) => (
            <CheckRow
              key={task.id}
              item={task}
              sub={taskSub(task)}
              highlight={(() => {
                const due = dueInfo(task.due);
                return due?.overdue && !task.done ? colors.danger : undefined;
              })()}
              onToggle={() => toggleTask(task)}
              onDelete={() => remove('tasks', task.id)}
              styles={styles}
              colors={colors}
            />
          ))}
          <TaskAddRow
            members={members}
            onAdd={(text, member, points, due, repeat) =>
              add('tasks', {
                text,
                done: false,
                member,
                points,
                repeat,
                ...(due ? { due } : {}),
              })
            }
            styles={styles}
            colors={colors}
          />
        </Card>
        <Text style={styles.hint}>
          Person, Punkte und Frist sind freiwillig. Punkte-Aufgaben schreibt
          ein Elternteil nach dem Abhaken oben gut.
        </Text>
      </View>
    );
  }

  if (view === 'shopping') {
    const items: any[] = data.shopping ?? [];
    const done = items.filter((item) => item.done);
    // Nach Kategorie gruppieren, in der Ladenrundgang-Reihenfolge. Einträge
    // ohne Kategorie (alt oder aus dem Essensplan) landen unter «Sonstiges».
    const catOf = (item: any) =>
      SHOP_CATEGORIES.includes(item.category) ? item.category : 'Sonstiges';
    const usedCats = SHOP_CATEGORIES.filter((cat) =>
      items.some((item) => catOf(item) === cat)
    );
    // Standardartikel: was jede Woche in den Wagen wandert. Ein Tipp
    // legt sie an, statt sie jedes Mal zu tippen - und wer sie einmal
    // von Hand einträgt, kann sie danach als Standard merken.
    const staples: any[] = data.staples ?? [];
    const aufListe = new Set(
      items.map((item: any) => String(item.text ?? '').trim().toLowerCase())
    );
    return (
      <View style={styles.stack}>
        <BackHead title="Einkaufsliste" onBack={goBack} styles={styles} colors={colors} />
        <Card style={styles.listCard}>
          <ShoppingAddRow
            onAdd={(text, category) =>
              add('shopping', { text, category: category || shopCategory(text), done: false })
            }
            styles={styles}
            colors={colors}
          />
        </Card>
        {staples.length > 0 ? (
          <Card style={styles.listCard}>
            <Text style={styles.groupTitle}>Standardartikel</Text>
            <View style={styles.stapleRow}>
              {staples.map((staple: any) => {
                const drauf = aufListe.has(
                  String(staple.text ?? '').trim().toLowerCase()
                );
                return (
                  <Pressable
                    key={staple.id}
                    onPress={() =>
                      drauf
                        ? undefined
                        : add('shopping', {
                            text: staple.text,
                            category: staple.category || shopCategory(staple.text),
                            done: false,
                          })
                    }
                    onLongPress={() => remove('staples', staple.id)}
                    disabled={drauf}
                    accessibilityRole="button"
                    accessibilityLabel={
                      drauf
                        ? `${staple.text} steht schon auf der Liste`
                        : `${staple.text} auf die Liste`
                    }
                    style={[styles.staple, drauf && { opacity: 0.4 }]}
                  >
                    <Ionicons
                      name={drauf ? 'checkmark' : 'add'}
                      size={13}
                      color={colors.inkSoft}
                    />
                    <Text style={styles.stapleText}>{staple.text}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              Tippen legt den Artikel auf die Liste. Lange drücken entfernt
              ihn aus den Standardartikeln.
            </Text>
          </Card>
        ) : null}
        {usedCats.map((cat) => (
          <Card key={cat} style={styles.listCard}>
            <Text style={styles.groupTitle}>{cat}</Text>
            {items
              .filter((item) => catOf(item) === cat)
              .map((item) => (
                <CheckRow
                  key={item.id}
                  item={item}
                  onToggle={() => update('shopping', item.id, { done: !item.done })}
                  onDelete={() => remove('shopping', item.id)}
                  // Lange drücken macht einen Standardartikel daraus -
                  // dort, wo man merkt, dass man ihn schon wieder tippt.
                  onRemember={
                    staples.some(
                      (staple: any) =>
                        String(staple.text ?? '').toLowerCase() ===
                        String(item.text ?? '').toLowerCase()
                    )
                      ? undefined
                      : () =>
                          add('staples', {
                            text: item.text,
                            category: item.category ?? null,
                          })
                  }
                  styles={styles}
                  colors={colors}
                />
              ))}
          </Card>
        ))}
        {items.length === 0 ? (
          <Text style={styles.hint}>Die Liste ist leer. Trag oben ein, was fehlt.</Text>
        ) : null}
        {done.length > 0 ? (
          <Pressable
            onPress={() => done.forEach((item) => remove('shopping', item.id))}
            style={styles.clearButton}
          >
            <Text style={styles.resetText}>{done.length} Erledigte entfernen</Text>
          </Pressable>
        ) : null}
        {/* Ganz unten, eingeklappt: Die Läden richtet man einmal ein und
            danach jahrelang nicht mehr - über der Liste stünden sie im
            Weg. */}
        <Shops
          shops={data.shops ?? []}
          onAdd={(shop) => add('shops', shop)}
          onUpdate={(id, changes) => update('shops', id, changes)}
          onRemove={(id) => remove('shops', id)}
        />
      </View>
    );
  }

  if (view === 'meals') {
    const meals: any[] = data.meals ?? [];
    const planned = meals.filter((meal) => String(meal.text ?? '').trim());
    // Alle geplanten Gerichte auf die Einkaufsliste – jedes als ein Eintrag,
    // Doppelte überspringen. Kategorie «Sonstiges», dort lässt es sich ordnen.
    const recipes: any[] = data.recipes ?? [];
    // Zu welchen Gerichten kennen wir das Rezept? Nur bei denen lassen
    // sich Zutaten holen; für den Rest bleibt der Name des Gerichts, den
    // man dann von Hand ergänzt.
    const geplanteRezepte = planned
      .map((meal: any) =>
        recipes.find(
          (recipe) =>
            recipe.id === meal.recipe_id ||
            String(recipe.text ?? '') === String(meal.text ?? '')
        )
      )
      .filter(Boolean);

    const vorhanden = () =>
      (data.shopping ?? []).map((item: any) => String(item.text ?? ''));

    /** Zutaten aller geplanten Rezepte - der eigentliche Wocheneinkauf. */
    const zutatenEinkauf = () => {
      const neu = ingredientsToShopping(geplanteRezepte, vorhanden());
      neu.forEach((eintrag) => add('shopping', { ...eintrag, done: false }));
      return neu.length;
    };

    /** Nur die Namen der Gerichte - für Geplantes ohne hinterlegtes Rezept. */
    const toShopping = () => {
      const existing = new Set(
        vorhanden().map((text) => text.toLowerCase())
      );
      planned.forEach((meal) => {
        const text = String(meal.text).trim();
        if (!existing.has(text.toLowerCase())) {
          add('shopping', { text, category: 'Sonstiges', done: false });
          existing.add(text.toLowerCase());
        }
      });
    };
    return (
      <View style={styles.stack}>
        <BackHead title="Essensplaner" onBack={goBack} styles={styles} colors={colors} />
        <Card style={styles.listCard}>
          {WEEK_DAYS.map((day) => {
            const entry = meals.find((meal) => meal.day === day);
            return (
              <MealRow
                key={day}
                day={day}
                entry={entry}
                onSave={(text) => {
                  if (entry) {
                    if (text) {
                      update('meals', entry.id, { text });
                    } else {
                      remove('meals', entry.id);
                    }
                  } else if (text) {
                    add('meals', { day, text });
                  }
                }}
                colors={colors}
                styles={styles}
              />
            );
          })}
        </Card>
        {geplanteRezepte.length > 0 ? (
          <Pressable
            onPress={zutatenEinkauf}
            accessibilityRole="button"
            style={({ pressed }) => [styles.mealShopButton, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="basket-outline" size={18} color="#FFFFFF" />
            <Text style={styles.mealShopText}>
              Wocheneinkauf: Zutaten aus {geplanteRezepte.length} Rezept
              {geplanteRezepte.length === 1 ? '' : 'en'}
            </Text>
          </Pressable>
        ) : null}
        {planned.length > 0 ? (
          <Pressable
            onPress={toShopping}
            accessibilityRole="button"
            style={({ pressed }) => [styles.mealNameButton, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="cart-outline" size={18} color={colors.ink} />
            <Text style={styles.mealNameText}>
              Nur die {planned.length} Gerichtnamen auf die Liste
            </Text>
          </Pressable>
        ) : null}
        <Text style={styles.hint}>
          Trag pro Tag ein, was es gibt – am besten über «Planen» im
          Rezeptbuch. Dann kennt der Wocheneinkauf die Zutaten und sortiert
          sie gleich nach Ladengang. Ohne hinterlegtes Rezept bleibt der
          Name des Gerichts, den du auf der Liste ergänzt.
        </Text>
      </View>
    );
  }

  if (view === 'pins') {
    const pins: any[] = data.pins ?? [];
    const polls: any[] = data.polls ?? [];
    const ich = currentUser?.name ?? '';

    /** Eine Stimme abgeben oder zurückziehen.
     *
     * Die Stimmen stehen als {Person: Antwort} am Eintrag - so sieht man,
     * wer noch fehlt. Genau das ist der Punkt gegenüber fünf Antworten im
     * Familienchat, bei denen niemand mehr weiss, wer sich gemeldet hat. */
    const stimmen = (poll: any, antwort: string) => {
      const bisher = { ...(poll.votes ?? {}) };
      if (bisher[ich] === antwort) delete bisher[ich];
      else bisher[ich] = antwort;
      update('polls', poll.id, { votes: bisher });
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Pinnwand" onBack={goBack} styles={styles} colors={colors} />
        <AddRow
          placeholder="Nachricht an alle …"
          multiline
          onAdd={(text) => add('pins', { text })}
          styles={styles}
          colors={colors}
        />

        <Card style={styles.listCard}>
          <Text style={styles.groupTitle}>Abstimmung</Text>
          <PollAddRow
            onAdd={(frage, optionen) =>
              add('polls', { text: frage, options: optionen, votes: {} })
            }
            styles={styles}
            colors={colors}
          />
        </Card>

        {polls
          .slice()
          .reverse()
          .map((poll: any) => {
            const votes: Record<string, string> = poll.votes ?? {};
            const optionen: string[] = Array.isArray(poll.options) ? poll.options : [];
            const fehlen = members
              .map((m) => m.name)
              .filter((name) => !votes[name]);
            return (
              <Card key={poll.id} style={styles.pinCard}>
                <View style={styles.checkRow}>
                  <Text style={[styles.checkText, { flex: 1 }]}>{poll.text}</Text>
                  <Pressable
                    onPress={() => remove('polls', poll.id)}
                    style={styles.deleteTap}
                    accessibilityLabel="Abstimmung löschen"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
                  </Pressable>
                </View>
                {optionen.map((option) => {
                  const dafuer = Object.entries(votes)
                    .filter(([, wahl]) => wahl === option)
                    .map(([name]) => name);
                  const meine = votes[ich] === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => stimmen(poll, option)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: meine }}
                      style={[styles.pollRow, meine && styles.pollRowMine]}
                    >
                      <Ionicons
                        name={meine ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={meine ? colors.accent : colors.inkSoft}
                      />
                      <Text style={[styles.checkText, { flex: 1 }]}>{option}</Text>
                      <Text style={styles.checkSub}>
                        {dafuer.length > 0 ? dafuer.join(', ') : '–'}
                      </Text>
                    </Pressable>
                  );
                })}
                <Text style={styles.checkSub}>
                  {fehlen.length === 0
                    ? 'Alle haben abgestimmt.'
                    : `Es fehlen: ${fehlen.join(', ')}`}
                </Text>
              </Card>
            );
          })}
        {pins
          .slice()
          .reverse()
          .map((pin) => (
            <Card key={pin.id} style={styles.pinCard}>
              <Text style={styles.checkText}>{pin.text}</Text>
              <View style={styles.pinFoot}>
                <Text style={styles.checkSub}>
                  {pin.author}
                  {pin.created ? ` · ${pin.created.slice(0, 10)}` : ''}
                </Text>
                <Pressable
                  onPress={() => remove('pins', pin.id)}
                  style={styles.deleteTap}
                  accessibilityRole="button"
                  accessibilityLabel={`Notiz «${pin.text}» löschen`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
                </Pressable>
              </View>
            </Card>
          ))}
      </View>
    );
  }

  if (view === 'chores') {
    const liste: any[] = data.chores ?? [];

    /** Erledigt: Punkte gutschreiben, Reihe weiterrücken, Frist neu setzen.
     *
     * Genau diese drei Schritte macht sonst jemand von Hand - und einer
     * davon geht immer vergessen, meistens das Weiterrücken. */
    const erledigt = (chore: any) => {
      const reihe: string[] = Array.isArray(chore.members) ? chore.members : [];
      const naechster = rotateMember(reihe, chore.member);
      if (chore.member && Number(chore.points) > 0) {
        add('rewards', {
          member: chore.member,
          points: Number(chore.points),
          reason: `Ämtli: ${chore.text}`,
        });
      }
      update('chores', chore.id, {
        member: naechster,
        due: nextDue(chore.due, chore.repeat || 'weekly'),
        last_done: isoInDays(0),
        last_by: chore.member ?? null,
      });
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Ämtli" onBack={goBack} styles={styles} colors={colors} />
        <Text style={styles.hint}>
          Wer dran ist, entscheidet die Reihe – nicht die Diskussion am
          Sonntagabend. Nach «Erledigt» rückt sie von selbst weiter, die
          Frist wandert mit, und die Punkte gehen an den, der es gemacht
          hat.
        </Text>

        <Card style={styles.listCard}>
          <ChoreAddRow
            members={members}
            onAdd={(text, reihe, points, repeat) =>
              add('chores', {
                text,
                members: reihe,
                member: reihe[0] ?? null,
                points,
                repeat,
                due: nextDue(isoInDays(-1), repeat),
              })
            }
            styles={styles}
            colors={colors}
          />
        </Card>

        {liste.map((chore: any) => {
          const faellig = dueInfo(chore.due);
          const reihe: string[] = Array.isArray(chore.members) ? chore.members : [];
          const naechster = rotateMember(reihe, chore.member);
          return (
            <Card key={chore.id} style={styles.listCard}>
              <View style={styles.checkRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkText}>{chore.text}</Text>
                  <Text
                    style={[
                      styles.checkSub,
                      faellig?.overdue ? { color: colors.danger, fontWeight: '600' } : null,
                    ]}
                  >
                    {[
                      chore.member ? `${chore.member} ist dran` : 'niemand zugeteilt',
                      faellig?.label,
                      Number(chore.points) > 0 ? `${chore.points} Punkte` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {chore.last_by ? (
                    <Text style={styles.checkSub}>
                      zuletzt: {chore.last_by}
                      {chore.last_done ? ` am ${chore.last_done}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => remove('chores', chore.id)}
                  style={styles.deleteTap}
                  accessibilityLabel={`${chore.text} löschen`}
                >
                  <Ionicons name="close" size={18} color={colors.inkFaint} />
                </Pressable>
              </View>
              <View style={styles.chipRow}>
                {reihe.map((name) => (
                  <View
                    key={name}
                    style={[styles.chip, chore.member === name && styles.chipActive]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        chore.member === name && styles.chipTextActive,
                      ]}
                    >
                      {name}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.choreButtons}>
                <Pressable
                  onPress={() => erledigt(chore)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.choreDone, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="checkmark" size={17} color="#FFFFFF" />
                  <Text style={styles.choreDoneText}>Erledigt</Text>
                </Pressable>
                {naechster && naechster !== chore.member ? (
                  <Pressable
                    onPress={() => update('chores', chore.id, { member: naechster })}
                    accessibilityRole="button"
                    accessibilityLabel={`Weiter an ${naechster}`}
                    style={({ pressed }) => [styles.choreSkip, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="play-skip-forward" size={15} color={colors.ink} />
                    <Text style={styles.choreSkipText}>Weiter an {naechster}</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          );
        })}

        {liste.length === 0 ? (
          <Text style={styles.hint}>
            Noch keine Ämtli. Trag oben eines ein und wähle, wer in der Reihe
            steht.
          </Text>
        ) : null}
      </View>
    );
  }

  if (view === 'babysitter') {
    const notfaelle: any[] = data.emergency ?? [];
    const kontakte: any[] = data.contacts ?? [];
    const routinen: any[] = data.routines ?? [];
    const heuteMeds = (data.medications ?? []).filter((med: any) => !med.done);
    const heute = isoInDays(0);

    return (
      <View style={styles.stack}>
        <BackHead title="Babysitter" onBack={goBack} styles={styles} colors={colors} />
        <Text style={styles.hint}>
          Eine Seite zum Hinlegen oder Zeigen: Notfallblatt, wichtige
          Nummern, die Abendroutine und was heute noch einzunehmen ist.
          Zusammengetragen aus den anderen Modulen – hier gibt es nichts
          zusätzlich zu pflegen.
        </Text>

        {notfaelle.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Im Notfall</Text>
            {notfaelle.map((eintrag: any) => (
              <Card key={eintrag.id} style={styles.pinCard}>
                <Text style={styles.checkText}>{eintrag.text}</Text>
                {eintrag.body ? (
                  <Text style={styles.checkSub} selectable>
                    {eintrag.body}
                  </Text>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}

        {kontakte.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Nummern</Text>
            <Card style={styles.listCard}>
              {kontakte.map((kontakt: any) => (
                <View key={kontakt.id} style={styles.checkRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkText}>{kontakt.text}</Text>
                    {kontakt.body ? (
                      <Text style={styles.checkSub} selectable>
                        {kontakt.body}
                      </Text>
                    ) : null}
                  </View>
                  {kontakt.body ? (
                    <Pressable
                      onPress={() =>
                        Linking.openURL(`tel:${String(kontakt.body).replace(/[^+\d]/g, '')}`)
                      }
                      style={styles.callButton}
                      accessibilityLabel={`${kontakt.text} anrufen`}
                    >
                      <Ionicons name="call" size={16} color="#FFFFFF" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {heuteMeds.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Heute noch einzunehmen</Text>
            <Card style={styles.listCard}>
              {heuteMeds.map((med: any) => {
                const genommen: string[] = Array.isArray(med.taken) ? med.taken : [];
                return (
                  <View key={med.id} style={styles.checkRow}>
                    <Ionicons
                      name={
                        genommen.includes(heute) ? 'checkmark-circle' : 'ellipse-outline'
                      }
                      size={22}
                      color={genommen.includes(heute) ? colors.on : colors.warn}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkText}>{med.text}</Text>
                      <Text style={styles.checkSub}>
                        {[
                          med.member ? `für ${med.member}` : null,
                          genommen.includes(heute) ? 'heute schon gegeben' : 'heute offen',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        {routinen.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Routinen</Text>
            <Card style={styles.listCard}>
              {routinen.map((routine: any) => (
                <View key={routine.id} style={styles.checkRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkText}>{routine.text}</Text>
                    {routine.body ? (
                      <Text style={styles.checkSub}>{routine.body}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {notfaelle.length === 0 && kontakte.length === 0 && routinen.length === 0 ? (
          <Text style={styles.hint}>
            Noch nichts zusammenzutragen. Füll das Notfallblatt, die Kontakte
            und die Routinen – diese Seite baut sich daraus von selbst.
          </Text>
        ) : null}
      </View>
    );
  }

  if (view === 'woche') {
    // Montag dieser Woche als Ausgangspunkt: In der Schweiz beginnt die
    // Woche am Montag, und der Essensplan ist ohnehin so aufgebaut.
    const montag = new Date(today);
    montag.setHours(0, 0, 0, 0);
    montag.setDate(montag.getDate() - ((montag.getDay() + 6) % 7));

    const tage = WEEK_DAYS.map((name, index) => {
      const datum = new Date(montag);
      datum.setDate(montag.getDate() + index);
      const iso = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(
        datum.getDate()
      ).padStart(2, '0')}`;
      return {
        name,
        datum,
        iso,
        heute:
          datum.getFullYear() === today.getFullYear() &&
          datum.getMonth() === today.getMonth() &&
          datum.getDate() === today.getDate(),
        termine: events.filter((event: any) => {
          const start = new Date(event.start);
          return (
            start.getFullYear() === datum.getFullYear() &&
            start.getMonth() === datum.getMonth() &&
            start.getDate() === datum.getDate()
          );
        }),
        essen: (data.meals ?? []).find((meal: any) => meal.day === name),
        aemtli: (data.chores ?? []).filter(
          (chore: any) => String(chore.due ?? '').slice(0, 10) === iso
        ),
        aufgaben: (data.tasks ?? []).filter(
          (task: any) => !task.done && String(task.due ?? '').slice(0, 10) === iso
        ),
      };
    });

    return (
      <View style={styles.stack}>
        <BackHead title="Wochenplan" onBack={goBack} styles={styles} colors={colors} />
        <Text style={styles.hint}>
          Sonntagabend eine Seite statt vier Module: was ansteht, was es zu
          essen gibt, wer welches Ämtli hat. Ändern lässt sich alles dort,
          wo es hingehört – hier wird nur gezeigt.
        </Text>
        {tage.map((tag) => {
          const leer =
            tag.termine.length === 0 &&
            !tag.essen?.text &&
            tag.aemtli.length === 0 &&
            tag.aufgaben.length === 0;
          return (
            <Card
              key={tag.name}
              style={{
                ...styles.listCard,
                ...(tag.heute ? { borderColor: colors.accent } : {}),
              }}
            >
              <View style={styles.weekHead}>
                <Text style={[styles.groupTitle, tag.heute && { color: colors.accent }]}>
                  {tag.name}
                </Text>
                <Text style={styles.checkSub}>
                  {tag.datum.getDate()}.{tag.datum.getMonth() + 1}.
                  {tag.heute ? ' · heute' : ''}
                </Text>
              </View>

              {tag.termine.map((event: any, index: number) => (
                <View key={`t${index}`} style={styles.weekRowItem}>
                  <Ionicons name="calendar-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]} numberOfLines={1}>
                    {event.summary ?? event.title ?? 'Termin'}
                  </Text>
                </View>
              ))}

              {tag.essen?.text ? (
                <View style={styles.weekRowItem}>
                  <Ionicons name="restaurant-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]}>{tag.essen.text}</Text>
                </View>
              ) : null}

              {tag.aemtli.map((chore: any) => (
                <View key={chore.id} style={styles.weekRowItem}>
                  <Ionicons name="repeat-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]}>
                    {chore.text}
                    {chore.member ? ` – ${chore.member}` : ''}
                  </Text>
                </View>
              ))}

              {tag.aufgaben.map((task: any) => (
                <View key={task.id} style={styles.weekRowItem}>
                  <Ionicons name="checkbox-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]}>
                    {task.text}
                    {task.member ? ` – ${task.member}` : ''}
                  </Text>
                </View>
              ))}

              {leer ? <Text style={styles.checkSub}>nichts geplant</Text> : null}
            </Card>
          );
        })}
      </View>
    );
  }

  if (view === 'emergency') {
    const eintraege: any[] = data.emergency ?? [];
    return (
      <View style={styles.stack}>
        <BackHead title="Notfallblatt" onBack={goBack} styles={styles} colors={colors} />
        <Text style={styles.hint}>
          Was jemand wissen muss, der im Ernstfall bei euch ist – Allergien,
          Blutgruppe, Versichertennummer, wen man anruft. Bewusst kurz und
          auf einer Seite: Im Notfall liest niemand einen Ordner.
        </Text>
        <Text style={styles.formHintSmall}>
          Keine Passwörter und keine Kartennummern hier hinein – dieses Blatt
          zeigt man im Zweifel einer fremden Person.
        </Text>
        {eintraege.map((eintrag: any) => (
          <Card key={eintrag.id} style={styles.pinCard}>
            <View style={styles.checkRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>{eintrag.text}</Text>
                {eintrag.body ? (
                  <Text style={styles.checkSub} selectable>
                    {eintrag.body}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => remove('emergency', eintrag.id)}
                style={styles.deleteTap}
                accessibilityLabel={`${eintrag.text} löschen`}
              >
                <Ionicons name="close" size={18} color={colors.inkFaint} />
              </Pressable>
            </View>
          </Card>
        ))}
        <TwoFieldForm
          labels={['Wer/Was (z.B. Lina – Allergien)', 'Angaben']}
          multilineSecond
          onAdd={(text, body) => add('emergency', { text, body })}
          styles={styles}
          colors={colors}
        />
      </View>
    );
  }

  if (view === 'medications') {
    const liste: any[] = data.medications ?? [];
    const heute = isoInDays(0);

    /** Eingenommen: Häkchen für heute, und die Kur zählt einen Tag runter. */
    const eingenommen = (med: any) => {
      const genommen: string[] = Array.isArray(med.taken) ? med.taken : [];
      if (genommen.includes(heute)) {
        update('medications', med.id, {
          taken: genommen.filter((tag) => tag !== heute),
        });
        return;
      }
      const neu = [...genommen, heute];
      const tage = Number(med.days) || 0;
      update('medications', med.id, {
        taken: neu,
        // Eine Kur über zehn Tage endet nach zehn Häkchen von selbst -
        // sonst erinnert sie bis in alle Ewigkeit weiter.
        done: tage > 0 && neu.length >= tage,
      });
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Medikamente" onBack={goBack} styles={styles} colors={colors} />
        <Text style={styles.hint}>
          Für Kuren über mehrere Tage: Antibiotika, Tropfen, Salben. Ein
          Häkchen je Tag – so sieht man am Abend, ob es schon jemand
          gegeben hat, statt zu raten.
        </Text>
        <Card style={styles.listCard}>
          <MedicationAddRow
            members={members}
            onAdd={(text, member, days) =>
              add('medications', { text, member, days, taken: [], done: false })
            }
            styles={styles}
            colors={colors}
          />
        </Card>
        {liste.map((med: any) => {
          const genommen: string[] = Array.isArray(med.taken) ? med.taken : [];
          const heuteSchon = genommen.includes(heute);
          const tage = Number(med.days) || 0;
          return (
            <Card
              key={med.id}
              style={{ ...styles.listCard, ...(med.done ? { opacity: 0.5 } : {}) }}
            >
              <View style={styles.checkRow}>
                <Pressable
                  onPress={() => eingenommen(med)}
                  disabled={med.done}
                  style={styles.checkTap}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: heuteSchon }}
                  accessibilityLabel={`${med.text} für heute abhaken`}
                >
                  <Ionicons
                    name={heuteSchon ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={heuteSchon ? colors.on : colors.inkSoft}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkText}>{med.text}</Text>
                    <Text style={styles.checkSub}>
                      {[
                        med.member ? `für ${med.member}` : null,
                        tage > 0 ? `Tag ${Math.min(genommen.length + (heuteSchon ? 0 : 1), tage)} von ${tage}` : null,
                        med.done ? 'Kur beendet' : heuteSchon ? 'heute erledigt' : 'heute offen',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => remove('medications', med.id)}
                  style={styles.deleteTap}
                  accessibilityLabel={`${med.text} löschen`}
                >
                  <Ionicons name="close" size={18} color={colors.inkFaint} />
                </Pressable>
              </View>
            </Card>
          );
        })}
        {liste.length === 0 ? (
          <Text style={styles.hint}>Nichts eingetragen.</Text>
        ) : null}
      </View>
    );
  }

  if (view === 'rewards') {
    const log: any[] = data.rewards ?? [];
    const catalog: any[] = data.rewards_catalog ?? [];
    const pointsOf = (name: string) =>
      log
        .filter((entry) => entry.member === name)
        .reduce((sum, entry) => sum + Number(entry.points ?? 0), 0);
    const totals = members.map((member) => ({ ...member, points: pointsOf(member.name) }));
    const recent = [...log]
      .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')))
      .slice(0, 8);

    const redeem = (memberName: string, prize: any) => {
      const cost = Number(prize.cost) || 0;
      if (pointsOf(memberName) < cost) return;
      add('rewards', {
        member: memberName,
        points: -cost,
        reason: `Eingelöst: ${prize.text}`,
      });
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Belohnungen" onBack={goBack} styles={styles} colors={colors} />

        {/* Punktestände mit schnellem +/- fürs Gutschreiben von Hand. */}
        <Text style={styles.groupLabel}>Punktestand</Text>
        {totals.length === 0 ? (
          <Text style={styles.hint}>
            Noch keine Familienmitglieder – unter Einstellungen → Benutzer anlegen.
          </Text>
        ) : null}
        {totals.map((member) => (
          <Card key={member.name} style={styles.rewardCard}>
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarSmallText}>
                {member.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkText}>{member.name}</Text>
              <Text style={styles.pointsBig}>{member.points} Punkte</Text>
            </View>
            {[1, 5, -1].map((step) => (
              <Pressable
                key={step}
                onPress={() => add('rewards', { member: member.name, points: step })}
                style={[styles.pointButton, step < 0 && styles.pointButtonMinus]}
              >
                <Text style={[styles.pointButtonText, step < 0 && { color: colors.ink }]}>
                  {step > 0 ? `+${step}` : step}
                </Text>
              </Pressable>
            ))}
          </Card>
        ))}

        {/* Prämien-Katalog: Ziele, für die sich das Sammeln lohnt. */}
        <Text style={styles.groupLabel}>Prämien zum Einlösen</Text>
        {catalog.length === 0 ? (
          <Text style={styles.hint}>
            Noch keine Prämien. Leg unten Ziele fest, z.B. «Kinobesuch = 50» oder
            «1 Std. länger aufbleiben = 20».
          </Text>
        ) : null}
        {catalog.map((prize) => (
          <Card key={prize.id} style={styles.pinCard}>
            <View style={styles.rewardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>{prize.text}</Text>
                <Text style={styles.checkSub}>{prize.cost} Punkte</Text>
              </View>
              <Pressable
                onPress={() => remove('rewards_catalog', prize.id)}
                style={styles.deleteTap}
                accessibilityLabel="Prämie löschen"
              >
                <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
              </Pressable>
            </View>
            {totals.length > 0 ? (
              <View style={styles.chipRow}>
                {totals.map((member) => {
                  const affordable = member.points >= (Number(prize.cost) || 0);
                  return (
                    <Pressable
                      key={member.name}
                      onPress={() => affordable && redeem(member.name, prize)}
                      disabled={!affordable}
                      style={[
                        styles.redeemChip,
                        affordable ? styles.redeemChipOk : styles.redeemChipOff,
                      ]}
                    >
                      <Ionicons
                        name={affordable ? 'gift' : 'lock-closed'}
                        size={13}
                        color={affordable ? '#FFFFFF' : colors.inkFaint}
                      />
                      <Text
                        style={[
                          styles.redeemChipText,
                          { color: affordable ? '#FFFFFF' : colors.inkFaint },
                        ]}
                      >
                        {member.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </Card>
        ))}
        <TwoFieldForm
          labels={['Prämie (z.B. Kinobesuch)', 'Punkte (z.B. 50)']}
          onAdd={(text, cost) => {
            const points = Number(String(cost).replace(',', '.'));
            add('rewards_catalog', {
              text,
              cost: Number.isFinite(points) && points > 0 ? Math.round(points) : 10,
            });
          }}
          styles={styles}
          colors={colors}
        />

        {/* Verlauf: was zuletzt gutgeschrieben oder eingelöst wurde. */}
        {recent.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Zuletzt</Text>
            <Card style={styles.listCard}>
              {recent.map((entry, index) => (
                <View key={entry.id ?? index} style={styles.eventRow}>
                  <Text style={[styles.checkText, { flex: 1 }]} numberOfLines={1}>
                    {entry.member}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </Text>
                  <Text
                    style={[
                      styles.rewardDelta,
                      { color: Number(entry.points) < 0 ? colors.danger : colors.on },
                    ]}
                  >
                    {Number(entry.points) > 0 ? `+${entry.points}` : entry.points}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </View>
    );
  }

  if (view === 'contacts') {
    const contacts: any[] = data.contacts ?? [];
    // Kontakte mit hinterlegtem Geburtstag – nach Nähe des nächsten sortiert.
    const upcoming = contacts
      .map((contact) => ({ contact, days: daysUntilBirthday(contact.birthday) }))
      .filter((entry) => entry.days != null)
      .sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
    return (
      <View style={styles.stack}>
        <BackHead title="Kontakte" onBack={goBack} styles={styles} colors={colors} />

        {upcoming.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Nächste Geburtstage</Text>
            <Card style={styles.listCard}>
              {upcoming.slice(0, 5).map(({ contact, days }) => (
                <View key={contact.id} style={styles.eventRow}>
                  <Ionicons
                    name="gift-outline"
                    size={18}
                    color={days === 0 ? colors.warn : colors.inkSoft}
                  />
                  <Text style={[styles.checkText, { flex: 1 }]} numberOfLines={1}>
                    {contact.text}
                  </Text>
                  <Text
                    style={[styles.checkSub, days === 0 && { color: colors.warn, fontWeight: '700' }]}
                  >
                    {birthdayLabel(contact.birthday)}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <Text style={styles.hint}>
          Foto antippen ändert das Bild – die ganze Karte antippen ruft an.
          Gross und mit Foto, damit auch die Kleinsten wissen, wer wer ist.
        </Text>
        {contacts.map((contact) => (
          <Card key={contact.id} style={styles.contactCard}>
            <Pressable
              onPress={async () => {
                const photo = await pickPhoto();
                if (photo) update('contacts', contact.id, { photo });
              }}
              accessibilityLabel={`Foto von ${contact.text} ändern`}
            >
              <ContactPhoto contact={contact} size={64} styles={styles} />
            </Pressable>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => Linking.openURL(`tel:${contact.phone}`)}
              accessibilityRole="button"
              accessibilityLabel={`${contact.text} anrufen`}
            >
              <Text style={styles.contactName}>{contact.text}</Text>
              <Text style={styles.checkSub}>{contact.phone}</Text>
              {birthdayLabel(contact.birthday) ? (
                <Text style={styles.checkSub}>🎂 {birthdayLabel(contact.birthday)}</Text>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(`tel:${contact.phone}`)}
              style={styles.callButton}
              accessibilityLabel={`${contact.text} anrufen`}
            >
              <Ionicons name="call" size={24} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => remove('contacts', contact.id)}
              style={styles.deleteTap}
              accessibilityRole="button"
              accessibilityLabel={`${contact.text} löschen`}
            >
              <Ionicons name="close" size={18} color={colors.inkFaint} />
            </Pressable>
          </Card>
        ))}
        <ContactForm
          onAdd={(text, phone, photo, birthday) =>
            add('contacts', {
              text,
              phone,
              ...(photo ? { photo } : {}),
              ...(birthday ? { birthday } : {}),
            })
          }
          styles={styles}
          colors={colors}
        />
      </View>
    );
  }

  if (view === 'routines') {
    return (
      <View style={styles.stack}>
        <BackHead title="Routinen" onBack={goBack} styles={styles} colors={colors} />
        <Text style={styles.hint}>
          Tagesabläufe als Checklisten – z.B. «Morgen» oder «Zubettgehen».
          Zurücksetzen macht alle Haken weg für den nächsten Tag.
        </Text>
        <GroupedChecklist
          items={data.routines ?? []}
          groupNoun="Routine"
          itemPlaceholder="Neuer Schritt …"
          onAdd={(group, text) => add('routines', { group, text, done: false })}
          onToggle={(item) => update('routines', item.id, { done: !item.done })}
          onDelete={(item) => remove('routines', item.id)}
          onResetGroup={(group) =>
            (data.routines ?? [])
              .filter((item) => item.group === group && item.done)
              .forEach((item) => update('routines', item.id, { done: false }))
          }
          onDeleteGroup={(group) =>
            (data.routines ?? [])
              .filter((item) => item.group === group)
              .forEach((item) => remove('routines', item.id))
          }
          styles={styles}
          colors={colors}
        />
      </View>
    );
  }

  if (view === 'packlists') {
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

  if (view === 'countdowns') {
    const countdowns: any[] = data.countdowns ?? [];
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

  if (view === 'recipes') {
    const meals: any[] = data.meals ?? [];
    return (
      <View style={[styles.stack, { flex: 1 }]}>
        <RecipeBook
          recipes={data.recipes ?? []}
          currentUser={currentUser}
          onAdd={(recipe) => add('recipes', recipe)}
          onUpdate={(id, patch) => update('recipes', id, patch)}
          onDelete={(id) => remove('recipes', id)}
          planMeal={(day, text, recipeId) => {
            const entry = meals.find((meal) => meal.day === day);
            // Die Kennung kommt direkt vom Rezeptbuch mit – nicht mehr
            // über den Namen gesucht. Zwei Rezepte «Lasagne», oder eines,
            // das später umbenannt wird, und die Namenssuche hätte die
            // Zutaten dem falschen (oder keinem) Rezept zugeordnet.
            const patch = { text, recipe_id: recipeId || null };
            if (entry) {
              update('meals', entry.id, patch);
            } else {
              add('meals', { day, ...patch });
            }
          }}
          onShopping={(recipe, faktor) => {
            // Mit dem Portionen-Faktor: Wer «8 statt 4» eingestellt hat,
            // bekam vorher die Mengen für vier – und merkte es nicht im
            // Laden, sondern beim Kochen.
            const neu = ingredientsToShopping(
              [recipe],
              (data.shopping ?? []).map((item: any) => String(item.text ?? '')),
              faktor
            );
            neu.forEach((eintrag) =>
              add('shopping', { ...eintrag, done: false })
            );
            return neu.length;
          }}
          onClose={goBack}
        />
      </View>
    );
  }

  if (view === 'documents') {
    const documents: any[] = data.documents ?? [];
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

  // ── Familien-Übersicht ─────────────────────────────────────────────────

  const modules: {
    key: ModuleKey;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    sub: string;
  }[] = [
    {
      key: 'woche',
      icon: 'grid-outline',
      label: 'Wochenplan',
      sub: 'Termine, Essen und Ämtli',
    },
    { key: 'kalender', icon: 'calendar-outline', label: 'Kalender', sub: todayCount > 0 ? `${todayCount} heute` : 'Keine Termine heute' },
    { key: 'tasks', icon: 'checkbox-outline', label: 'Aufgaben', sub: openTasks > 0 ? `${openTasks} offen` : 'Alles erledigt' },
    { key: 'shopping', icon: 'cart-outline', label: 'Einkaufsliste', sub: `${(data.shopping ?? []).filter((item) => !item.done).length} Einträge` },
    { key: 'meals', icon: 'restaurant-outline', label: 'Essensplaner', sub: 'Wochenplan' },
    { key: 'pins', icon: 'chatbox-outline', label: 'Pinnwand', sub: `${pinCount} ${pinCount === 1 ? 'Eintrag' : 'Einträge'}` },
    { key: 'chores', icon: 'repeat-outline', label: 'Ämtli', sub: choreSub },
    { key: 'rewards', icon: 'trophy-outline', label: 'Belohnungen', sub: 'Punkte sammeln' },
    { key: 'contacts', icon: 'call-outline', label: 'Kontakte', sub: 'Wichtige Nummern' },
    {
      key: 'emergency',
      icon: 'medkit-outline',
      label: 'Notfallblatt',
      sub: notfallSub,
    },
    {
      key: 'medications',
      icon: 'medical-outline',
      label: 'Medikamente',
      sub: medSub,
    },
    {
      key: 'babysitter',
      icon: 'happy-outline',
      label: 'Babysitter',
      sub: 'Alles Wichtige auf einer Seite',
    },
    { key: 'routines', icon: 'time-outline', label: 'Routinen', sub: 'Tagesabläufe' },
    { key: 'packlists', icon: 'briefcase-outline', label: 'Packlisten', sub: 'Ferien & Ausflüge' },
    { key: 'countdowns', icon: 'hourglass-outline', label: 'Countdowns', sub: 'Tage zählen' },
    { key: 'recipes', icon: 'book-outline', label: 'Rezeptbuch', sub: 'Familienrezepte' },
    { key: 'documents', icon: 'folder-open-outline', label: 'Dokumentsafe', sub: 'Wichtige Angaben' },
  ];

  // Selbst gezogene Reihenfolge anwenden; Unbekanntes bleibt an seinem
  // gewachsenen Platz hinten.
  const moduleRank = new Map((moduleOrder ?? []).map((key, index) => [key, index]));
  const orderedModules = [...modules].sort((a, b) => {
    const ai = moduleRank.has(a.key) ? (moduleRank.get(a.key) as number) : Infinity;
    const bi = moduleRank.has(b.key) ? (moduleRank.get(b.key) as number) : Infinity;
    return ai !== bi ? ai - bi : modules.indexOf(a) - modules.indexOf(b);
  });

  return (
    <View style={styles.stack}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Familie</Text>
        {onReorderModules ? (
          <Pressable
            onPress={() => setReorderOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Reihenfolge der Module ändern"
            style={({ pressed }) => [styles.reorderButton, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="swap-vertical" size={16} color={colors.onGradient} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Tagesüberblick */}
      <Card style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{todayCount}</Text>
          <Text style={styles.summaryLabel}>Termine heute</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{openTasks}</Text>
          <Text style={styles.summaryLabel}>Aufgaben offen</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{pinCount}</Text>
          <Text style={styles.summaryLabel}>Pins</Text>
        </View>
      </Card>

      {/* Mitglieder */}
      <View style={styles.memberRow}>
        {members.map((member) => {
          const presence = presenceOf(member.name);
          return (
            <View key={member.name} style={styles.member}>
              <View
                style={[
                  styles.avatar,
                  presence === 'home' && { borderColor: colors.on, borderWidth: 3 },
                ]}
              >
                <Text style={styles.avatarText}>
                  {member.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.memberName} numberOfLines={1}>
                {member.name}
              </Text>
              <Text style={styles.memberRole}>
                {presence === 'home'
                  ? 'Zuhause'
                  : presence === 'away'
                    ? 'Unterwegs'
                    : ROLE_LABELS[member.role] ?? member.role}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Module */}
      <View style={styles.tileRow}>
        {orderedModules.map((module) => (
          <Card key={module.key} style={styles.moduleTile} onPress={() => setView(module.key)}>
            <Ionicons name={module.icon} size={24} color={colors.accent} />
            <Text style={styles.moduleLabel}>{module.label}</Text>
            <Text style={styles.moduleSub} numberOfLines={1}>
              {module.sub}
            </Text>
          </Card>
        ))}
      </View>

      <Modal
        visible={reorderOpen}
        animationType="slide"
        onRequestClose={() => setReorderOpen(false)}
      >
        <View style={styles.reorderSheet}>
          <View style={styles.reorderHead}>
            <Text style={styles.viewTitle}>Reihenfolge</Text>
            <Pressable onPress={() => setReorderOpen(false)} accessibilityLabel="Fertig">
              <Ionicons name="checkmark" size={26} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={styles.reorderHint}>
            Am Griff ☰ ziehen, um die Modul-Kacheln umzusortieren. Die
            Reihenfolge wird bei deinem Benutzer gespeichert und gilt auf
            allen deinen Geräten.
          </Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <DraggableList
              items={orderedModules.map((module) => ({
                id: module.key,
                name: module.label,
              }))}
              onReorder={(keys) => onReorderModules?.(keys)}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reorderButton: {
      padding: 8,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    reorderSheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60, gap: 10 },
    reorderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reorderHint: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    hint: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17 },

    backHead: { gap: 4 },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingRight: 10,
    },
    backText: { color: colors.onGradient, fontSize: 15, fontWeight: '600' },
    viewTitle: { color: colors.onGradient, fontSize: 22, fontWeight: '700' },

    summaryCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
    },
    summaryItem: { flex: 1, alignItems: 'center', gap: 2 },
    summaryNumber: { color: colors.ink, fontSize: 26, fontWeight: '700' },
    summaryLabel: { color: colors.inkSoft, fontSize: 12 },
    summaryDivider: { width: 1, height: 34, backgroundColor: colors.surfaceBorder },

    memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
    member: { alignItems: 'center', gap: 4, width: 84 },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
    avatarSmall: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarSmallText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    memberName: { color: colors.onGradient, fontSize: 13, fontWeight: '700' },
    memberRole: { color: colors.onGradientSoft, fontSize: 11 },

    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
    moduleTile: { minHeight: 0, width: '48%', flexGrow: 1, maxWidth: 260, gap: 6 },
    moduleLabel: { color: colors.ink, fontSize: 16, fontWeight: '700' },
    moduleSub: { color: colors.inkSoft, fontSize: 12 },

    listCard: { minHeight: 0, gap: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center' },
    checkTap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    checkText: { color: colors.ink, fontSize: 15, fontWeight: '500' },
    checkTextDone: { textDecorationLine: 'line-through', color: colors.inkFaint },
    checkSub: { color: colors.inkSoft, fontSize: 12 },
    deleteTap: { padding: 8 },

    addRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    addButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addWide: {
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 12,
      alignItems: 'center',
    },
    addWideText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    formCard: { gap: 8 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    toggleLabel: { color: colors.ink, fontSize: 15 },
    clearButton: { alignItems: 'center', paddingVertical: 8 },
    resetText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    mealShopButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 13,
    },
    weekHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    weekRowItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pollRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: radius.control,
    },
    pollRowMine: { backgroundColor: colors.surfaceSoft },
    choreButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
    choreDone: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.on,
    },
    choreDoneText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    choreSkip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    choreSkipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    formHintSmall: { color: colors.inkFaint, fontSize: 12 },
    stapleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    staple: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    stapleText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    mealNameButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    mealNameText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    mealShopText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    confirmRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    confirmOk: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.on,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmNo: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.onGradientSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    groupTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },

    eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
    calHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
    calTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calWeekday: {
      width: `${100 / 7}%`,
      textAlign: 'center',
      color: colors.inkFaint,
      fontSize: 12,
      fontWeight: '700',
      paddingBottom: 4,
    },
    calCell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.control,
    },
    calCellToday: { borderWidth: 1, borderColor: colors.accent },
    calCellSelected: { backgroundColor: colors.surfaceStrong },
    calDay: { color: colors.inkSoft, fontSize: 15 },
    calDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.accent,
      marginTop: 2,
    },

    pinCard: { minHeight: 0, gap: 8 },
    pinFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    rewardCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    pointButton: {
      minWidth: 40,
      paddingVertical: 8,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
      alignItems: 'center',
    },
    pointButtonMinus: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    pointButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    pointsBig: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    groupLabel: {
      color: colors.onGradientSoft,
      fontSize: 13,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
    },
    rewardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    redeemChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radius.pill,
    },
    redeemChipOk: { backgroundColor: colors.accent },
    redeemChipOff: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    redeemChipText: { fontSize: 13, fontWeight: '700' },
    rewardDelta: { fontSize: 15, fontWeight: '800' },

    daysBubble: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    daysNumber: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    daysLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 9 },

    mealRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    mealDay: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', width: 28 },
    mealEmpty: { color: colors.inkFaint, fontSize: 14 },

    contactCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    contactName: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    contactInitial: {
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactInitialText: { color: '#FFFFFF', fontWeight: '700' },
    contactFormRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    contactFormPhoto: { width: 72, height: 72, borderRadius: 36 },
    contactPhotoEmpty: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    callButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.on,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
