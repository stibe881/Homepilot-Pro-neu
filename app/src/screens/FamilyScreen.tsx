import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { Card } from '../components/Card';
import { DraggableList } from '../components/DraggableList';
import { Shops } from '../components/Shops';
import { useColors } from '../theme';
import { RecipeBook } from './RecipeBook';
import { wochentagDatumKurz, wochentagUhr } from '../lib/format';
import { Shop, ingredientsToShopping, shopCategory } from '../lib/einkauf';
import {
  ABEND_FELDER,
  KALENDER_FARBEN,
  NOTRUFE,
  ROLLEN,
  NOTFALL_FELDER,
  fuerBabysitter,
  geprueftVor,
  gabenVon,
  genommenMap,
  hakeGabe,
  isoTag,
  kurzDatum,
  kurFertig,
  medZeile,
  mitRolle,
  montagVon,
  notfallText,
  notfallUeberfaellig,
  notfallZeilen,
  nummernVon,
  offeneGaben,
  plusWochen,
  rollenVon,
  waehlbar,
} from '../lib/familie';
import { tapped } from '../lib/haptics';
import { kochVorschlaege, vorschlagsGrund, wuerfel } from '../lib/vorschlag';
import { ROLE_LABELS } from './UsersScreen';
import { AddRow, BackHead, CheckRow, ChoreAddRow, ContactForm, ContactPhoto, CountdownForm, EventForm, FamilyData, FamilyItem, GroupedChecklist, MealRow, MedicationAddRow, Member, ModuleKey, MonthCalendar, PollAddRow, Props, REPEAT_OPTIONS, SHOP_CATEGORIES, ShoppingAddRow, TaskAddRow, TwoFieldForm, WEEK_DAYS, birthdayLabel, daysUntilBirthday, dueInfo, isoInDays, nextDue, parseSwissDate, pickPhoto, rotateMember } from './family/bausteine';
import { makeStyles } from './family/stil';

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


