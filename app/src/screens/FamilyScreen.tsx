import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { Card } from '../components/Card';
import { BabysitterStand, LEERER_BABYSITTER, modusSatz } from '../lib/babysitter';
import { DraggableList } from '../components/DraggableList';
import { Shops } from '../components/Shops';
import { useColors } from '../theme';
import { RecipeBook } from './RecipeBook';
import { wochentagDatumKurz, wochentagUhr } from '../lib/format';
import {
  Shop,
  einkaufsText,
  eintragen,
  fuerLaden,
  ingredientsToShopping,
  ladenZaehler,
  mengeAendern,
  shopCategory,
  zeilenAufteilen,
} from '../lib/einkauf';
import {
  Vorgemerkt,
  anwenden,
  frisch,
  istVorlaeufig,
  merke,
  standText,
  vorlaeufigeId,
} from '../lib/familiecache';
import { herkunftText, neuSeit, suche, trefferName } from '../lib/familiensuche';
import { anwesenheitKurz, anwesenheitsZeile } from '../lib/ortung';
import {
  ABEND_FELDER,
  BABYSITTER_FEATURES,
  BABYSITTER_USER,
  KALENDER_FARBEN,
  ROLLEN,
  NOTFALL_FELDER,
  abendLuecken,
  babysitterKonto,
  babysitterVorname,
  babysitterZugang,
  fuerBabysitter,
  istBabysitterKonto,
  protokollZeile,
  PROTOKOLL_ZEILEN,
  geprueftVor,
  gabenVon,
  kontaktVeraltet,
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
  oeffnungsStatus,
  schnellwahl,
  offeneGaben,
  plusWochen,
  rollenVon,
  waehlbar,
} from '../lib/familie';
import { tapped } from '../lib/haptics';
import { kochVorschlaege, vorschlagsGrund, wuerfel } from '../lib/vorschlag';
import { ROLE_LABELS } from './UsersScreen';
import { AddRow, BackHead, CheckRow, ChoreAddRow, ContactForm, ContactPhoto, CountdownForm, EventForm, FamilyData, FamilyItem, GroupedChecklist, MealRow, MedicationAddRow, Member, ModuleKey, MonthCalendar, Notrufliste, PollAddRow, Props, REPEAT_OPTIONS, SHOP_CATEGORIES, ShoppingAddRow, TaskAddRow, TwoFieldForm, WEEK_DAYS, birthdayLabel, daysUntilBirthday, dueInfo, isoInDays, nextDue, parseSwissDate, pickPhoto, rotateMember } from './family/bausteine';
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


