import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Entity, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, useColors } from '../theme';
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
  | 'documents';

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
  onToggle,
  onDelete,
  styles,
  colors,
}: {
  item: any;
  sub?: string;
  onToggle: () => void;
  onDelete: () => void;
  styles: Styles;
  colors: Colors;
}) {
  return (
    <View style={styles.checkRow}>
      <Pressable
        onPress={onToggle}
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
          {sub ? <Text style={styles.checkSub}>{sub}</Text> : null}
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
  styles: Styles;
  colors: Colors;
}) {
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
function TaskAddRow({
  members,
  onAdd,
  styles,
  colors,
}: {
  members: Member[];
  onAdd: (text: string, member: string | null, points: number) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [member, setMember] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), member, points);
    setText('');
    setMember(null);
    setPoints(0);
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
  onAdd: (text: string, phone: string, photo: string | null) => void;
  styles: Styles;
  colors: Colors;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
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
        </View>
      </View>
      <Pressable
        onPress={() => {
          if (!name.trim() || !phone.trim()) return;
          onAdd(name.trim(), phone.trim(), photo);
          setName('');
          setPhone('');
          setPhoto(null);
        }}
        style={styles.addWide}
      >
        <Text style={styles.addWideText}>Hinzufügen</Text>
      </Pressable>
    </View>
  );
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