export function FamilyScreen({
  settings,
  entities,
  currentUser,
  moduleOrder,
  onReorderModules,
  changedAt,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<FamilyData>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<ModuleKey | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calMode, setCalMode] = useState<'list' | 'month'>('list');
  // Kontakte: nach Rolle filtern und einzelne bearbeiten.
  const [kontaktRolle, setKontaktRolle] = useState<string>('alle');
  const [kontaktBearbeitet, setKontaktBearbeitet] = useState<string | null>(null);
  // Notfallblatt: welcher Eintrag gerade ausgefüllt wird.
  const [notfallOffen, setNotfallOffen] = useState<string | null>(null);
  // Medikamente: welcher Verlauf gerade aufgeklappt ist.
  const [medVerlauf, setMedVerlauf] = useState<string | null>(null);
  // Wochenplan: welche Woche, und wessen Zeilen.
  const [wochenVersatz, setWochenVersatz] = useState(0);
  const [wochenPerson, setWochenPerson] = useState('Alle');
  // Kalender: die Termine des gezeigten Monats (die Entität trägt nur
  // die nächsten zwölf), plus der Termin, den man gerade angetippt hat.
  const [monatEvents, setMonatEvents] = useState<FamilyItem[] | null>(null);
  const [monatLaedt, setMonatLaedt] = useState(false);
  const [letzterMonat, setLetzterMonat] = useState('');
  const [terminOffen, setTerminOffen] = useState<FamilyItem | null>(null);
  // Vom Essensplaner direkt ins Rezept springen (Punkt 146).
  const [rezeptStart, setRezeptStart] = useState<string | null>(null);
  // «Was koche ich heute?» im Planer (Punkt 139): Die Saat hält die
  // Vorschläge stehen, bis jemand würfelt - sonst mischte jedes
  // Live-Update vom Hub die Liste um.
  const [essWurf, setEssWurf] = useState(1);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Der Bildschirm zeigt Fehler selbst an - deshalb «still».
    hub
      .get<FamilyData>('/api/family', { still: true })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err) =>
        setError(
          `Familiendaten nicht abrufbar (${err instanceof HubFehler ? err.message : err})`
        )
      );
  }, [hub]);

  useEffect(load, [load]);

  /**
   * Die Termine eines Monats holen.
   *
   * Der Zustand der Kalender-Entität trägt die nächsten zwölf Termine -
   * für die Kachel richtig, fürs Monatsraster zu wenig. Wer einen Monat
   * zurückblätterte, sah ein leeres Raster und musste glauben, es sei
   * nichts gewesen.
   */
  const ladeMonat = useCallback(
    (monat: string) => {
      if (!monat) return;
      setLetzterMonat(monat);
      setMonatLaedt(true);
      hub
        .get<{ events: FamilyItem[] }>(`/api/calendar/events?month=${monat}`, {
          still: true,
        })
        .then((payload) => setMonatEvents(payload.events ?? []))
        // Ohne Kalender-Anbindung gibt es hier nichts zu holen - dann
        // bleibt das Raster bei dem, was die Entität hergibt.
        .catch(() => setMonatEvents(null))
        .finally(() => setMonatLaedt(false));
    },
    [hub]
  );

  // Änderungen anderer Geräte kommen als Fingerzeig über den WebSocket –
  // was Livia abhakt, steht bei Stefan sofort, ohne Minutentakt-Abfrage.
  useEffect(() => {
    if (changedAt) load();
  }, [changedAt, load]);

  useEffect(() => {
    hub
      .get<Member[] | null>('/api/users', { fallback: null, still: true })
      .then((rows) =>
        setMembers(
          rows ?? (currentUser ? [{ name: currentUser.name, role: currentUser.role }] : [])
        )
      );
  }, [hub, currentUser]);

  // ── Änderungen an den Hub ──────────────────────────────────────────────

  const add = useCallback(
    async (collection: string, item: FamilyItem) => {
      try {
        await hub.post(`/api/family/${collection}`, item, { still: true });
        load();
      } catch (err) {
        setError(
          `Speichern fehlgeschlagen (${err instanceof Error ? err.message : err})`
        );
      }
    },
    [hub, load]
  );

  const update = useCallback(
    async (collection: string, id: string, patch: FamilyItem) => {
      try {
        // Scheitert es, zeigt load() im finally den echten Stand - und
        // die Einblendung des Clients sagt, warum.
        await hub.put(`/api/family/${collection}/${id}`, patch, { fallback: null });
      } finally {
        load();
      }
    },
    [hub, load]
  );

  const remove = useCallback(
    async (collection: string, id: string) => {
      try {
        await hub.del(`/api/family/${collection}/${id}`, { fallback: null });
      } finally {
        load();
      }
    },
    [hub, load]
  );

  // ── Abgeleitete Werte ──────────────────────────────────────────────────

  const calendar = entities.find((entity) => entity.kind === 'calendar');
  const events: FamilyItem[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  const today = new Date();
  const isToday = (value: unknown) => {
    const date = new Date(value as string);
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
  const chores: FamilyItem[] = data.chores ?? [];
  const meineChores = chores.filter(
    (chore: FamilyItem) => chore.member && chore.member === currentUser?.name
  );
  const notfall: FamilyItem[] = data.emergency ?? [];
  const notfallSub =
    notfall.length > 0 ? `${notfall.length} Einträge` : 'Noch nichts hinterlegt';
  const meds: FamilyItem[] = data.medications ?? [];
  const offeneMeds = meds.filter((med: FamilyItem) => !med.done).length;
  const medSub = offeneMeds > 0 ? `${offeneMeds} laufend` : 'Nichts einzunehmen';
  const choreSub =
    chores.length === 0
      ? 'Reihe festlegen'
      : meineChores.length > 0
        ? `${meineChores.length} bei dir`
        : `${chores.length} in der Reihe`;

  const eventWhen = (event: FamilyItem) =>
    event.all_day
      ? wochentagDatumKurz(new Date(event.start))
      : wochentagUhr(new Date(event.start));

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
    // Im Monatsraster die Termine des gezeigten Monats, in der Liste die
    // anstehenden aus dem Zustand der Entität.
    const rasterEvents = monatEvents ?? events;
    // Mehrere Kalender: Ohne Unterscheidung sieht man nicht, wessen
    // Termin es ist. Die Reihenfolge der Kalender ist die Farbe.
    const kalenderListe: string[] = Array.isArray(calendar?.state.calendars)
      ? calendar!.state.calendars.map(String)
      : [];
    const farbeVon = (event: FamilyItem) => {
      const index = kalenderListe.indexOf(String(event.calendar ?? ''));
      return index < 0 ? colors.accent : KALENDER_FARBEN[index % KALENDER_FARBEN.length];
    };

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
          <MonthCalendar
            events={rasterEvents}
            laedt={monatLaedt}
            onMonat={ladeMonat}
            onEvent={(event) => setTerminOffen(event)}
            styles={styles}
            colors={colors}
          />
        ) : (
          <Card style={styles.listCard}>
            {upcoming.length > 0 ? (
              upcoming.map((event, index) => (
                <Pressable
                  key={index}
                  onPress={() => (event.birthday ? undefined : setTerminOffen(event))}
                  disabled={!!event.birthday}
                  style={styles.eventRow}
                >
                  <View style={[styles.eventDot, { backgroundColor: farbeVon(event) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkText} numberOfLines={1}>
                      {event.summary ?? '—'}
                    </Text>
                    {event.location ? (
                      <Pressable
                        onPress={() =>
                          Linking.openURL(
                            `https://maps.google.com/?q=${encodeURIComponent(
                              String(event.location)
                            )}`
                          )
                        }
                        accessibilityRole="link"
                        accessibilityLabel={`Karte für ${event.location}`}
                      >
                        <Text style={[styles.checkSub, { color: colors.accent }]}>
                          {event.location}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={styles.checkSub}>{eventWhen(event)}</Text>
                </Pressable>
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

        {kalenderListe.length > 1 ? (
          <View style={styles.chipRow}>
            {kalenderListe.map((id, index) => (
              <View key={id} style={styles.chip}>
                <View
                  style={[
                    styles.eventDot,
                    { backgroundColor: KALENDER_FARBEN[index % KALENDER_FARBEN.length] },
                  ]}
                />
                <Text style={styles.chipText} numberOfLines={1}>
                  {id === 'primary' ? 'Hauptkalender' : id.split('@')[0]}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {calendar && calendar.commands.includes('create_event') ? (
          <EventForm
            onAdd={async (summary, date, time) => {
              try {
                await hub.post(
                  `/api/entities/${encodeURIComponent(calendar.id)}/command`,
                  { command: 'create_event', data: { summary, date, time } },
                  { still: true }
                );
                if (calMode === 'month') ladeMonat(letzterMonat);
              } catch (err) {
                setError(
                  `Termin nicht angelegt (${err instanceof Error ? err.message : err})`
                );
              }
            }}
            styles={styles}
            colors={colors}
          />
        ) : null}

        {/* Ändern und Löschen gab es bisher gar nicht – anlegen schon.
            Ein Kalender, aus dem man nichts wieder herausbekommt, ist
            eine Sackgasse. */}
        <Modal
          visible={!!terminOffen}
          transparent
          animationType="fade"
          onRequestClose={() => setTerminOffen(null)}
        >
          <Pressable style={styles.modalBack} onPress={() => setTerminOffen(null)}>
            <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
              <Text style={styles.groupTitle}>{terminOffen?.summary}</Text>
              <Text style={styles.checkSub}>
                {terminOffen ? eventWhen(terminOffen) : ''}
                {terminOffen?.location ? ` · ${terminOffen.location}` : ''}
              </Text>
              {calendar && calendar.commands.includes('delete_event') ? (
                <Pressable
                  onPress={async () => {
                    const ziel = terminOffen;
                    setTerminOffen(null);
                    if (!ziel) return;
                    try {
                      await hub.post(
                        `/api/entities/${encodeURIComponent(calendar.id)}/command`,
                        {
                          command: 'delete_event',
                          data: { id: ziel.id, calendar: ziel.calendar },
                        },
                        { still: true }
                      );
                      if (calMode === 'month') ladeMonat(letzterMonat);
                    } catch (err) {
                      setError(
                        `Termin nicht gelöscht (${err instanceof Error ? err.message : err})`
                      );
                    }
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={[styles.addRowText, { color: colors.danger }]}>
                    Termin löschen
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setTerminOffen(null)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="close" size={16} color={colors.inkSoft} />
                <Text style={[styles.addRowText, { color: colors.inkSoft }]}>
                  Schliessen
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  if (view === 'tasks') {
    const tasks: FamilyItem[] = data.tasks ?? [];
    // Eltern (Besitzer/Bewohner) dürfen Punkte bestätigen; Kinder/Gäste nicht.
    const isParent =
      currentUser?.role === 'besitzer' || currentUser?.role === 'bewohner';
    const pending = tasks.filter((task) => task.pending_reward);

    const toggleTask = (task: FamilyItem) => {
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
    const confirmReward = (task: FamilyItem) => {
      add('rewards', {
        member: task.member,
        points: Number(task.points),
        reason: task.text,
      });
      update('tasks', task.id, { rewarded: true, pending_reward: false });
    };
    const rejectReward = (task: FamilyItem) =>
      update('tasks', task.id, { pending_reward: false, done: false });

    const taskSub = (task: FamilyItem) => {
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
    const items: FamilyItem[] = data.shopping ?? [];
    const done = items.filter((item) => item.done);
    // Nach Kategorie gruppieren, in der Ladenrundgang-Reihenfolge. Einträge
    // ohne Kategorie (alt oder aus dem Essensplan) landen unter «Sonstiges».
    const catOf = (item: FamilyItem) =>
      SHOP_CATEGORIES.includes(item.category) ? item.category : 'Sonstiges';
    const usedCats = SHOP_CATEGORIES.filter((cat) =>
      items.some((item) => catOf(item) === cat)
    );
    // Standardartikel: was jede Woche in den Wagen wandert. Ein Tipp
    // legt sie an, statt sie jedes Mal zu tippen - und wer sie einmal
    // von Hand einträgt, kann sie danach als Standard merken.
    const staples: FamilyItem[] = data.staples ?? [];
    const aufListe = new Set(
      items.map((item: FamilyItem) => String(item.text ?? '').trim().toLowerCase())
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
              {staples.map((staple: FamilyItem) => {
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
                      (staple: FamilyItem) =>
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
          shops={(data.shops ?? []) as unknown as Shop[]}
          onAdd={(shop) => add('shops', shop)}
          onUpdate={(id, changes) => update('shops', id, changes)}
          onRemove={(id) => remove('shops', id)}
        />
      </View>
    );
  }

  if (view === 'meals') {
    const meals: FamilyItem[] = data.meals ?? [];
    const planned = meals.filter((meal) => String(meal.text ?? '').trim());
    // Alle geplanten Gerichte auf die Einkaufsliste – jedes als ein Eintrag,
    // Doppelte überspringen. Kategorie «Sonstiges», dort lässt es sich ordnen.
    const recipes: FamilyItem[] = data.recipes ?? [];
    // Zu welchen Gerichten kennen wir das Rezept? Nur bei denen lassen
    // sich Zutaten holen; für den Rest bleibt der Name des Gerichts, den
    // man dann von Hand ergänzt.
    const geplanteRezepte = planned
      .map((meal: FamilyItem) =>
        recipes.find(
          (recipe) =>
            recipe.id === meal.recipe_id ||
            String(recipe.text ?? '') === String(meal.text ?? '')
        )
      )
      .filter(Boolean);

    const vorhanden = () =>
      (data.shopping ?? []).map((item: FamilyItem) => String(item.text ?? ''));

    /** Zutaten aller geplanten Rezepte - der eigentliche Wocheneinkauf.
     *
     *  Je Rezept mit seinem eigenen Portionen-Faktor (Punkt 145): Der
     *  Samstag mit Besuch braucht die doppelten Mengen, der Montag die
     *  normalen - über einen Kamm geschoren stimmte beides nicht. */
    const zutatenEinkauf = () => {
      const rezepteMitTag = planned
        .map((meal) => ({
          meal,
          recipe: recipes.find(
            (recipe) =>
              recipe.id === meal.recipe_id ||
              String(recipe.text ?? '') === String(meal.text ?? '')
          ),
        }))
        .filter((paar) => paar.recipe);
      const faktoren = rezepteMitTag.map(({ meal, recipe }) => {
        const basis = Number(recipe?.servings) || 0;
        const geplant = Number(meal.servings) || 0;
        return basis > 0 && geplant > 0 ? geplant / basis : 1;
      });
      const neu = ingredientsToShopping(
        rezepteMitTag.map((paar) => paar.recipe) as FamilyItem[],
        vorhanden(),
        faktoren
      );
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
    // Montag ist 0 - getDay() zählt ab Sonntag.
    const heuteName = WEEK_DAYS[(new Date().getDay() + 6) % 7];
    const vorschlaege = kochVorschlaege(recipes, 3, new Date().toISOString().slice(0, 10), wuerfel(essWurf));
    const oeffneRezept = (id: string) => {
      setRezeptStart(id);
      setView('recipes');
    };
    return (
      <View style={styles.stack}>
        <BackHead title="Essensplaner" onBack={goBack} styles={styles} colors={colors} />
        <Card style={styles.listCard}>
          {WEEK_DAYS.map((day) => {
            const entry = meals.find((meal) => meal.day === day);
            // Die Kachel gibt es nur mit hinterlegtem Rezept (Punkt 146)
            // - sonst bleibt die Zeile das schlichte Textfeld.
            const rezept = entry
              ? recipes.find(
                  (recipe) =>
                    recipe.id === entry.recipe_id ||
                    (entry.recipe_id == null &&
                      String(recipe.text ?? '') === String(entry.text ?? ''))
                )
              : undefined;
            return (
              <MealRow
                key={day}
                day={day}
                entry={entry}
                rezept={rezept}
                heute={day === heuteName}
                onOpenRezept={rezept ? () => oeffneRezept(String(rezept.id)) : undefined}
                onSave={(text) => {
                  if (entry) {
                    if (text) {
                      // Von Hand umgetippt: Die alte Rezept-Verknüpfung
                      // (und ihre Portionen) gälte sonst fürs neue Gericht.
                      update('meals', entry.id, { text, recipe_id: null, servings: null });
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
        {vorschlaege.length > 0 ? (
          <Card style={styles.listCard}>
            <View style={styles.vorschlagKopf}>
              <Text style={styles.groupTitle}>Was koche ich heute?</Text>
              <Pressable
                onPress={() => setEssWurf((zahl) => zahl + 1)}
                accessibilityRole="button"
                style={styles.vorschlagWurf}
              >
                <Ionicons name="refresh" size={15} color={colors.accent} />
                <Text style={styles.vorschlagWurfText}>Nochmal würfeln</Text>
              </Pressable>
            </View>
            {vorschlaege.map((recipe) => (
              <Pressable
                key={String(recipe.id)}
                onPress={() => oeffneRezept(String(recipe.id))}
                accessibilityRole="button"
                style={styles.vorschlagZeile}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.vorschlagName} numberOfLines={1}>
                    {String(recipe.text ?? '')}
                  </Text>
                  <Text style={styles.vorschlagGrund}>
                    {vorschlagsGrund(recipe, new Date().toISOString().slice(0, 10))}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
              </Pressable>
            ))}
          </Card>
        ) : null}
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
    const pins: FamilyItem[] = data.pins ?? [];
    const polls: FamilyItem[] = data.polls ?? [];
    const ich = currentUser?.name ?? '';

    /** Eine Stimme abgeben oder zurückziehen.
     *
     * Die Stimmen stehen als {Person: Antwort} am Eintrag - so sieht man,
     * wer noch fehlt. Genau das ist der Punkt gegenüber fünf Antworten im
     * Familienchat, bei denen niemand mehr weiss, wer sich gemeldet hat. */
    const stimmen = (poll: FamilyItem, antwort: string) => {
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
          .map((poll: FamilyItem) => {
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
    const liste: FamilyItem[] = data.chores ?? [];

    /** Erledigt: Punkte gutschreiben, Reihe weiterrücken, Frist neu setzen.
     *
     * Genau diese drei Schritte macht sonst jemand von Hand - und einer
     * davon geht immer vergessen, meistens das Weiterrücken. */
    const erledigt = (chore: FamilyItem) => {
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

        {liste.map((chore: FamilyItem) => {
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
    const notfaelle: FamilyItem[] = data.emergency ?? [];
    // Nur die Nummern, die hierher gehören: Notfall, Arzt, Schule. Wer
    // keine Rollen vergeben hat, bekommt weiterhin alle – eine leere
    // Nummernliste ist auf dieser Seite der schlechtestmögliche Ausgang.
    const kontakte = fuerBabysitter(data.contacts ?? []);
    const eltern = (data.contacts ?? []).filter((contact: FamilyItem) =>
      rollenVon(contact).includes('notfall')
    );
    const routinen: FamilyItem[] = data.routines ?? [];
    const heute = isoInDays(0);
    const heuteMeds = (data.medications ?? []).filter(
      (med: FamilyItem) => !kurFertig(med)
    );
    const abend: FamilyItem = (data.babysitter ?? [])[0] ?? {};

    /** Die ganze Seite als Text – zum Weitergeben an jemanden ohne App. */
    const alsText = () => {
      const zeilen: string[] = ['FÜR DEN BABYSITTER', ''];
      for (const feld of ABEND_FELDER) {
        const wert = String(abend[feld.key] ?? '').trim();
        if (wert) zeilen.push(`${feld.label}: ${wert}`);
      }
      if (zeilen.length > 2) zeilen.push('');
      if (kontakte.length > 0) {
        zeilen.push('NUMMERN');
        for (const kontakt of kontakte) {
          const nummern = nummernVon(kontakt)
            .map((eintrag) => eintrag.nummer)
            .join(' / ');
          zeilen.push(`  ${kontakt.text}: ${nummern || '—'}`);
        }
        zeilen.push('');
      }
      if (heuteMeds.length > 0) {
        zeilen.push('HEUTE EINZUNEHMEN');
        for (const med of heuteMeds) {
          zeilen.push(`  ${med.text} – ${medZeile(med, heute)}`);
        }
        zeilen.push('');
      }
      zeilen.push(notfallText(notfaelle));
      return zeilen.join('\n');
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Babysitter" onBack={goBack} styles={styles} colors={colors} />

        {/* Das Wichtigste zuerst und gross: Wer im Zweifel anzurufen ist.
            In der Nummernliste zu suchen, während etwas los ist, ist
            genau das, was man nicht können soll. */}
        {eltern.length > 0 ? (
          <View style={{ gap: 8 }}>
            {eltern.slice(0, 2).map((kontakt: FamilyItem) => (
              <Pressable
                key={kontakt.id}
                onPress={() =>
                  Linking.openURL(`tel:${waehlbar(nummernVon(kontakt)[0]?.nummer)}`)
                }
                accessibilityRole="button"
                accessibilityLabel={`${kontakt.text} anrufen`}
                style={({ pressed }) => [styles.notrufButton, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="call" size={22} color="#FFFFFF" />
                <Text style={styles.notrufButtonText}>{kontakt.text} anrufen</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.hint}>
          Eine Seite zum Hinlegen oder Zeigen: was heute Abend gilt,
          wichtige Nummern, was einzunehmen ist und das Notfallblatt. Bis
          auf «Heute Abend» ist alles aus den anderen Modulen
          zusammengetragen – hier gibt es nichts doppelt zu pflegen.
        </Text>

        <Pressable
          onPress={() => Share.share({ message: alsText() }).catch(() => {})}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="share-outline" size={16} color={colors.accent} />
          <Text style={styles.addRowText}>Als Nachricht weitergeben</Text>
        </Pressable>

        {/* Die einzigen Angaben, die es sonst nirgends gibt – und genau
            die Fragen, die am Türrahmen kommen. */}
        <Text style={styles.groupLabel}>Heute Abend</Text>
        <Card style={styles.listCard}>
          {ABEND_FELDER.map((feld) => (
            <View key={feld.key} style={{ gap: 4 }}>
              <Text style={styles.formHintSmall}>{feld.label}</Text>
              <TextInput
                style={styles.input}
                defaultValue={String(abend[feld.key] ?? '')}
                placeholder={feld.placeholder}
                placeholderTextColor={colors.inkFaint}
                onEndEditing={(event) => {
                  const wert = event.nativeEvent.text.trim();
                  if (abend.id) update('babysitter', abend.id, { [feld.key]: wert });
                  else add('babysitter', { text: 'Heute Abend', [feld.key]: wert });
                }}
              />
            </View>
          ))}
        </Card>

        {kontakte.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Nummern</Text>
            <Card style={styles.listCard}>
              {kontakte.map((kontakt: FamilyItem) => {
                const nummern = nummernVon(kontakt);
                return (
                  <View key={kontakt.id} style={styles.checkRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkText}>{kontakt.text}</Text>
                      {nummern.map((eintrag) => (
                        <Text key={eintrag.nummer} style={styles.checkSub} selectable>
                          {eintrag.nummer}
                        </Text>
                      ))}
                      {nummern.length === 0 ? (
                        <Text style={styles.checkSub}>keine Nummer hinterlegt</Text>
                      ) : null}
                    </View>
                    {nummern.length > 0 ? (
                      <Pressable
                        onPress={() =>
                          Linking.openURL(`tel:${waehlbar(nummern[0].nummer)}`)
                        }
                        style={styles.callButton}
                        accessibilityLabel={`${kontakt.text} anrufen`}
                      >
                        <Ionicons name="call" size={16} color="#FFFFFF" />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        {heuteMeds.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Heute noch einzunehmen</Text>
            <Card style={styles.listCard}>
              {heuteMeds.map((med: FamilyItem) => {
                const offen = gabenVon(med).filter(
                  (gabe) => !(genommenMap(med)[heute] ?? []).includes(gabe)
                );
                return (
                  <View key={med.id} style={styles.checkRow}>
                    <Ionicons
                      name={offen.length === 0 ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={offen.length === 0 ? colors.on : colors.warn}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkText}>{med.text}</Text>
                      <Text style={styles.checkSub}>{medZeile(med, heute)}</Text>
                      {med.reason ? (
                        <Text style={styles.checkSub}>{med.reason}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        {notfaelle.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Im Notfall</Text>
            {notfaelle.map((eintrag: FamilyItem) => (
              <Card key={eintrag.id} style={styles.pinCard}>
                <Text style={styles.checkText}>{eintrag.text}</Text>
                {notfallZeilen(eintrag).map((zeile) => (
                  <Text key={zeile.label} style={styles.checkSub} selectable>
                    {zeile.label}: {zeile.wert}
                  </Text>
                ))}
                {eintrag.body ? (
                  <Text style={styles.checkSub} selectable>
                    {eintrag.body}
                  </Text>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}

        <Text style={styles.groupLabel}>Notruf</Text>
        <Card style={styles.listCard}>
          {NOTRUFE.map((notruf) => (
            <Pressable
              key={notruf.nummer}
              onPress={() => Linking.openURL(`tel:${waehlbar(notruf.nummer)}`)}
              accessibilityRole="button"
              accessibilityLabel={`${notruf.label} ${notruf.nummer} anrufen`}
              style={styles.checkRow}
            >
              <Ionicons name="call-outline" size={18} color={colors.danger} />
              <Text style={[styles.checkText, { flex: 1 }]}>{notruf.label}</Text>
              <Text style={styles.contactName}>{notruf.nummer}</Text>
            </Pressable>
          ))}
        </Card>

        {routinen.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>Routinen</Text>
            <Card style={styles.listCard}>
              {routinen.map((routine: FamilyItem) => (
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
      </View>
    );
  }

  if (view === 'woche') {
    // Montag der angezeigten Woche. Blättern ist der Unterschied zwischen
    // Nachschlagen und Planen: Am Sonntagabend plant man die kommende
    // Woche, nicht die laufende.
    const montag = plusWochen(montagVon(today), wochenVersatz);
    const heuteIso = isoTag(today);

    const tage = WEEK_DAYS.map((name, index) => {
      const datum = new Date(montag);
      datum.setDate(montag.getDate() + index);
      const iso = isoTag(datum);
      return {
        name,
        datum,
        iso,
        heute: iso === heuteIso,
        termine: events.filter(
          (event: FamilyItem) => isoTag(new Date(event.start)) === iso
        ),
        essen: (data.meals ?? []).find((meal: FamilyItem) => meal.day === name),
        aemtli: (data.chores ?? []).filter(
          (chore: FamilyItem) => String(chore.due ?? '').slice(0, 10) === iso
        ),
        aufgaben: (data.tasks ?? []).filter(
          (task: FamilyItem) => !task.done && String(task.due ?? '').slice(0, 10) === iso
        ),
        geburtstage: (data.contacts ?? []).filter(
          (contact: FamilyItem) =>
            daysUntilBirthday(contact.birthday) ===
            Math.round((datum.getTime() - new Date(heuteIso).getTime()) / 86_400_000)
        ),
      };
    });

    /** Eine Aufgabe oder ein Ämtli auf einen anderen Tag schieben. */
    const verschiebe = (liste: 'tasks' | 'chores', eintrag: FamilyItem, tage_: number) => {
      const alt = new Date(`${String(eintrag.due ?? heuteIso).slice(0, 10)}T00:00:00`);
      alt.setDate(alt.getDate() + tage_);
      update(liste, eintrag.id, { due: isoTag(alt) });
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Wochenplan" onBack={goBack} styles={styles} colors={colors} />

        <View style={styles.weekNav}>
          <Pressable
            onPress={() => setWochenVersatz(wochenVersatz - 1)}
            hitSlop={8}
            accessibilityLabel="Vorherige Woche"
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Pressable onPress={() => setWochenVersatz(0)} accessibilityRole="button">
            <Text style={styles.calTitle}>
              {wochenVersatz === 0
                ? 'Diese Woche'
                : `${kurzDatum(montag)} – ${kurzDatum(tage[6].datum)}`}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setWochenVersatz(wochenVersatz + 1)}
            hitSlop={8}
            accessibilityLabel="Nächste Woche"
          >
            <Ionicons name="chevron-forward" size={22} color={colors.ink} />
          </Pressable>
        </View>

        {/* Bei vier Personen ist «wer hat wann was» die eigentliche Frage –
            und die beantwortet eine Liste je Tag nicht. */}
        <View style={styles.chipRow}>
          {[{ name: 'Alle' }, ...members].map((m) => {
            const aktiv = wochenPerson === m.name;
            return (
              <Pressable
                key={m.name}
                onPress={() => setWochenPerson(aktiv ? 'Alle' : m.name)}
                accessibilityRole="radio"
                accessibilityState={{ selected: aktiv }}
                style={[styles.chip, aktiv && styles.chipActive]}
              >
                <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.hint}>
          Sonntagabend eine Seite statt vier Module. Essen und Zuteilungen
          lassen sich hier direkt ändern – wer planen will, soll nicht
          zwischen vier Modulen hin und her springen.
        </Text>

        {tage.map((tag) => {
          const aemtli =
            wochenPerson === 'Alle'
              ? tag.aemtli
              : tag.aemtli.filter((chore: FamilyItem) => chore.member === wochenPerson);
          const aufgaben =
            wochenPerson === 'Alle'
              ? tag.aufgaben
              : tag.aufgaben.filter((task: FamilyItem) => task.member === wochenPerson);
          const leer =
            tag.termine.length === 0 &&
            !tag.essen?.text &&
            aemtli.length === 0 &&
            aufgaben.length === 0 &&
            tag.geburtstage.length === 0;

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
                  {kurzDatum(tag.datum)}
                  {tag.heute ? ' · heute' : ''}
                </Text>
              </View>

              {tag.geburtstage.map((contact: FamilyItem) => (
                <View key={contact.id} style={styles.weekRowItem}>
                  <Ionicons name="gift-outline" size={15} color={colors.warn} />
                  <Text style={[styles.checkText, { flex: 1 }]}>
                    {contact.text} hat Geburtstag
                  </Text>
                </View>
              ))}

              {tag.termine.map((event: FamilyItem, index: number) => (
                <View key={`t${index}`} style={styles.weekRowItem}>
                  <Ionicons name="calendar-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]} numberOfLines={1}>
                    {event.summary ?? event.title ?? 'Termin'}
                  </Text>
                </View>
              ))}

              {/* Das Essen direkt hier eintragen: Sonst muss man für einen
                  Einfall den Essensplan öffnen und wieder zurück. */}
              <View style={styles.weekRowItem}>
                <Ionicons name="restaurant-outline" size={15} color={colors.inkSoft} />
                <TextInput
                  style={[styles.input, { flex: 1, paddingVertical: 6 }]}
                  defaultValue={String(tag.essen?.text ?? '')}
                  placeholder="Was gibt es?"
                  placeholderTextColor={colors.inkFaint}
                  onEndEditing={(event) => {
                    const text = event.nativeEvent.text.trim();
                    if (tag.essen) update('meals', tag.essen.id, { text });
                    else if (text) add('meals', { text, day: tag.name });
                  }}
                />
              </View>

              {aemtli.map((chore: FamilyItem) => (
                <View key={chore.id} style={styles.weekRowItem}>
                  <Ionicons name="repeat-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]}>
                    {chore.text}
                    {chore.member ? ` – ${chore.member}` : ''}
                  </Text>
                  {/* Zuteilen ohne Umweg: ein Tipp gibt es dem Nächsten. */}
                  <Pressable
                    onPress={() =>
                      update('chores', chore.id, {
                        member: rotateMember(
                          members.map((m) => m.name),
                          chore.member
                        ),
                      })
                    }
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`${chore.text} jemand anderem geben`}
                  >
                    <Ionicons name="person-outline" size={15} color={colors.inkSoft} />
                  </Pressable>
                </View>
              ))}

              {aufgaben.map((task: FamilyItem) => (
                <View key={task.id} style={styles.weekRowItem}>
                  <Ionicons name="checkbox-outline" size={15} color={colors.inkSoft} />
                  <Text style={[styles.checkText, { flex: 1 }]}>
                    {task.text}
                    {task.member ? ` – ${task.member}` : ''}
                  </Text>
                  <Pressable
                    onPress={() => verschiebe('tasks', task, -1)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`${task.text} einen Tag früher`}
                  >
                    <Ionicons name="chevron-back" size={15} color={colors.inkSoft} />
                  </Pressable>
                  <Pressable
                    onPress={() => verschiebe('tasks', task, 1)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`${task.text} einen Tag später`}
                  >
                    <Ionicons name="chevron-forward" size={15} color={colors.inkSoft} />
                  </Pressable>
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
        <Text style={styles.groupLabel}>Notruf</Text>
        <Card style={styles.listCard}>
          {NOTRUFE.map((notruf) => (
            <Pressable
              key={notruf.nummer}
              onPress={() => Linking.openURL(`tel:${waehlbar(notruf.nummer)}`)}
              accessibilityRole="button"
              accessibilityLabel={`${notruf.label} ${notruf.nummer} anrufen`}
              style={styles.checkRow}
            >
              <Ionicons name="call-outline" size={18} color={colors.danger} />
              <Text style={[styles.checkText, { flex: 1 }]}>{notruf.label}</Text>
              <Text style={styles.contactName}>{notruf.nummer}</Text>
            </Pressable>
          ))}
        </Card>

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

  if (view === 'medications') {
    const liste: FamilyItem[] = data.medications ?? [];
    const heute = isoInDays(0);
    const stunde = new Date().getHours();

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
                          const stand = hakeGabe(med, heute, gabe);
                          update('medications', med.id, {
                            taken: stand.taken,
                            done: stand.done,
                            log: [
                              ...(Array.isArray(med.log) ? med.log : []),
                              {
                                day: heute,
                                slot: gabe,
                                by: currentUser?.name ?? '?',
                                at: new Date().toISOString(),
                                undo: schon,
                              },
                            ].slice(-60),
                          });
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
      </View>
    );
  }

  if (view === 'rewards') {
    const log: FamilyItem[] = data.rewards ?? [];
    const catalog: FamilyItem[] = data.rewards_catalog ?? [];
    const pointsOf = (name: string) =>
      log
        .filter((entry) => entry.member === name)
        .reduce((sum, entry) => sum + Number(entry.points ?? 0), 0);
    const totals = members.map((member) => ({ ...member, points: pointsOf(member.name) }));
    const recent = [...log]
      .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')))
      .slice(0, 8);

    const redeem = (memberName: string, prize: FamilyItem) => {
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
    const contacts: FamilyItem[] = data.contacts ?? [];
    // Kontakte mit hinterlegtem Geburtstag – nach Nähe des nächsten sortiert.
    const upcoming = contacts
      .map((contact) => ({ contact, days: daysUntilBirthday(contact.birthday) }))
      .filter((entry) => entry.days != null)
      .sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
    // Nach Rolle filtern. «Alle» bleibt die Vorgabe: Wer keine Rollen
    // vergeben hat, soll seine Liste unverändert vorfinden.
    const gezeigt =
      kontaktRolle === 'alle' ? contacts : mitRolle(contacts, kontaktRolle);

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

        {/* Der Filter erscheint erst, wenn es etwas zu filtern gibt. */}
        {contacts.some((contact) => rollenVon(contact).length > 0) ? (
          <View style={styles.chipRow}>
            {[{ key: 'alle', label: 'Alle', icon: 'apps-outline' }, ...ROLLEN].map(
              (rolle) => {
                const aktiv = kontaktRolle === rolle.key;
                return (
                  <Pressable
                    key={rolle.key}
                    onPress={() => setKontaktRolle(rolle.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: aktiv }}
                    style={[styles.chip, aktiv && styles.chipActive]}
                  >
                    <Ionicons
                      name={rolle.icon as keyof typeof Ionicons.glyphMap}
                      size={13}
                      color={aktiv ? '#FFFFFF' : colors.inkSoft}
                    />
                    <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>
                      {rolle.label}
                    </Text>
                  </Pressable>
                );
              }
            )}
          </View>
        ) : null}

        <Text style={styles.hint}>
          Foto antippen ändert das Bild – die Karte antippen ruft an. Gross
          und mit Foto, damit auch die Kleinsten wissen, wer wer ist.
        </Text>

        {gezeigt.map((contact) =>
          kontaktBearbeitet === contact.id ? (
            <ContactForm
              key={contact.id}
              vorhanden={contact}
              onCancel={() => setKontaktBearbeitet(null)}
              onSave={(werte) => {
                update('contacts', contact.id, {
                  text: werte.text,
                  phone: werte.phone,
                  phone2: werte.phone2,
                  birthday: werte.birthday,
                  roles: werte.roles,
                  ...(werte.photo ? { photo: werte.photo } : {}),
                });
                setKontaktBearbeitet(null);
              }}
              styles={styles}
              colors={colors}
            />
          ) : (
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
                onPress={() =>
                  Linking.openURL(`tel:${waehlbar(nummernVon(contact)[0]?.nummer)}`)
                }
                accessibilityRole="button"
                accessibilityLabel={`${contact.text} anrufen`}
              >
                <Text style={styles.contactName}>{contact.text}</Text>
                {nummernVon(contact).map((eintrag) => (
                  <Text key={eintrag.nummer} style={styles.checkSub}>
                    {eintrag.nummer}
                  </Text>
                ))}
                {birthdayLabel(contact.birthday) ? (
                  <Text style={styles.checkSub}>🎂 {birthdayLabel(contact.birthday)}</Text>
                ) : null}
              </Pressable>

              <View style={{ gap: 6, alignItems: 'center' }}>
                <Pressable
                  onPress={() =>
                    Linking.openURL(`tel:${waehlbar(nummernVon(contact)[0]?.nummer)}`)
                  }
                  style={styles.callButton}
                  accessibilityLabel={`${contact.text} anrufen`}
                >
                  <Ionicons name="call" size={22} color="#FFFFFF" />
                </Pressable>
                {/* Nicht jede Frage ist ein Anruf wert – «kommst du später?»
                    schreibt man. */}
                <Pressable
                  onPress={() =>
                    Linking.openURL(`sms:${waehlbar(nummernVon(contact)[0]?.nummer)}`)
                  }
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${contact.text} eine Nachricht schreiben`}
                >
                  <Ionicons name="chatbubble-outline" size={18} color={colors.inkSoft} />
                </Pressable>
              </View>

              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={() => setKontaktBearbeitet(contact.id)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${contact.text} bearbeiten`}
                >
                  <Ionicons name="create-outline" size={18} color={colors.inkSoft} />
                </Pressable>
                <Pressable
                  onPress={() => remove('contacts', contact.id)}
                  style={styles.deleteTap}
                  accessibilityRole="button"
                  accessibilityLabel={`${contact.text} löschen`}
                >
                  <Ionicons name="close" size={18} color={colors.inkFaint} />
                </Pressable>
              </View>
            </Card>
          )
        )}

        {gezeigt.length === 0 && contacts.length > 0 ? (
          <Text style={styles.hint}>In dieser Rolle ist niemand eingetragen.</Text>
        ) : null}

        {kontaktBearbeitet === null ? (
          <ContactForm
            onSave={(werte) =>
              add('contacts', {
                text: werte.text,
                phone: werte.phone,
                ...(werte.phone2 ? { phone2: werte.phone2 } : {}),
                ...(werte.photo ? { photo: werte.photo } : {}),
                ...(werte.birthday ? { birthday: werte.birthday } : {}),
                ...(werte.roles.length > 0 ? { roles: werte.roles } : {}),
              })
            }
            styles={styles}
            colors={colors}
          />
        ) : null}
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

  if (view === 'recipes') {
    const meals: FamilyItem[] = data.meals ?? [];
    return (
      <View style={[styles.stack, { flex: 1 }]}>
        <RecipeBook
          recipes={data.recipes ?? []}
          settings={settings}
          currentUser={currentUser}
          initialRecipeId={rezeptStart ?? undefined}
          onAdd={(recipe) => add('recipes', recipe)}
          onUpdate={(id, patch) => update('recipes', id, patch)}
          onDelete={(id) => remove('recipes', id)}
          planMeal={(day, text, recipeId, servings) => {
            const entry = meals.find((meal) => meal.day === day);
            // Die Kennung kommt direkt vom Rezeptbuch mit – nicht mehr
            // über den Namen gesucht. Zwei Rezepte «Lasagne», oder eines,
            // das später umbenannt wird, und die Namenssuche hätte die
            // Zutaten dem falschen (oder keinem) Rezept zugeordnet.
            // Die Portionen wandern mit (Punkt 145).
            const patch = {
              text,
              recipe_id: recipeId || null,
              servings: servings > 0 ? servings : null,
            };
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
              (data.shopping ?? []).map((item: FamilyItem) => String(item.text ?? '')),
              faktor
            );
            neu.forEach((eintrag) =>
              add('shopping', { ...eintrag, done: false })
            );
            return neu.length;
          }}
          onClose={() => {
            // Wer aus dem Essensplaner kam, landet wieder dort - und der
            // Sprung soll beim nächsten Öffnen nicht erneut im selben
            // Rezept landen.
            setView(rezeptStart ? 'meals' : null);
            setRezeptStart(null);
          }}
        />
      </View>
    );
  }

  if (view === 'documents') {
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