/** Wo der letzte bekannte Stand und die Warteschlange liegen. */
const CACHE_KEY = 'homepilot.family.cache';
const QUEUE_KEY = 'homepilot.family.queue';
/** Wann jedes Modul zuletzt angesehen wurde – je Person im Gerät. */
const SEEN_KEY = 'homepilot.family.seen';
/** Welche Kacheln ausgeblendet sind – je Gerät, wie die Reihenfolge. */
const HIDDEN_KEY = 'homepilot.family.hidden';
/** Kennung fürs Wachhalten im Einkaufs-Modus. */
const EINKAUF_TAG = 'homepilot-einkauf';

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
  // Der Stand, wie der Hub ihn kennt …
  const [serverData, setServerData] = useState<FamilyData>({});
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
  // Babysitter-Zugang: der Gastbenutzer und sein frisches Token.
  const [babysitterUser, setBabysitterUser] = useState<FamilyItem | null>(null);
  const [babysitterToken, setBabysitterToken] = useState<string | null>(null);
  // Punkt 187: Mehrere Babysitter, jeder mit eigenem Zugang.
  const [babysitterKonten, setBabysitterKonten] = useState<FamilyItem[]>([]);
  const [babysitterName, setBabysitterName] = useState('');
  // Punkt 184: «So sieht es der Babysitter» – zeigt die Lücken vorher.
  const [babysitterVorschau, setBabysitterVorschau] = useState(false);
  // Punkt 167: Was gelöscht wurde – dreissig Tage lang.
  const [korb, setKorb] = useState<FamilyItem[]>([]);
  const [korbOffen, setKorbOffen] = useState(false);
  // Punkt 205: Ausgeblendete Kacheln – je Person im Gerät, wie die
  // Reihenfolge. Was ausgeblendet ist, ist nicht weg, nur nicht im Weg.
  const [versteckteModule, setVersteckteModule] = useState<string[]>([]);
  const [ordnen, setOrdnen] = useState(false);
  // Vom Essensplaner direkt ins Rezept springen (Punkt 146).
  const [rezeptStart, setRezeptStart] = useState<string | null>(null);
  // Einkaufsliste: welcher Laden gefiltert ist (Punkt 175) und ob der
  // Einkaufs-Modus läuft (Punkt 173).
  const [laden, setLaden] = useState('allgemein');
  const [imLaden, setImLaden] = useState(false);
  // Was nach dem üblichen Abstand wieder fällig wäre (Punkt 176).
  const [faellig, setFaellig] = useState<{ text: string; days_since: number; interval: number }[]>(
    []
  );
  // Suche über alle Listen (Punkt 166).
  const [suchtext, setSuchtext] = useState('');
  // Wann welches Modul zuletzt angesehen wurde (Punkt 168).
  const [gesehen, setGesehen] = useState<Record<string, string>>({});
  // Die Hausadresse aus der Konfiguration (Punkt 213).
  const [hausadresse, setHausadresse] = useState<{ address: string; note: string } | null>(
    null
  );
  // Wer gerade wo ist (Punkt 196) und warum es dort so steht (Punkt 219).
  const [anwesend, setAnwesend] = useState<Record<string, unknown>[]>([]);
  const [ortungsDiagnose, setOrtungsDiagnose] = useState<Record<string, unknown>[] | null>(
    null
  );
  // «Was koche ich heute?» im Planer (Punkt 139): Die Saat hält die
  // Vorschläge stehen, bis jemand würfelt - sonst mischte jedes
  // Live-Update vom Hub die Liste um.
  const [essWurf, setEssWurf] = useState(1);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  // ── Ohne Netz lesbar bleiben (Punkte 165 und 172) ──────────────────────
  //
  // Der Geräte-Bildschirm legt seinen Stand längst im Gerät ab; die
  // Familienseite tat es nicht. Wer im Ladenkeller die Einkaufsliste
  // öffnete, sah nichts - und ein Häkchen dort lief ins Leere, ohne dass
  // es jemand merkte.
  const [stand, setStand] = useState<number | null>(null);
  const [verbunden, setVerbunden] = useState(true);
  const [offen, setOffen] = useState<Vorgemerkt[]>([]);
  // Die Warteschlange auch zum Nachlesen, ohne den Effekt neu zu binden.
  const offenRef = useRef<Vorgemerkt[]>([]);
  offenRef.current = offen;

  // Beim Öffnen sofort den letzten bekannten Stand zeigen, statt auf die
  // Verbindung zu warten - derselbe Handel wie in useHub.
  useEffect(() => {
    let abgebrochen = false;
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (!raw || abgebrochen) return;
        const gespeichert = JSON.parse(raw);
        setServerData((vorher) => (Object.keys(vorher).length > 0 ? vorher : gespeichert.data ?? {}));
        if (typeof gespeichert.at === 'number') setStand((v) => v ?? gespeichert.at);
      })
      // Kein Zwischenspeicher ist kein Fehler - dann kommt alles frisch.
      .catch(() => {});
    AsyncStorage.getItem(QUEUE_KEY)
      .then((raw) => {
        if (!raw || abgebrochen) return;
        setOffen(frisch(JSON.parse(raw), Date.now()));
      })
      .catch(() => {});
    return () => {
      abgebrochen = true;
    };
  }, []);

  const load = useCallback(() => {
    // Der Bildschirm zeigt Fehler selbst an - deshalb «still».
    hub
      .get<FamilyData>('/api/family', { still: true })
      .then((payload) => {
        setServerData(payload);
        setError(null);
        setVerbunden(true);
        const jetzt = Date.now();
        setStand(jetzt);
        AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data: payload, at: jetzt })
        ).catch(() => {});
      })
      .catch((err) => {
        setVerbunden(false);
        setError(
          `Familiendaten nicht abrufbar (${err instanceof HubFehler ? err.message : err})`
        );
      });
  }, [hub]);

  useEffect(load, [load]);

  // … und der Stand, den man sieht: Server plus das, was noch wartet.
  // Ohne diese Überlagerung springt das Häkchen zurück, und man tippt es
  // ein zweites Mal.
  const data = useMemo(() => anwenden(serverData, offen), [serverData, offen]);

  // Was wartet, wird gespeichert: Die App darf zwischendurch beendet
  // werden, ohne dass ein Häkchen verlorengeht.
  useEffect(() => {
    AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(offen)).catch(() => {});
  }, [offen]);

  /**
   * Eine Änderung an den Hub - und wenn er nicht da ist, in die Warteschlange.
   *
   * Zurück kommt, ob es sofort geklappt hat. Der Aufrufer braucht das
   * nicht; die Anzeige entsteht aus `offen`.
   */
  const senden = useCallback(
    async (eintrag: Vorgemerkt): Promise<boolean> => {
      try {
        if (eintrag.kind === 'add') {
          await hub.post(`/api/family/${eintrag.collection}`, eintrag.body ?? {}, {
            still: true,
          });
        } else if (eintrag.kind === 'update') {
          await hub.put(
            `/api/family/${eintrag.collection}/${eintrag.id}`,
            eintrag.body ?? {},
            { still: true }
          );
        } else {
          await hub.del(`/api/family/${eintrag.collection}/${eintrag.id}`, {
            still: true,
          });
        }
        return true;
      } catch {
        return false;
      }
    },
    [hub]
  );

  // Sobald die Verbindung wieder steht, geht die Warteschlange raus -
  // in der Reihenfolge, in der getippt wurde.
  useEffect(() => {
    if (!verbunden || offen.length === 0) return;
    let abgebrochen = false;
    (async () => {
      const rest: Vorgemerkt[] = [];
      for (const eintrag of offenRef.current) {
        // Ein lokal angelegter Eintrag wird als Neuzugang geschickt; seine
        // vorläufige Kennung kennt der Hub nicht.
        const geschickt = await senden(
          istVorlaeufig(eintrag.id) && eintrag.kind !== 'add'
            ? { ...eintrag, kind: 'add' }
            : eintrag
        );
        if (!geschickt) rest.push(eintrag);
      }
      if (abgebrochen) return;
      setOffen(rest);
      if (rest.length === 0) load();
    })();
    return () => {
      abgebrochen = true;
    };
    // Absichtlich nur an `verbunden` und der Länge: Der Lauf soll einmal
    // je Wiederverbindung starten, nicht bei jedem Zwischenstand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verbunden, offen.length]);

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
      const eintrag: Vorgemerkt = {
        kind: 'add',
        collection,
        id: vorlaeufigeId(Date.now()),
        body: item,
        at: Date.now(),
      };
      if (await senden(eintrag)) {
        load();
        return;
      }
      // Kein Netz: vormerken statt schweigend verlieren.
      setVerbunden(false);
      setOffen((vorher) => merke(vorher, eintrag));
    },
    [senden, load]
  );

  const update = useCallback(
    async (collection: string, id: string, patch: FamilyItem) => {
      const eintrag: Vorgemerkt = {
        kind: 'update',
        collection,
        id,
        body: patch,
        at: Date.now(),
      };
      if (await senden(eintrag)) {
        load();
        return;
      }
      setVerbunden(false);
      setOffen((vorher) => merke(vorher, eintrag));
    },
    [senden, load]
  );

  const remove = useCallback(
    async (collection: string, id: string) => {
      const eintrag: Vorgemerkt = {
        kind: 'remove',
        collection,
        id,
        at: Date.now(),
      };
      if (await senden(eintrag)) {
        load();
        return;
      }
      setVerbunden(false);
      setOffen((vorher) => merke(vorher, eintrag));
    },
    [senden, load]
  );

  // Was der Hub nebenbei weiss: fällige Standardartikel, die Hausadresse
  // und wer gerade da ist. Alles drei ohne Aufhebens - fehlt es, bleibt
  // die jeweilige Zeile einfach weg.
  useEffect(() => {
    hub
      .get<{ items: typeof faellig } | null>('/api/shopping/due', {
        fallback: null,
        still: true,
      })
      .then((payload) => setFaellig(payload?.items ?? []));
    hub
      .get<{ address: string; note: string } | null>('/api/haus/adresse', {
        fallback: null,
        still: true,
      })
      .then(setHausadresse);
  }, [hub]);

  useEffect(() => {
    hub
      .get<{ people: Record<string, unknown>[] } | null>('/api/presence', {
        fallback: null,
        still: true,
      })
      .then((payload) => setAnwesend(payload?.people ?? []));
  }, [hub, changedAt]);

  // Die Lesemarken je Modul liegen im Gerät: «neu» ist eine persönliche
  // Frage, und ein zweites Telefon derselben Person darf ruhig eine
  // eigene Antwort haben.
  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((raw) => setGesehen(raw ? JSON.parse(raw) : {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(HIDDEN_KEY)
      .then((raw) => setVersteckteModule(raw ? JSON.parse(raw) : []))
      .catch(() => {});
  }, []);

  // Punkt 173: Im Laden hält man das Telefon in einer Hand und in der
  // anderen den Wagen – ein Bildschirm, der alle 30 Sekunden zugeht, ist
  // dort dasselbe Ärgernis wie beim Kochen. Wachhalten ist eine Zugabe:
  // wo es das nicht gibt (Web), kauft man wie bisher ein.
  useEffect(() => {
    if (!imLaden) return;
    activateKeepAwakeAsync(EINKAUF_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(EINKAUF_TAG).catch(() => {});
    };
  }, [imLaden]);

  const ladeKorb = useCallback(() => {
    hub
      .get<{ items: FamilyItem[] } | null>('/api/family-trash', {
        fallback: null,
        still: true,
      })
      .then((payload) => setKorb(payload?.items ?? []));
  }, [hub]);
  useEffect(ladeKorb, [ladeKorb, changedAt]);

  /** Eine Kachel aus- oder wieder einblenden (Punkt 205). */
  const toggleModul = useCallback((key: string) => {
    setVersteckteModule((vorher) => {
      const neu = vorher.includes(key)
        ? vorher.filter((eintrag) => eintrag !== key)
        : [...vorher, key];
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(neu)).catch(() => {});
      return neu;
    });
  }, []);

  /** Ein Modul als gesehen markieren (Punkt 168). */
  const merkeGesehen = useCallback((modul: string) => {
    setGesehen((vorher) => {
      const neu = { ...vorher, [modul]: new Date().toISOString() };
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify(neu)).catch(() => {});
      return neu;
    });
  }, []);

  /**
   * Die ehrliche Zeile über der Liste (Punkte 165 und 172).
   *
   * Ohne sie sieht ein alter Stand aus wie ein aktueller – und genau das
   * ist der Schaden, nicht der alte Stand selbst.
   */
  const standHinweis = standText(stand, verbunden, offen.length, new Date());
  const standZeile = standHinweis ? (
    <View style={styles.standRow}>
      <Ionicons
        name={verbunden ? 'cloud-upload-outline' : 'cloud-offline-outline'}
        size={15}
        color={colors.inkSoft}
      />
      <Text style={styles.standText}>{standHinweis}</Text>
    </View>
  ) : null;

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

  // ── Babysitter-Zugang ──────────────────────────────────────────────────
  // Nur Eltern dürfen das: Die Benutzerverwaltung prüft es ohnehin, aber
  // einen Knopf hinzustellen, der «keine Berechtigung» antwortet, ist
  // keine Bedienung.
  const darfBenutzer =
    currentUser?.role === 'besitzer' || currentUser?.role === 'bewohner';
  const babysitterAktiv = !!babysitterUser?.enabled;
  // Der Modus ist etwas anderes als der Zugang: Der Zugang lässt jemanden
  // in die App, der Modus hält die Abläufe zurück, die «niemand zuhause»
  // annehmen. Beides gehört auf dieselbe Seite, aber an eigene Schalter -
  // man will den einen ohne den anderen haben können.
  const [modus, setModus] = useState<BabysitterStand>(LEERER_BABYSITTER);
  const [ablaufZahl, setAblaufZahl] = useState(0);

  const ladeBabysitter = useCallback(() => {
    if (!darfBenutzer) return;
    hub
      .get<FamilyItem[]>('/api/users', { still: true })
      .then((liste) => {
        // Punkt 187: Es gibt nicht mehr «den» Babysitter, sondern je
        // Person einen Zugang - dann steht im Protokoll auch, wer da war.
        const konten = (Array.isArray(liste) ? liste : []).filter(istBabysitterKonto);
        setBabysitterKonten(konten);
        setBabysitterUser(konten.find((user) => user.enabled) ?? konten[0] ?? null);
      })
      .catch(() => {
        setBabysitterKonten([]);
        setBabysitterUser(null);
      });
  }, [hub, darfBenutzer]);

  const ladeModus = useCallback(() => {
    hub
      .get<{ automations?: unknown[]; babysitter?: BabysitterStand } | null>(
        '/api/automations',
        { fallback: null, still: true }
      )
      .then((daten) => {
        setModus(daten?.babysitter ?? LEERER_BABYSITTER);
        setAblaufZahl(daten?.automations?.length ?? 0);
      });
  }, [hub]);

  const schalteModus = async (active: boolean) => {
    try {
      const antwort = await hub.post<{ babysitter?: BabysitterStand }>(
        '/api/automations/babysitter',
        { active },
        { still: true }
      );
      setModus(antwort?.babysitter ?? LEERER_BABYSITTER);
    } catch (err) {
      setError(
        `Babysitter-Modus nicht umgestellt (${err instanceof Error ? err.message : err})`
      );
    }
  };

  useEffect(() => {
    if (view === 'babysitter') {
      ladeBabysitter();
      ladeModus();
    }
  }, [view, ladeBabysitter, ladeModus]);

  const oeffneBabysitter = async (bis: string) => {
    const zugang = babysitterZugang(new Date(), bis);
    const konto = babysitterKonto(babysitterName);
    const vorhanden = babysitterKonten.find((user) => user.name === konto);
    try {
      if (vorhanden) {
        await hub.put(
          `/api/users/${encodeURIComponent(konto)}`,
          { enabled: true, features: BABYSITTER_FEATURES, ...zugang },
          { still: true }
        );
      } else {
        const antwort = await hub.post<{ user?: FamilyItem; token?: string }>(
          '/api/users',
          {
            name: konto,
            role: 'gast',
            features: BABYSITTER_FEATURES,
            ...zugang,
          },
          { still: true }
        );
        // Das Token gibt es genau einmal – beim Anlegen. Danach steht es
        // nirgends mehr, und das ist so gewollt.
        setBabysitterToken(antwort?.token ?? antwort?.user?.token ?? null);
      }
      ladeBabysitter();
    } catch (err) {
      setError(
        `Zugang nicht geöffnet (${err instanceof Error ? err.message : err})`
      );
    }
  };

  /**
   * «Noch eine Stunde» (Punkt 185).
   *
   * Wenn es später wird, legt man sonst den Zugang neu an - und der
   * Babysitter muss sich neu anmelden, mitten im Abend.
   */
  const verlaengereBabysitter = async (konto: FamilyItem) => {
    const bisher = String(konto.hours?.to ?? '22:00');
    const [stunde, minute] = bisher.split(':').map(Number);
    const spaeter = `${String((stunde + 1) % 24).padStart(2, '0')}:${String(
      minute || 0
    ).padStart(2, '0')}`;
    try {
      await hub.put(
        `/api/users/${encodeURIComponent(String(konto.name))}`,
        { hours: { ...(konto.hours ?? {}), to: spaeter } },
        { still: true }
      );
      ladeBabysitter();
    } catch (err) {
      setError(
        `Zugang nicht verlängert (${err instanceof Error ? err.message : err})`
      );
    }
  };

  const schliesseBabysitter = async (name?: string) => {
    try {
      await hub.put(
        `/api/users/${encodeURIComponent(name ?? String(babysitterUser?.name ?? BABYSITTER_USER))}`,
        { enabled: false },
        { still: true }
      );
      setBabysitterToken(null);
      ladeBabysitter();
    } catch (err) {
      setError(
        `Zugang nicht geschlossen (${err instanceof Error ? err.message : err})`
      );
    }
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
    const alle: FamilyItem[] = data.shopping ?? [];
    const shops = (data.shops ?? []) as unknown as Shop[];
    // Punkt 175: Der Käse vom Hofladen und die Schrauben aus dem
    // Baumarkt standen bisher zwischen der Migros-Ware.
    const items = fuerLaden(alle, laden);
    const done = items.filter((item) => item.done);
    const offeneItems = items.filter((item) => !item.done);
    // Nach Kategorie gruppieren, in der Ladenrundgang-Reihenfolge. Einträge
    // ohne Kategorie (alt oder aus dem Essensplan) landen unter «Sonstiges».
    const catOf = (item: FamilyItem) =>
      SHOP_CATEGORIES.includes(item.category) ? item.category : 'Sonstiges';
    // Im Einkaufs-Modus verschwindet Erledigtes: Was im Wagen liegt,
    // kostet nur Platz (Punkt 173).
    const sichtbar = imLaden ? offeneItems : items;
    const usedCats = SHOP_CATEGORIES.filter((cat) =>
      sichtbar.some((item) => catOf(item) === cat)
    );
    // Standardartikel: was jede Woche in den Wagen wandert. Ein Tipp
    // legt sie an, statt sie jedes Mal zu tippen - und wer sie einmal
    // von Hand einträgt, kann sie danach als Standard merken.
    const staples: FamilyItem[] = data.staples ?? [];
    const aufListe = new Set(
      alle.map((item: FamilyItem) => String(item.text ?? '').trim().toLowerCase())
    );
    const zaehler = ladenZaehler(alle, shops);
    const aktuellerShop = shops.find((shop) => shop.id === laden) ?? null;

    /** Eintragen – mit Komma-Trennung und Zusammenlegen (174, 209). */
    const eintragenAuf = (roh: string, category: string) => {
      const teile = /[,;\n]/.test(roh)
        ? zeilenAufteilen(roh)
        : [{ text: roh.trim(), category: category || shopCategory(roh) }];
      for (const teil of teile) {
        const schritt = eintragen(alle, teil.text, teil.category);
        if (schritt.kind === 'mehr') update('shopping', schritt.id, { text: schritt.text });
        else
          add('shopping', {
            ...schritt.draft,
            done: false,
            ...(laden && laden !== 'allgemein' ? { shop: laden } : {}),
          });
      }
    };

    return (
      <View style={styles.stack}>
        <BackHead title="Einkaufsliste" onBack={goBack} styles={styles} colors={colors} />
        {standZeile}
        {/* Punkt 173: Im Laden hält man das Telefon in einer Hand und in
            der anderen den Wagen. */}
        <Pressable
          onPress={() => {
            tapped();
            setImLaden(!imLaden);
          }}
          style={styles.clearButton}
          accessibilityRole="button"
        >
          <Text style={styles.resetText}>
            {imLaden
              ? `Fertig – noch ${offeneItems.length} offen`
              : 'Ich bin im Laden'}
          </Text>
        </Pressable>
        {shops.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {zaehler.map(({ shop, offen: wieviel }) => (
                <Pressable
                  key={shop.id}
                  onPress={() => setLaden(shop.id)}
                  style={[styles.chip, laden === shop.id && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, laden === shop.id && styles.chipTextActive]}
                  >
                    {shop.name} ({wieviel})
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : null}
        {imLaden ? null : (
          <Card style={styles.listCard}>
            <ShoppingAddRow onAdd={eintragenAuf} styles={styles} colors={colors} />
          </Card>
        )}
        {/* Punkt 176: Was jede Woche fehlt, schlägt sich selbst vor. */}
        {!imLaden && faellig.length > 0 ? (
          <Card style={styles.listCard}>
            <Text style={styles.groupTitle}>Fehlt vermutlich</Text>
            <View style={styles.stapleRow}>
              {faellig.map((vorschlag) => (
                <Pressable
                  key={vorschlag.text}
                  onPress={() => eintragenAuf(vorschlag.text, '')}
                  style={styles.staple}
                  accessibilityRole="button"
                  accessibilityLabel={`${vorschlag.text} auf die Liste`}
                >
                  <Ionicons name="add" size={13} color={colors.inkSoft} />
                  <Text style={styles.stapleText}>{vorschlag.text}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>
              {faellig[0].text} stand zuletzt vor {faellig[0].days_since} Tagen drauf,
              sonst alle {faellig[0].interval}.
            </Text>
          </Card>
        ) : null}
        {!imLaden && staples.length > 0 ? (
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
                      drauf ? undefined : eintragenAuf(String(staple.text ?? ''), String(staple.category ?? ''))
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
            {sichtbar
              .filter((item) => catOf(item) === cat)
              .map((item) => (
                <CheckRow
                  key={item.id}
                  item={item}
                  gross={imLaden}
                  // Punkt 208: Woher der Posten kommt – im Laden fragt
                  // man sich sonst, wofür die 250 g Kapern waren.
                  sub={item.from ? `aus ${item.from}` : undefined}
                  onSubPress={
                    item.from_id
                      ? () => {
                          setRezeptStart(String(item.from_id));
                          setView('recipes');
                        }
                      : undefined
                  }
                  onToggle={() => update('shopping', item.id, { done: !item.done })}
                  onDelete={() => remove('shopping', item.id)}
                  // Punkt 207: Menge verstellen, ohne den Text zu tippen.
                  onCount={(delta) =>
                    update('shopping', item.id, {
                      text: mengeAendern(String(item.text ?? ''), delta),
                    })
                  }
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
        {sichtbar.length === 0 ? (
          <Text style={styles.hint}>
            {imLaden ? 'Alles im Wagen.' : 'Die Liste ist leer. Trag oben ein, was fehlt.'}
          </Text>
        ) : null}
        {/* Punkt 177: Teilen, ohne die App zu verlangen. */}
        {offeneItems.length > 0 ? (
          <Pressable
            onPress={() =>
              Share.share({ message: einkaufsText(offeneItems, aktuellerShop) })
            }
            style={styles.clearButton}
            accessibilityRole="button"
          >
            <Text style={styles.resetText}>Liste teilen</Text>
          </Pressable>
        ) : null}
        {done.length > 0 && !imLaden ? (
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
        {imLaden ? null : (
          <Shops
            shops={shops}
            onAdd={(shop) => add('shops', shop)}
            onUpdate={(id, changes) => update('shops', id, changes)}
            onRemove={(id) => remove('shops', id)}
          />
        )}
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
      // Die ganzen Posten hineingeben, nicht nur ihre Namen: Nur so
      // lässt sich die Menge zu einem Eintrag dazuzählen, der schon
      // draufliegt, statt ihn wortlos fallen zu lassen.
      const { neu, mehr } = ingredientsToShopping(
        rezepteMitTag.map((paar) => paar.recipe) as FamilyItem[],
        (data.shopping ?? []) as FamilyItem[],
        faktoren
      );
      neu.forEach((eintrag) => add('shopping', { ...eintrag, done: false }));
      mehr.forEach((eintrag) => update('shopping', eintrag.id, { amount: eintrag.amount }));
      return neu.length + mehr.length;
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
        {/* Punkt 206: Was an einer Pinnwand hängt, sind selten Sätze –
            der Elternbrief, der Stundenplan, die Zeichnung. */}
        <Pressable
          onPress={async () => {
            const foto = await pickPhoto();
            if (foto) add('pins', { text: 'Foto', photo: foto });
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="image-outline" size={16} color={colors.accent} />
          <Text style={styles.addRowText}>Foto anpinnen</Text>
        </Pressable>

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
              {pin.photo ? (
                <Pressable
                  onPress={async () => {
                    const foto = await pickPhoto();
                    if (foto) update('pins', pin.id, { photo: foto });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Bild austauschen"
                >
                  <Image
                    source={{ uri: String(pin.photo) }}
                    style={styles.pinPhoto}
                    resizeMode="cover"
                  />
                </Pressable>
              ) : null}
              <Text style={styles.checkText}>{pin.text}</Text>
              <View style={styles.pinFoot}>
                {/* Punkt 168: author und created standen in jedem Eintrag,
                    ohne dass sie je jemand las. */}
                <Text style={styles.checkSub}>{herkunftText(pin, new Date())}</Text>
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
    const luecken = abendLuecken(abend, kontakte, hausadresse?.address);
    // Punkt 214: Der Abendablauf steht im Routinen-Modul – abgetippt
    // wurde er trotzdem noch einmal.
    const abendRoutine = routinen.find(
      (routine: FamilyItem) => routine.id === abend.routine_id
    );

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

        {/* Punkt 213: Wer 144 wählt, muss als Erstes sagen, WO er ist –
            und genau das weiss eine fremde Person im Haus nicht
            auswendig. Darum ganz oben und in Grossschrift. */}
        {hausadresse?.address ? (
          <Card style={styles.adresseCard}>
            <Text style={styles.adresseLabel}>WIR SIND HIER</Text>
            <Text style={styles.adresseText} selectable>
              {hausadresse.address}
            </Text>
            {hausadresse.note ? (
              <Text style={styles.adresseNote}>{hausadresse.note}</Text>
            ) : null}
          </Card>
        ) : null}

        {/* Das Wichtigste zuerst und gross: Wer im Zweifel anzurufen ist.
            In der Nummernliste zu suchen, während etwas los ist, ist
            genau das, was man nicht können soll. */}
        {eltern.length > 0 ? (
          <View style={{ gap: 8 }}>
            {/* Punkt 183: Beide Eltern nacheinander, statt in der Liste
                zu suchen. Der zweite Knopf ist der leise Weg - nicht
                jede Frage muss mitten im Kino klingeln. */}
            <Pressable
              onPress={() => {
                const nummern = eltern
                  .map((kontakt: FamilyItem) => nummernVon(kontakt)[0]?.nummer)
                  .filter(Boolean);
                if (nummern[0]) Linking.openURL(`tel:${waehlbar(nummern[0])}`);
              }}
              accessibilityRole="button"
              accessibilityLabel="Eltern anrufen"
              style={({ pressed }) => [styles.notrufButton, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="call" size={22} color="#FFFFFF" />
              <Text style={styles.notrufButtonText}>Eltern anrufen</Text>
            </Pressable>
            {eltern.slice(0, 2).map((kontakt: FamilyItem) => (
              <View key={kontakt.id} style={styles.addRow}>
                <Pressable
                  onPress={() =>
                    Linking.openURL(`tel:${waehlbar(nummernVon(kontakt)[0]?.nummer)}`)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${kontakt.text} anrufen`}
                  style={({ pressed }) => [
                    styles.chip,
                    { flex: 1 },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons name="call-outline" size={14} color={colors.inkSoft} />
                  <Text style={styles.chipText}>{kontakt.text}</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      `sms:${waehlbar(nummernVon(kontakt)[0]?.nummer)}&body=${encodeURIComponent(
                        'Kurze Meldung: alles in Ordnung.'
                      )}`
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${kontakt.text} kurz melden`}
                  style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="chatbubble-outline" size={14} color={colors.inkSoft} />
                  <Text style={styles.chipText}>Kurz melden</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Punkt 184: Ob das Blatt vollständig ist, merkt man sonst erst,
            wenn angerufen wird. */}
        {darfBenutzer ? (
          <Pressable
            onPress={() => setBabysitterVorschau(!babysitterVorschau)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="eye-outline" size={16} color={colors.accent} />
            <Text style={styles.addRowText}>
              {babysitterVorschau ? 'Vorschau schliessen' : 'Vorschau: so sieht es der Babysitter'}
            </Text>
          </Pressable>
        ) : null}
        {babysitterVorschau ? (
          <Card style={styles.listCard}>
            <Text style={styles.groupTitle}>Was noch fehlt</Text>
            {luecken.length === 0 ? (
              <Text style={styles.hint}>Nichts – das Blatt ist vollständig.</Text>
            ) : (
              luecken.map((zeile) => (
                <View key={zeile} style={styles.checkRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.warn} />
                  <Text style={[styles.checkSub, { flex: 1 }]}>{zeile}</Text>
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Vom Merkblatt zum Zugang: Bisher war das hier eine Seite, die
            nur sieht, wer ohnehin schon in der App ist. Der Babysitter
            hat sie also gar nie zu Gesicht bekommen. Der Zugang benutzt,
            was es für Gäste längst gibt - Ablaufdatum und Zeitfenster -,
            und gibt nur Licht und Familie frei: keine Türen, kein Alarm,
            keine Kameras. Was man nicht freigibt, muss man später nicht
            bereuen. */}
        {/* Der Grund, warum es diesen Modus gibt: Sind die Eltern weg,
            meldet die Anwesenheit «niemand zuhause» - und «alles aus»
            fährt die Storen herunter und schaltet scharf, während der
            Babysitter im Wohnzimmer sitzt. */}
        {darfBenutzer && ablaufZahl > 0 ? (
          <Card
            style={{
              ...styles.listCard,
              ...(modus.active ? { borderColor: colors.warn } : {}),
            }}
          >
            <View style={styles.checkRow}>
              <Ionicons
                name={modus.active ? 'shield-checkmark' : 'shield-outline'}
                size={20}
                color={modus.active ? colors.warn : colors.inkSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>Babysitter-Modus</Text>
                <Text style={styles.checkSub}>{modusSatz(modus, ablaufZahl)}</Text>
              </View>
              <Pressable
                onPress={() => schalteModus(!modus.active)}
                accessibilityRole="switch"
                accessibilityState={{ checked: modus.active }}
                accessibilityLabel={
                  modus.active
                    ? 'Babysitter-Modus ausschalten'
                    : 'Babysitter-Modus einschalten'
                }
                style={({ pressed }) => [
                  styles.chip,
                  modus.active && styles.chipActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.chipText, modus.active && styles.chipTextActive]}>
                  {modus.active ? 'läuft' : 'einschalten'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.formHintSmall}>
              Welche Abläufe trotzdem laufen, hakt man unter Abläufe an – das
              Schild neben dem Stift. Wasser- und Rauchmelder, die Alarmanlage
              selbst und die Meldungen des Wächters sind davon nicht betroffen.
            </Text>
          </Card>
        ) : null}

        {darfBenutzer ? (
          <Card style={styles.listCard}>
            <View style={styles.checkRow}>
              <Ionicons
                name={babysitterAktiv ? 'lock-open-outline' : 'lock-closed-outline'}
                size={20}
                color={babysitterAktiv ? colors.on : colors.inkSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>Zugang für heute Abend</Text>
                <Text style={styles.checkSub}>
                  {babysitterAktiv
                    ? `Offen bis ${babysitterUser?.hours?.to ?? '?'} Uhr – Licht und diese Seite`
                    : 'Geschlossen. Öffnen legt einen Gastzugang an, der von selbst endet.'}
                </Text>
              </View>
            </View>
            {/* Punkt 187: Je Person ein Zugang – sonst steht im
                Zugriffsprotokoll dieselbe Zeile für drei Menschen. */}
            <TextInput
              style={styles.input}
              value={babysitterName}
              onChangeText={setBabysitterName}
              placeholder="Für wen? (z.B. Nina – freiwillig)"
              placeholderTextColor={colors.inkFaint}
            />
            <View style={styles.chipRow}>
              {['21:00', '22:00', '23:00', '00:30'].map((bis) => (
                <Pressable
                  key={bis}
                  onPress={() => oeffneBabysitter(bis)}
                  accessibilityRole="button"
                  accessibilityLabel={`Zugang bis ${bis} öffnen`}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>bis {bis}</Text>
                </Pressable>
              ))}
            </View>
            {babysitterToken ? (
              <Text style={styles.checkSub} selectable>
                Anmeldung: Benutzer «{babysitterKonto(babysitterName)}», Token{' '}
                {babysitterToken}
              </Text>
            ) : null}
            {/* Die bestehenden Zugänge – offen wie geschlossen. */}
            {babysitterKonten.map((konto: FamilyItem) => (
              <View key={String(konto.name)} style={styles.checkRow}>
                <Ionicons
                  name={konto.enabled ? 'lock-open-outline' : 'lock-closed-outline'}
                  size={16}
                  color={konto.enabled ? colors.on : colors.inkFaint}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkText}>
                    {babysitterVorname(konto) || 'Babysitter'}
                  </Text>
                  <Text style={styles.checkSub}>
                    {konto.enabled
                      ? `offen bis ${konto.hours?.to ?? '?'} Uhr`
                      : 'geschlossen'}
                  </Text>
                </View>
                {konto.enabled ? (
                  <>
                    {/* Punkt 185: Wenn es später wird, statt den Zugang
                        neu anzulegen. */}
                    <Pressable
                      onPress={() => verlaengereBabysitter(konto)}
                      accessibilityRole="button"
                      accessibilityLabel="Noch eine Stunde"
                      style={styles.chip}
                    >
                      <Text style={styles.chipText}>+1 h</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => schliesseBabysitter(String(konto.name))}
                      accessibilityRole="button"
                      accessibilityLabel={`Zugang von ${konto.name} schliessen`}
                      style={styles.deleteTap}
                    >
                      <Ionicons name="close" size={18} color={colors.danger} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            ))}
          </Card>
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
          {/* Punkt 214: Die Abendroutine steht schon im System – hier
              wird sie verknüpft statt abgetippt. */}
          {routinen.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.formHintSmall}>Abendablauf (aus den Routinen)</Text>
              <View style={styles.chipRow}>
                {routinen.map((routine: FamilyItem) => {
                  const aktiv = abend.routine_id === routine.id;
                  return (
                    <Pressable
                      key={routine.id}
                      onPress={() => {
                        const wert = aktiv ? null : routine.id;
                        if (abend.id) update('babysitter', abend.id, { routine_id: wert });
                        else add('babysitter', { text: 'Heute Abend', routine_id: wert });
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: aktiv }}
                      style={[styles.chip, aktiv && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>
                        {routine.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </Card>

        {/* Punkt 214: Ist eine Routine gewählt, steht sie gross da – so
            genau, wie die Familie den Abend selbst lebt. */}
        {abendRoutine ? (
          <>
            <Text style={styles.groupLabel}>Abendablauf</Text>
            <Card style={styles.listCard}>
              <Text style={styles.checkText}>{abendRoutine.text}</Text>
              {abendRoutine.body ? (
                <Text style={styles.checkSub} selectable>
                  {abendRoutine.body}
                </Text>
              ) : null}
            </Card>
          </>
        ) : null}

        {/* Punkt 186: «Wann ist sie eingeschlafen? Hat er gegessen?» wird
            am Türrahmen gefragt und halb vergessen. */}
        <Text style={styles.groupLabel}>Wie war der Abend?</Text>
        <Card style={styles.listCard}>
          <View style={styles.chipRow}>
            {PROTOKOLL_ZEILEN.map((zeile) => (
              <Pressable
                key={zeile}
                onPress={() => {
                  const neu = protokollZeile(String(abend.log ?? ''), zeile, new Date());
                  if (abend.id) update('babysitter', abend.id, { log: neu });
                  else add('babysitter', { text: 'Heute Abend', log: neu });
                }}
                accessibilityRole="button"
                style={styles.chip}
              >
                <Ionicons name="add" size={13} color={colors.inkSoft} />
                <Text style={styles.chipText}>{zeile}</Text>
              </Pressable>
            ))}
          </View>
          {abend.log ? (
            <>
              <Text style={styles.checkSub} selectable>
                {abend.log}
              </Text>
              <Pressable
                onPress={() => update('babysitter', abend.id, { log: '' })}
                accessibilityRole="button"
                style={styles.clearButton}
              >
                <Text style={styles.resetText}>Protokoll leeren</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.hint}>
              Ein Tipp schreibt die Zeile mit Uhrzeit – für die Eltern beim
              Heimkommen und fürs nächste Mal.
            </Text>
          )}
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

        <Notrufliste styles={styles} colors={colors} />

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
    const heute = new Date();

    /** Anrufen – und den Kontakt dabei als benutzt vermerken (Punkt 211). */
    const anrufen = (contact: FamilyItem, nummer: string) => {
      if (!nummer) return;
      update('contacts', contact.id, { last_used: isoTag(new Date()) });
      Linking.openURL(`tel:${waehlbar(nummer)}`);
    };

    /** Einen Kontakt als vCard weitergeben (Punkt 181). */
    const weitergeben = (contact: FamilyItem) => {
      const zeilen = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${String(contact.text ?? '')}`,
        ...nummernVon(contact).map((e) => `TEL;TYPE=CELL:${e.nummer}`),
        contact.email ? `EMAIL:${contact.email}` : '',
        contact.address ? `ADR;TYPE=HOME:;;${String(contact.address).replace(/,/g, ';')}` : '',
        contact.note ? `NOTE:${String(contact.note)}` : '',
        'END:VCARD',
      ].filter(Boolean);
      Share.share({ message: zeilen.join('\n') });
    };

    /** Aus dem Telefonbuch des Geräts übernehmen (Punkt 179). */
    const ausTelefonbuch = async (): Promise<{ name: string; phone: string } | null> => {
      try {
        // Erst hier laden: Im Browser gibt es das Modul nicht, und die
        // Seite soll deswegen nicht schon beim Öffnen scheitern.
        const Contacts = await import('expo-contacts');
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') return null;
        const gewaehlt = await Contacts.presentContactPickerAsync();
        if (!gewaehlt) return null;
        return {
          name: String(gewaehlt.name ?? ''),
          phone: String(gewaehlt.phoneNumbers?.[0]?.number ?? ''),
        };
      } catch {
        return null;
      }
    };
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

        {/* Punkt 212: Angerufen werden immer dieselben drei. */}
        {schnellwahl(contacts).length > 0 ? (
          <Card style={styles.listCard}>
            <View style={styles.schnellRow}>
              {schnellwahl(contacts).map((contact) => (
                <Pressable
                  key={contact.id}
                  onPress={() => anrufen(contact, nummernVon(contact)[0]?.nummer)}
                  style={styles.schnellKnopf}
                  accessibilityRole="button"
                  accessibilityLabel={`${contact.text} anrufen`}
                >
                  <ContactPhoto contact={contact} size={54} styles={styles} />
                  <Text style={styles.schnellName} numberOfLines={1}>
                    {String(contact.text ?? '').split(' ')[0]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>
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
              onImport={ausTelefonbuch}
              onCancel={() => setKontaktBearbeitet(null)}
              onSave={(werte) => {
                update('contacts', contact.id, {
                  text: werte.text,
                  phone: werte.phone,
                  phone2: werte.phone2,
                  birthday: werte.birthday,
                  roles: werte.roles,
                  email: werte.email,
                  address: werte.address,
                  note: werte.note,
                  hours: werte.hours,
                  favorite: werte.favorite,
                  // Wer den Kontakt anfasst, hat ihn geprüft (Punkt 182).
                  checked: isoTag(new Date()),
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
                onPress={() => anrufen(contact, nummernVon(contact)[0]?.nummer)}
                accessibilityRole="button"
                accessibilityLabel={`${contact.text} anrufen`}
              >
                <Text style={styles.contactName}>{contact.text}</Text>
                {nummernVon(contact).map((eintrag) => (
                  <Text key={eintrag.nummer} style={styles.checkSub}>
                    {eintrag.nummer}
                  </Text>
                ))}
                {/* Punkt 210: Bei der Praxis landet man mittwochs sonst
                    auf dem Band. */}
                {(() => {
                  const status = oeffnungsStatus(contact.hours, heute);
                  return status ? (
                    <Text
                      style={[
                        styles.checkSub,
                        status.offen ? { color: colors.on, fontWeight: '600' } : null,
                      ]}
                    >
                      {status.text}
                    </Text>
                  ) : null;
                })()}
                {contact.address ? (
                  <Text style={styles.checkSub}>📍 {contact.address}</Text>
                ) : null}
                {contact.email ? (
                  <Text style={styles.checkSub}>✉️ {contact.email}</Text>
                ) : null}
                {contact.note ? (
                  <Text style={styles.checkSub}>{contact.note}</Text>
                ) : null}
                {birthdayLabel(contact.birthday) ? (
                  <Text style={styles.checkSub}>🎂 {birthdayLabel(contact.birthday)}</Text>
                ) : null}
                {/* Punkt 182: Eine falsche Nummer merkt man sonst genau
                    dann, wenn man sie braucht. */}
                {kontaktVeraltet(contact, heute) ? (
                  <Text style={[styles.checkSub, { color: colors.warn }]}>
                    Seit zwei Jahren unangetastet – stimmt das noch?
                  </Text>
                ) : null}
              </Pressable>

              <View style={{ gap: 6, alignItems: 'center' }}>
                <Pressable
                  onPress={() => anrufen(contact, nummernVon(contact)[0]?.nummer)}
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
                {/* Punkt 178: Die Adresse ist erst dann nützlich, wenn
                    sie zur Route führt. */}
                {contact.address ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `http://maps.apple.com/?daddr=${encodeURIComponent(
                          String(contact.address)
                        )}`
                      )
                    }
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Route zu ${contact.text}`}
                  >
                    <Ionicons name="navigate-outline" size={18} color={colors.inkSoft} />
                  </Pressable>
                ) : null}
                {/* Punkt 181: «Schick mir die Nummer der Kinderärztin». */}
                <Pressable
                  onPress={() => weitergeben(contact)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${contact.text} weitergeben`}
                >
                  <Ionicons name="share-outline" size={18} color={colors.inkSoft} />
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
            onImport={ausTelefonbuch}
            onSave={(werte) =>
              add('contacts', {
                text: werte.text,
                phone: werte.phone,
                ...(werte.phone2 ? { phone2: werte.phone2 } : {}),
                ...(werte.photo ? { photo: werte.photo } : {}),
                ...(werte.birthday ? { birthday: werte.birthday } : {}),
                ...(werte.roles.length > 0 ? { roles: werte.roles } : {}),
                ...(werte.email ? { email: werte.email } : {}),
                ...(werte.address ? { address: werte.address } : {}),
                ...(werte.note ? { note: werte.note } : {}),
                ...(Object.keys(werte.hours).length > 0 ? { hours: werte.hours } : {}),
                ...(werte.favorite ? { favorite: true } : {}),
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
            const { neu, mehr } = ingredientsToShopping(
              [recipe],
              (data.shopping ?? []) as FamilyItem[],
              faktor
            );
            neu.forEach((eintrag) => add('shopping', { ...eintrag, done: false }));
            // Was schon draufliegt, bekommt die Menge dazugezählt: Zwei
            // Rezepte mit Milch heissen 600 ml, nicht 400.
            mehr.forEach((eintrag) =>
              update('shopping', eintrag.id, { amount: eintrag.amount })
            );
            return neu.length + mehr.length;
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

  // Punkt 205: Wer keine Medikamente verwaltet und keine Packlisten
  // führt, scrollt trotzdem jeden Tag daran vorbei.
  const sichtbareModule = orderedModules.filter(
    (module) => ordnen || !versteckteModule.includes(module.key)
  );
  const versteckt = orderedModules.length - sichtbareModule.length;
  // Punkt 168: Wo hat sich etwas getan, seit ich zuletzt hingeschaut habe?
  const neues = neuSeit(data, gesehen, currentUser?.name ?? '');
  // Punkt 166: «Wo stand nochmal die Nummer vom Kaminfeger?»
  const treffer = suche(data, suchtext);

  const oeffneModul = (key: ModuleKey) => {
    merkeGesehen(key);
    setView(key);
  };

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
      {standZeile}

      {/* Punkt 166: Eine Suche über alle Listen – siebzehn Module sind zu
          viele, um sie der Reihe nach durchzugehen. */}
      <View style={styles.suchRow}>
        <Ionicons name="search-outline" size={16} color={colors.inkSoft} />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={suchtext}
          onChangeText={setSuchtext}
          placeholder="Über alle Listen suchen …"
          placeholderTextColor={colors.inkFaint}
        />
        {suchtext ? (
          <Pressable onPress={() => setSuchtext('')} accessibilityLabel="Suche leeren">
            <Ionicons name="close" size={18} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>
      {suchtext.trim().length >= 2 ? (
        treffer.length === 0 ? (
          <Text style={styles.hint}>Nichts gefunden.</Text>
        ) : (
          treffer.map((gruppe) => (
            <Card key={gruppe.collection} style={styles.listCard}>
              <Text style={styles.groupTitle}>{gruppe.label}</Text>
              {gruppe.treffer.map((eintrag, index) => (
                <Pressable
                  key={`${eintrag.item.id ?? index}`}
                  onPress={() => {
                    setSuchtext('');
                    oeffneModul(gruppe.collection as ModuleKey);
                  }}
                  accessibilityRole="button"
                  style={styles.checkRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trefferTitel}>{trefferName(eintrag.item)}</Text>
                    {eintrag.fundstelle ? (
                      <Text style={styles.trefferSub} numberOfLines={1}>
                        {eintrag.fundstelle}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                </Pressable>
              ))}
            </Card>
          ))
        )
      ) : null}

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

      {/* Punkt 196: «Wer ist da?» ist die meistgestellte Frage im
          Haushalt – sie stand bisher als Gerätekachel zwischen Lampen und
          Storen. Ohne Karte, ohne Meterangaben. */}
      {anwesend.length > 0 ? (
        <Card style={styles.listCard}>
          <Text style={styles.groupTitle}>{anwesenheitKurz(anwesend)}</Text>
          {anwesend.map((person, index) => (
            <Text key={String(person.zone ?? index)} style={styles.checkSub}>
              {anwesenheitsZeile(person, new Date())}
            </Text>
          ))}
          {/* Punkt 219: «Warum steht da weg?» – das Gegenstück zur
              Ablauf-Diagnose. Der halbe Support-Fall beantwortet sich
              damit selbst. */}
          <Pressable
            onPress={async () => {
              if (ortungsDiagnose) {
                setOrtungsDiagnose(null);
                return;
              }
              const antwort = await hub.get<{ people: Record<string, unknown>[] } | null>(
                '/api/presence/diagnose',
                { fallback: null, still: true }
              );
              setOrtungsDiagnose(antwort?.people ?? []);
            }}
            accessibilityRole="button"
            style={styles.clearButton}
          >
            <Text style={styles.resetText}>
              {ortungsDiagnose ? 'Diagnose schliessen' : 'Warum steht da das?'}
            </Text>
          </Pressable>
          {(ortungsDiagnose ?? []).map((zeile, index) => (
            <View key={String(zeile.zone ?? index)} style={{ gap: 2 }}>
              <Text style={styles.checkText}>{String(zeile.person ?? '?')}</Text>
              <Text style={styles.checkSub}>
                {String(zeile.hint ?? '')} · Quelle: {String(zeile.combined_source ?? '?')}
                {zeile.battery != null ? ` · Akku ${String(zeile.battery)} %` : ''}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

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

      {/* Punkt 171: Am Kühlschrank hängt ein iPad, und es zeigt die
          Geräte. Für den Alltag interessanter ist dort die Familie –
          gross genug für zwei Meter Abstand und ohne Bedienelemente. */}
      {settings.panel && !suchtext ? (
        <Card style={styles.panelCard}>
          <Text style={styles.panelTitel}>HEUTE</Text>
          {events.filter((event) => isToday(event.start)).length === 0 ? (
            <Text style={styles.panelKlein}>Keine Termine.</Text>
          ) : (
            events
              .filter((event) => isToday(event.start))
              .slice(0, 4)
              .map((event, index) => (
                <Text key={String(event.id ?? index)} style={styles.panelZeile}>
                  {eventWhen(event)} · {event.summary}
                </Text>
              ))
          )}
          <Text style={styles.panelTitel}>ES GIBT</Text>
          <Text style={styles.panelZeile}>
            {String(
              (data.meals ?? []).find(
                (meal: FamilyItem) =>
                  meal.day === WEEK_DAYS[(new Date().getDay() + 6) % 7]
              )?.text ?? 'noch nichts geplant'
            )}
          </Text>
          <Text style={styles.panelTitel}>ÄMTLI HEUTE</Text>
          <Text style={styles.panelKlein}>
            {chores
              .filter((chore: FamilyItem) => dueInfo(chore.due)?.overdue)
              .map((chore: FamilyItem) => `${chore.text} – ${chore.member ?? '?'}`)
              .join('   ·   ') || 'nichts fällig'}
          </Text>
          <Text style={styles.panelTitel}>EINKAUFEN</Text>
          <Text style={styles.panelKlein}>
            {(data.shopping ?? [])
              .filter((item: FamilyItem) => !item.done)
              .slice(0, 8)
              .map((item: FamilyItem) => String(item.text))
              .join(', ') || 'nichts offen'}
          </Text>
        </Card>
      ) : null}

      {/* Module */}
      <View style={styles.tileRow}>
        {sichtbareModule.map((module) => {
          const aus = versteckteModule.includes(module.key);
          return (
            <Card
              key={module.key}
              style={{ ...styles.moduleTile, ...(aus ? { opacity: 0.4 } : {}) }}
              onPress={() =>
                ordnen ? toggleModul(module.key) : oeffneModul(module.key)
              }
            >
              <Ionicons
                name={ordnen ? (aus ? 'eye-off-outline' : 'eye-outline') : module.icon}
                size={24}
                color={colors.accent}
              />
              <Text style={styles.moduleLabel}>{module.label}</Text>
              <Text style={styles.moduleSub} numberOfLines={1}>
                {ordnen ? (aus ? 'ausgeblendet' : 'sichtbar') : module.sub}
              </Text>
              {/* Punkt 168: Ein Punkt sagt, wo etwas dazugekommen ist. */}
              {!ordnen && neues[module.key] ? <View style={styles.neuPunkt} /> : null}
            </Card>
          );
        })}
      </View>
      {versteckt > 0 || ordnen ? (
        <Pressable
          onPress={() => setOrdnen(!ordnen)}
          accessibilityRole="button"
          style={styles.clearButton}
        >
          <Text style={styles.resetText}>
            {ordnen
              ? 'Fertig'
              : `${versteckt} ausgeblendete anzeigen`}
          </Text>
        </Pressable>
      ) : null}
      {!ordnen && versteckt === 0 ? (
        <Pressable
          onPress={() => setOrdnen(true)}
          accessibilityRole="button"
          style={styles.clearButton}
        >
          <Text style={styles.resetText}>Kacheln ausblenden</Text>
        </Pressable>
      ) : null}

      {/* Punkt 169: Eine Seite, die auch ohne HomePilot noch aufgeht –
          zum Ansehen, Drucken oder Weitergeben. Der Hub legt sie
          monatlich neben die Sicherungen. */}
      <Pressable
        onPress={() =>
          Linking.openURL(
            `${settings.url.replace(/\/+$/, '')}/api/family-book?token=${encodeURIComponent(
              settings.token
            )}`
          )
        }
        accessibilityRole="button"
        style={styles.clearButton}
      >
        <Text style={styles.resetText}>Familienbuch ansehen</Text>
      </Pressable>

      {/* Punkt 167: Ein Fehlgriff neben dem Häkchen löschte bis jetzt
          endgültig – die Abläufe hatten seit je einen Papierkorb. */}
      {korb.length > 0 ? (
        <Pressable
          onPress={() => setKorbOffen(!korbOffen)}
          accessibilityRole="button"
          style={styles.clearButton}
        >
          <Text style={styles.resetText}>
            {korbOffen ? 'Papierkorb schliessen' : `Papierkorb (${korb.length})`}
          </Text>
        </Pressable>
      ) : null}
      {korbOffen ? (
        <Card style={styles.listCard}>
          <Text style={styles.groupTitle}>Zuletzt gelöscht</Text>
          {korb.slice(0, 20).map((row, index) => (
            <View key={`${row.kind}-${index}`} style={styles.checkRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>{String(row.name ?? '?')}</Text>
                <Text style={styles.checkSub}>
                  {String(row.kind ?? '')} · von {String(row.by ?? '?')}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  await hub.post(
                    `/api/family-trash/${row.kind}/${(row.item ?? {}).id}/restore`,
                    {},
                    { fallback: null, still: true }
                  );
                  ladeKorb();
                  load();
                }}
                accessibilityRole="button"
                accessibilityLabel="Zurückholen"
                style={styles.chip}
              >
                <Text style={styles.chipText}>Zurück</Text>
              </Pressable>
            </View>
          ))}
          <Text style={styles.hint}>
            Gelöschtes bleibt dreissig Tage liegen und verschwindet dann von
            selbst.
          </Text>
        </Card>
      ) : null}

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