/** Rezept: Titel antippen klappt die Zubereitung auf. */
function RecipeCard({
  recipe,
  onDelete,
  styles,
  colors,
}: {
  recipe: any;
  onDelete: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={styles.pinCard}>
      <View style={styles.recipeHead}>
        <Pressable
          onPress={() => setOpen((value) => !value)}
          style={[styles.recipeHead, { flex: 1 }]}
        >
          <Ionicons
            name={open ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.inkSoft}
          />
          <Text style={[styles.checkText, { flex: 1 }]}>{recipe.text}</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={styles.deleteTap}>
          <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
        </Pressable>
      </View>
      {open && recipe.body ? (
        <Text selectable style={styles.recipeBody}>
          {recipe.body}
        </Text>
      ) : null}
    </Card>
  );
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────

export function FamilyScreen({ settings, entities, currentUser }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${settings.token}` }),
    [settings.token]
  );

  const [data, setData] = useState<FamilyData>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<ModuleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const toggleTask = (task: any) => {
      // Beim ersten Abhaken einer Aufgabe mit Person und Punkten wird der
      // Punktestand automatisch gutgeschrieben (genau einmal).
      if (!task.done && task.member && Number(task.points) > 0 && !task.rewarded) {
        add('rewards', {
          member: task.member,
          points: Number(task.points),
          reason: task.text,
        });
        update('tasks', task.id, { done: true, rewarded: true });
      } else {
        update('tasks', task.id, { done: !task.done });
      }
    };
    const taskSub = (task: any) => {
      const parts = [];
      if (task.member) parts.push(`für ${task.member}`);
      if (Number(task.points) > 0) parts.push(`${task.points} Punkte`);
      if (task.author) parts.push(`von ${task.author}`);
      return parts.join(' · ') || undefined;
    };
    return (
      <View style={styles.stack}>
        <BackHead title="Aufgaben" onBack={goBack} styles={styles} colors={colors} />
        <Card style={styles.listCard}>
          {tasks.map((task) => (
            <CheckRow
              key={task.id}
              item={task}
              sub={taskSub(task)}
              onToggle={() => toggleTask(task)}
              onDelete={() => remove('tasks', task.id)}
              styles={styles}
              colors={colors}
            />
          ))}
          <TaskAddRow
            members={members}
            onAdd={(text, member, points) =>
              add('tasks', { text, done: false, member, points })
            }
            styles={styles}
            colors={colors}
          />
        </Card>
        <Text style={styles.hint}>
          Person und Punkte antippen ist freiwillig – beim Abhaken werden die
          Punkte unter Belohnungen gutgeschrieben.
        </Text>
      </View>
    );
  }

  if (view === 'shopping') {
    const items: any[] = data.shopping ?? [];
    const done = items.filter((item) => item.done);
    return (
      <View style={styles.stack}>
        <BackHead title="Einkaufsliste" onBack={goBack} styles={styles} colors={colors} />
        <Card style={styles.listCard}>
          {items.map((item) => (
            <CheckRow
              key={item.id}
              item={item}
              onToggle={() => update('shopping', item.id, { done: !item.done })}
              onDelete={() => remove('shopping', item.id)}
              styles={styles}
              colors={colors}
            />
          ))}
          <AddRow
            placeholder="Was fehlt? …"
            onAdd={(text) => add('shopping', { text, done: false })}
            styles={styles}
            colors={colors}
          />
          {done.length > 0 ? (
            <Pressable
              onPress={() => done.forEach((item) => remove('shopping', item.id))}
              style={styles.clearButton}
            >
              <Text style={styles.resetText}>{done.length} Erledigte entfernen</Text>
            </Pressable>
          ) : null}
        </Card>
      </View>
    );
  }

  if (view === 'meals') {
    const meals: any[] = data.meals ?? [];
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
                    text ? update('meals', entry.id, { text }) : remove('meals', entry.id);
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
      </View>
    );
  }

  if (view === 'pins') {
    const pins: any[] = data.pins ?? [];
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
                <Pressable onPress={() => remove('pins', pin.id)} style={styles.deleteTap}>
                  <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
                </Pressable>
              </View>
            </Card>
          ))}
      </View>
    );
  }

  if (view === 'rewards') {
    const log: any[] = data.rewards ?? [];
    const totals = members.map((member) => ({
      ...member,
      points: log
        .filter((entry) => entry.member === member.name)
        .reduce((sum, entry) => sum + Number(entry.points ?? 0), 0),
    }));
    return (
      <View style={styles.stack}>
        <BackHead title="Belohnungen" onBack={goBack} styles={styles} colors={colors} />
        {totals.map((member) => (
          <Card key={member.name} style={styles.rewardCard}>
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarSmallText}>
                {member.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkText}>{member.name}</Text>
              <Text style={styles.checkSub}>{member.points} Punkte</Text>
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
      </View>
    );
  }

  if (view === 'contacts') {
    const contacts: any[] = data.contacts ?? [];
    return (
      <View style={styles.stack}>
        <BackHead title="Kontakte" onBack={goBack} styles={styles} colors={colors} />
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
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(`tel:${contact.phone}`)}
              style={styles.callButton}
              accessibilityLabel={`${contact.text} anrufen`}
            >
              <Ionicons name="call" size={24} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => remove('contacts', contact.id)} style={styles.deleteTap}>
              <Ionicons name="close" size={18} color={colors.inkFaint} />
            </Pressable>
          </Card>
        ))}
        <ContactForm
          onAdd={(text, phone, photo) =>
            add('contacts', photo ? { text, phone, photo } : { text, phone })
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
                onPress={() => remove('countdowns', countdown.id)}
                style={styles.deleteTap}
              >
                <Ionicons name="close" size={18} color={colors.inkFaint} />
              </Pressable>
            </Card>
          );
        })}
        <TwoFieldForm
          labels={['Anlass (z.B. Ferien)', 'Datum (TT.MM.JJJJ)']}
          onAdd={(text, date) => add('countdowns', { text, date })}
          styles={styles}
          colors={colors}
        />
      </View>
    );
  }

  if (view === 'recipes') {
    const recipes: any[] = data.recipes ?? [];
    return (
      <View style={styles.stack}>
        <BackHead title="Rezeptbuch" onBack={goBack} styles={styles} colors={colors} />
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onDelete={() => remove('recipes', recipe.id)}
            styles={styles}
            colors={colors}
          />
        ))}
        <TwoFieldForm
          labels={['Gericht', 'Zutaten / Zubereitung']}
          multilineSecond
          onAdd={(text, body) => add('recipes', { text, body })}
          styles={styles}
          colors={colors}
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
    { key: 'kalender', icon: 'calendar-outline', label: 'Kalender', sub: todayCount > 0 ? `${todayCount} heute` : 'Keine Termine heute' },
    { key: 'tasks', icon: 'checkbox-outline', label: 'Aufgaben', sub: openTasks > 0 ? `${openTasks} offen` : 'Alles erledigt' },
    { key: 'shopping', icon: 'cart-outline', label: 'Einkaufsliste', sub: `${(data.shopping ?? []).filter((item) => !item.done).length} Einträge` },
    { key: 'meals', icon: 'restaurant-outline', label: 'Essensplaner', sub: 'Wochenplan' },
    { key: 'pins', icon: 'chatbox-outline', label: 'Pinnwand', sub: `${pinCount} ${pinCount === 1 ? 'Eintrag' : 'Einträge'}` },
    { key: 'rewards', icon: 'trophy-outline', label: 'Belohnungen', sub: 'Punkte sammeln' },
    { key: 'contacts', icon: 'call-outline', label: 'Kontakte', sub: 'Wichtige Nummern' },
    { key: 'routines', icon: 'time-outline', label: 'Routinen', sub: 'Tagesabläufe' },
    { key: 'packlists', icon: 'briefcase-outline', label: 'Packlisten', sub: 'Ferien & Ausflüge' },
    { key: 'countdowns', icon: 'hourglass-outline', label: 'Countdowns', sub: 'Tage zählen' },
    { key: 'recipes', icon: 'book-outline', label: 'Rezeptbuch', sub: 'Familienrezepte' },
    { key: 'documents', icon: 'folder-open-outline', label: 'Dokumentsafe', sub: 'Wichtige Angaben' },
  ];

  return (
    <View style={styles.stack}>
      <Text style={styles.title}>Familie</Text>
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
        {modules.map((module) => (
          <Card key={module.key} style={styles.moduleTile} onPress={() => setView(module.key)}>
            <Ionicons name={module.icon} size={24} color={colors.accent} />
            <Text style={styles.moduleLabel}>{module.label}</Text>
            <Text style={styles.moduleSub} numberOfLines={1}>
              {module.sub}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
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
    clearButton: { alignItems: 'center', paddingVertical: 8 },
    resetText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

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
    recipeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    recipeBody: { color: colors.inkSoft, fontSize: 14, lineHeight: 20, paddingLeft: 24 },
  });
