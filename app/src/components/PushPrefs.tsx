import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import { nachGruppen } from '../lib/pushgruppen';
import {
  RUHE_AUS,
  type Ruhezeit,
  STUNDEN,
  WOCHENTAGE,
  ruhesatz,
  stillsatz,
  tageOrdnen,
  uhr,
  verpasstsatz,
} from '../lib/pushruhe';
import { eigenerPushToken } from '../hooks/usePushRegistration';
import { epochTime } from '../lib/zeit';
import { Colors, type, useColors } from '../theme';

/**
 * Welche Push-Nachrichten dieser Benutzer bekommen will.
 *
 * Je Person, nicht global: Wen die schwache Batterie im Keller nicht
 * interessiert, der soll deswegen nicht den Alarm mit abschalten. Und
 * bewusst als «abbestellen» statt «bestellen» – eine neue Nachrichtenart
 * kommt damit erst einmal an, statt unbemerkt zu fehlen.
 *
 * Hier steht deshalb *nur* das Abbestellen. Wann und ab wann der Hub
 * überhaupt meldet - die Schwelle der Batterie, die Tage vor einem
 * verfallenden Gutschein -, steht bei der Nachricht selbst, unter
 * «Abläufe → Push» (components/PushRules.tsx). Beides stand einmal
 * hier: zwei Bildschirme entfernt von der Regel, die es betrifft, und
 * unter einer Überschrift, die «für mich» heisst, während die
 * Einstellung fürs ganze Haus gilt.
 */

type Stufe = 'leise' | 'dringend' | 'kritisch';

const STUFEN_WORT: Record<Stufe, string> = {
  leise: 'Darf warten',
  dringend: 'Sofort',
  kritisch: 'Kritisch',
};

/** Eine Empfängergruppe (Punkt 513): «Eltern» statt zwei Namen in
 *  jedem Ablauf. Gepflegt hier, weil sie zu den Nachrichten gehört. */
interface Gruppe {
  name: string;
  members: string[];
}

interface Category {
  key: string;
  label: string;
  /** Unterkategorie, wie der Hub sie vergibt (core/push.py). */
  group?: string;
  /** Titel und Text, wie sie im Ernstfall dastehen (core/pushbeispiel.py). */
  beispiel?: [string, string] | null;
  /** Kommt sofort durch, auch im Fokus – oder darf warten. */
  dringend?: boolean;
  /** Die Stufe fürs Haus (Punkt 512): leise, dringend oder kritisch -
   *  und daneben die eingebaute, für «zurück auf Standard». */
  stufe?: Stufe;
  stufe_standard?: Stufe;
  /** Lässt sich nicht stillstellen (Alarm, Wasser, Klingel, weinendes Kind). */
  immer?: boolean;
  /** Bis wann stillgestellt, in Unix-Sekunden. */
  still_bis?: number | null;
  /** Wie viele Meldungen dieser Art der Hub am Tag höchstens schickt. */
  deckel?: number | null;
}

/** Die Kategorien in ihre Unterkategorien, wie der Hub sie vergibt.
 *
 * «test» absichtlich nirgends: Der Test kommt immer an, ein Schalter
 * dafür wäre eine Attrappe. Das Sortieren selbst steht in
 * lib/pushgruppen.ts – dieselbe Einteilung braucht die Liste unter
 * «Abläufe → Push». */
export function groupCategories(
  categories: Category[],
  order: string[] = []
): { title: string; items: Category[] }[] {
  return nachGruppen(
    categories.filter((category) => category.key !== 'test'),
    order
  );
}

/**
 * Die Kategorien zu einer Suche (rein, testbar) - Punkt 477 der Werkbank.
 *
 * Über vierzig Kategorien in acht Gruppen: Wer etwas abstellen will,
 * sucht - und schaltet im Zweifel die ganze Gruppe ab, in der auch das
 * Wichtige steckt. Gesucht wird in dem, was dasteht: Beschriftung,
 * Gruppe und das Beispiel, denn oft erinnert man den Satz auf dem
 * Sperrbildschirm und nicht den Namen der Kategorie.
 *
 * Leere Suche heisst alles - ein Filter, der nichts findet, wäre bei
 * leerem Feld die schlechteste aller Antworten.
 */
export function passtZurSuche(category: Category, frage: string): boolean {
  const gesucht = String(frage ?? '').trim().toLowerCase();
  if (!gesucht) return true;
  return [category.label, category.group, ...(category.beispiel ?? [])]
    .map((teil) => String(teil ?? '').toLowerCase())
    .some((teil) => teil.includes(gesucht));
}

export function PushPrefs({
  settings,
  onZiel,
}: {
  settings: HubSettings;
  /** Einen Eintrag des Posteingangs öffnen (Punkt 472 der Werkbank).
   *  Fehlt er, bleiben die Zeilen Zeilen - ein Tipp, der nichts tut,
   *  ist schlimmer als keiner. */
  onZiel?: (ziel: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Der Test gehört zu den Benachrichtigungen - wer hier einstellt, will
  // gleich wissen, ob überhaupt etwas ankommt, ohne zum System-Screen zu
  // wechseln.
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  // Zu: Die Karte listet dreizehn Schalter, die man einmal einstellt und
  // dann jahrelang nicht anfasst. Aufgeklappt schiebt sie alles darunter
  // aus dem Bild - unter «Konto & Verbindung» sucht man aber meist die
  // Hub-Adresse, nicht die Batteriewarnung.
  const [offen, setOffen] = useState(false);
  // Der Nachlese-Zettel: die letzten Meldungen, auch die weggewischten.
  const [logOffen, setLogOffen] = useState(false);
  const [log, setLog] = useState<
    {
      title: string;
      body: string;
      at: number;
      category?: string | null;
      /** Warum sie nicht gebrummt hat – Ruhezeit, stillgestellt, Deckel. */
      held?: string | null;
      /** Ob genau diese Person sie deswegen nie gehört hat. */
      verpasst?: boolean;
      /** Wohin ein Tipp führt (core/pushziel.py) – Punkt 472. */
      ziel?: string | null;
      /** Was der Push-Dienst beanstandet hat (Punkt 475). Leer heisst
       *  zugestellt; eine Zeile hier heisst: Es sah aus wie gemeldet,
       *  und niemand hat etwas gehört. */
      nicht_zugestellt?: string[] | null;
    }[] | null
  >(null);
  // Die eigene Nachtruhe. Der Hub hält sie je Person (core/pushruhe.py);
  // was nie zurückgehalten wird, entscheidet ebenfalls er – eine
  // Ruhezeit, die den Wasseralarm verschluckt, wäre ein Fehler.
  const [ruhe, setRuhe] = useState<Ruhezeit>(RUHE_AUS);
  // Wie lange «Später» in der Mitteilung heisst (Punkt 514). Der Hub
  // hält die Zahl je Person; der Knopf selbst trägt keine mehr.
  const [snoozeMinuten, setSnoozeMinuten] = useState(30);
  const [snoozeWahl, setSnoozeWahl] = useState<number[]>([15, 30, 60, 120]);
  // Die Stufen fürs Haus darf ändern, wer die Einstellungen ändern darf;
  // dasselbe gilt für die Empfängergruppen.
  const [darfStufen, setDarfStufen] = useState(false);
  const [kritischErlaubt, setKritischErlaubt] = useState(false);
  const [gruppen, setGruppen] = useState<Gruppe[]>([]);
  const [gruppenOffen, setGruppenOffen] = useState(false);
  const [neueGruppe, setNeueGruppe] = useState('');
  // Wer Mitglied sein kann: dieselbe Liste wie die Empfänger im Ablauf-Editor.
  const [namen, setNamen] = useState<string[]>([]);
  const [ruheOffen, setRuheOffen] = useState(false);
  // Welche Kategorie gerade aufgeklappt ist (Vorschau, Test, stillstellen).
  // Eine, nicht mehrere: Aufgeklappt ist die Liste sonst zwei Bildschirme
  // lang, und man sucht den Schalter, den man eben noch sah.
  const [detail, setDetail] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ key: string; text: string } | null>(null);
  // Der eigene Push-Token (Punkt 471 der Werkbank) - ohne ihn steht die
  // Wahl «nur auf diesem Gerät» nicht da, und alles gilt wie vorher für
  // alle Geräte der Person.
  const [eigenerToken, setEigenerToken] = useState<string | null>(null);
  // Gilt das, was hier eingestellt wird, nur für dieses Gerät?
  const [nurHier, setNurHier] = useState(false);
  // Hat dieses Gerät schon eine eigene Einstellung? Der Hub sagt es -
  // sonst sähe «Ruhezeit aus» am iPad gleich aus, ob sie dort
  // abgeschaltet wurde oder überall.
  const [geraetEigen, setGeraetEigen] = useState(false);
  // Wie viele Meldungen es zum Nachlesen gibt (Punkt 472).
  const [suchtext, setSuchtext] = useState('');

  useEffect(() => {
    eigenerPushToken().then(setEigenerToken);
  }, []);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Die Karte zeigt Fehler selbst an - deshalb «still».
    hub
      .get<{
        categories?: Category[];
        groups?: string[];
        muted?: string[];
        ruhe?: Ruhezeit;
        geraet_eigen?: boolean;
        snooze_minutes?: number;
        snooze_wahl?: number[];
        darf_stufen?: boolean;
        critical_alerts?: boolean;
        empfaengergruppen?: Gruppe[];
      }>(
        // Mit dem eigenen Token holt der Hub die Sicht *dieses* Geräts
        // (Punkt 471); ohne ihn die der Person, wie bisher.
        nurHier && eigenerToken
          ? `/api/push/categories?token=${encodeURIComponent(eigenerToken)}`
          : '/api/push/categories',
        { still: true }
      )
      .then((data) => {
        setCategories(data.categories ?? []);
        setGroupOrder(data.groups ?? []);
        setMuted(data.muted ?? []);
        setRuhe(data.ruhe ?? RUHE_AUS);
        setGeraetEigen(data.geraet_eigen === true);
        setSnoozeMinuten(data.snooze_minutes ?? 30);
        if (data.snooze_wahl?.length) setSnoozeWahl(data.snooze_wahl);
        setDarfStufen(Boolean(data.darf_stufen));
        setKritischErlaubt(Boolean(data.critical_alerts));
        setGruppen(data.empfaengergruppen ?? []);
        if (data.darf_stufen) {
          hub
            .get<{ names?: string[] } | null>('/api/push/targets', { fallback: null, still: true })
            .then((ziele) => setNamen(ziele?.names ?? []))
            .catch(() => setNamen([]));
        }
      })
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [hub, nurHier, eigenerToken]);

  // Erst laden, wenn jemand hinsieht: Zugeklappt ist die Antwort des
  // Hubs nichts wert, und beim Öffnen der Einstellungen laufen ohnehin
  // schon genug Abfragen los.
  useEffect(() => {
    if (offen) load();
  }, [offen, load]);

  const toggle = async (key: string) => {
    const next = muted.includes(key)
      ? muted.filter((entry) => entry !== key)
      : [...muted, key];
    // Sofort umschalten, damit das Antippen nicht hakt; der Hub bestätigt.
    setMuted(next);
    try {
      const data = await hub.put<{ muted?: string[] }>(
        '/api/push/categories',
        // Nur für dieses Gerät, wenn «nur hier» gewählt ist (Punkt 471).
        { muted: next, token: nurHier ? (eigenerToken ?? '') : '' },
        { still: true }
      );
      setMuted(data.muted ?? next);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  const snoozeSetzen = async (minuten: number) => {
    setSnoozeMinuten(minuten);
    try {
      const data = await hub.put<{ snooze_minutes?: number }>(
        '/api/push/categories',
        { muted, snooze_minutes: minuten },
        { still: true }
      );
      setSnoozeMinuten(data.snooze_minutes ?? minuten);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  // Die Stufe einer Kategorie fürs Haus (Punkt 512). Sofort in der Liste,
  // der Hub bestätigt - wie beim Abbestellen.
  const stufeSetzen = async (key: string, stufe: Stufe) => {
    setCategories((alte) =>
      (alte ?? []).map((eintrag) =>
        eintrag.key === key ? { ...eintrag, stufe, dringend: stufe !== 'leise' } : eintrag
      )
    );
    try {
      await hub.put('/api/push/stufe', { category: key, stufe }, { still: true });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  // Die Empfängergruppen als Ganzes speichern - die Liste ist klein, und
  // ein Stand statt drei Einzeloperationen lässt sich nicht halb speichern.
  const gruppenSpeichern = async (naechste: Gruppe[]) => {
    setGruppen(naechste);
    try {
      const data = await hub.put<{ groups?: Gruppe[] }>(
        '/api/push/gruppen',
        { groups: naechste },
        { still: true }
      );
      setGruppen(data.groups ?? naechste);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  // Die Ruhezeit sofort umschalten und den Hub bestätigen lassen –
  // dasselbe Muster wie beim Abbestellen darüber.
  const ruheSetzen = async (naechste: Ruhezeit) => {
    setRuhe(naechste);
    try {
      const data = await hub.put<{ ruhe?: Ruhezeit }>(
        '/api/push/ruhe',
        {
          enabled: naechste.enabled,
          von: naechste.from,
          bis: naechste.to,
          tage: tageOrdnen(naechste.days),
          // Für dieses Gerät, wenn es eine eigene Ruhezeit führt
          // (Punkt 471) - sonst für mich überall, wie bisher.
          token: nurHier ? (eigenerToken ?? '') : '',
        },
        { still: true }
      );
      if (data.ruhe) setRuhe(data.ruhe);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  // «Heute nicht mehr» – und es läuft von selbst ab. Der Unterschied zum
  // Abbestellen ist der ganze Zweck: Wer im September den Trockner
  // abbestellt, merkt es im März nicht mehr.
  const stillstellen = async (key: string, stunden: number) => {
    try {
      const data = await hub.post<{ still_bis?: number | null }>(
        '/api/push/still',
        { category: key, stunden },
        { still: true }
      );
      setCategories((war) =>
        (war ?? []).map((eintrag) =>
          eintrag.key === key
            ? { ...eintrag, still_bis: data.still_bis ?? null }
            : eintrag
        )
      );
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  // Genau diese Art Meldung ans eigene Telefon – mit ihren Knöpfen,
  // ihrer Dringlichkeit und durch die eigenen Einstellungen hindurch.
  // Der allgemeine Test daneben beantwortet nur «kommt überhaupt etwas
  // an?»; die häufigere Frage ist «warum kommt ausgerechnet das nicht?».
  const kategorieTesten = async (key: string) => {
    setProbe({ key, text: 'Sendet …' });
    try {
      const data = await hub.post<{
        sent?: number;
        warum?: string | null;
        errors?: string[];
      }>(`/api/push/test/${encodeURIComponent(key)}`, undefined, { still: true });
      const problems = Array.isArray(data.errors) ? data.errors : [];
      const text = problems.length
        ? problems.join(' ')
        : data.warum
          ? `Kam nicht an: ${data.warum}.`
          : Number(data.sent ?? 0) > 0
            ? `Zugestellt an ${data.sent} Gerät(e).`
            : 'Kein Gerät angemeldet.';
      setProbe({ key, text });
    } catch (err) {
      setProbe({ key, text: String(err instanceof Error ? err.message : err) });
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      const data = await hub.post<{ sent?: number; errors?: string[] }>(
        '/api/push/test',
        undefined,
        { still: true }
      );
      const problems: string[] = Array.isArray(data.errors) ? data.errors : [];
      if (problems.length > 0) {
        setTestNote(problems.join(' '));
      } else if (Number(data.sent ?? 0) > 0) {
        setTestNote(`Zugestellt an ${data.sent} Gerät(e).`);
      } else {
        setTestNote('Kein Gerät angemeldet – die App auf dem Telefon einmal öffnen.');
      }
    } catch (err) {
      setTestNote(String(err instanceof Error ? err.message : err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOffen((war) => !war)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        style={({ pressed }) => [styles.headRow, pressed && { opacity: 0.8 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Benachrichtigungen</Text>
          <Text style={styles.hint}>
            Was auf dein Telefon kommt – gilt nur für dich.
          </Text>
        </View>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.inkFaint}
        />
      </Pressable>

      {!offen ? null : (
      <>
      <View style={styles.headRow}>
        <Text style={styles.hint}>
          Gilt nur für dich – andere im Haushalt stellen es für sich ein.
        </Text>
        <Pressable
          onPress={runTest}
          disabled={testing}
          accessibilityRole="button"
          style={({ pressed }) => [styles.testButton, (pressed || testing) && { opacity: 0.7 }]}
        >
          <Ionicons name="paper-plane-outline" size={14} color={colors.ink} />
          <Text style={styles.testText}>{testing ? 'Sendet …' : 'Push testen'}</Text>
        </Pressable>
      </View>
      {testNote ? <Text style={styles.hint}>{testNote}</Text> : null}

      {/* Die Nachtruhe. Sie steht vor der Liste, nicht dahinter: Sie
          betrifft jede Zeile darunter, und wer sie sucht, sucht sie
          zuerst. Was nie zurückgehalten wird – Alarm, Wasser, Klingel,
          ein weinendes Kind –, entscheidet der Hub, nicht diese Karte. */}
      <Pressable
        onPress={() => setRuheOffen((war) => !war)}
        accessibilityRole="button"
        accessibilityState={{ expanded: ruheOffen }}
        style={styles.logKopf}
      >
        <Ionicons name="moon-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.logTitel}>Ruhezeit</Text>
        <Text style={styles.hint} numberOfLines={1}>
          {ruhe.enabled ? `${uhr(ruhe.from)} – ${uhr(ruhe.to)}` : 'aus'}
        </Text>
        <Ionicons
          name={ruheOffen ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.inkSoft}
        />
      </Pressable>
      {ruheOffen ? (
        <View style={styles.ruheKasten}>
          <Pressable
            onPress={() => ruheSetzen({ ...ruhe, enabled: !ruhe.enabled })}
            accessibilityRole="switch"
            accessibilityState={{ checked: ruhe.enabled }}
            style={styles.row}
          >
            <Ionicons
              name={ruhe.enabled ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={ruhe.enabled ? colors.on : colors.inkFaint}
            />
            <Text style={styles.rowTitle}>Nachts still</Text>
          </Pressable>
          <Text style={styles.hint}>{ruhesatz(ruhe)}</Text>
          {ruhe.enabled ? (
            <>
              {(['from', 'to'] as const).map((seite) => (
                <View key={seite} style={styles.stundenBlock}>
                  <Text style={styles.stundenTitel}>
                    {seite === 'from' ? 'Ab' : 'Wieder ab'}
                  </Text>
                  <View style={styles.stundenReihe}>
                    {STUNDEN.map((stunde) => {
                      const gewaehlt = ruhe[seite] === stunde;
                      return (
                        <Pressable
                          key={stunde}
                          onPress={() => ruheSetzen({ ...ruhe, [seite]: stunde })}
                          accessibilityRole="button"
                          accessibilityState={{ selected: gewaehlt }}
                          style={[styles.stunde, gewaehlt && styles.stundeAn]}
                        >
                          <Text
                            style={[
                              styles.stundeText,
                              gewaehlt && { color: colors.ink, fontWeight: '700' },
                            ]}
                          >
                            {stunde}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              {/* An welchen Tagen (Punkt 479 der Werkbank). Bis hierher
                  war die Ruhezeit eine Zahl von-bis für die ganze Woche -
                  Samstagmorgen ist aber nicht Dienstagmorgen, und die
                  Ferienwoche keine Arbeitswoche. Keiner angetippt heisst
                  «jeden Tag»: So war sie immer, und wer nichts einstellt,
                  soll nichts verlieren. */}
              <View style={styles.stundenBlock}>
                <Text style={styles.stundenTitel}>An diesen Tagen</Text>
                <View style={styles.stundenReihe}>
                  {WOCHENTAGE.map((name, tag) => {
                    const gewaehlt = tageOrdnen(ruhe.days).includes(tag);
                    return (
                      <Pressable
                        key={name}
                        onPress={() =>
                          ruheSetzen({
                            ...ruhe,
                            days: tageOrdnen(
                              gewaehlt
                                ? (ruhe.days ?? []).filter((eintrag) => eintrag !== tag)
                                : [...(ruhe.days ?? []), tag]
                            ),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={name}
                        accessibilityState={{ selected: gewaehlt }}
                        style={[styles.stunde, gewaehlt && styles.stundeAn]}
                      >
                        <Text
                          style={[
                            styles.stundeText,
                            gewaehlt && { color: colors.ink, fontWeight: '700' },
                          ]}
                        >
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hint}>
                  Keiner angetippt heisst jeden Tag. Eine Nacht zählt zu dem Tag,
                  an dem sie beginnt – «Fr» deckt die Nacht auf Samstag ab.
                </Text>
              </View>
              <Text style={styles.hint}>
                Alarm, Wasser, Klingel, ein weinendes Kind und der Timer kommen
                trotzdem – die halten keine Ruhezeit auf.
              </Text>
              {/* Punkt 480 der Werkbank: Dass ein aktiver Fokus auch den
                  Alarm stumm stellt, stand bisher nirgends - und das ist
                  keine Technikfrage, sondern eine Sicherheitsauskunft. */}
              <Text style={styles.hint}>
                Ein «Nicht stören» des Telefons hält auch den Alarm auf. Damit er
                durchkommt, muss HomePilot dort unter «Zugelassene Mitteilungen»
                stehen – der Hub kann das nicht für dich entscheiden.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Für wen gilt das hier (Punkt 471 der Werkbank)? Wer sich mit
          Telefon und iPad anmeldet, bekam auf beiden dasselbe - auch die
          Ruhezeit. Das iPad liegt nachts im Wohnzimmer und darf
          klingeln, das Telefon liegt neben dem Bett. Steht nur da, wo
          der eigene Token bekannt ist: im Browser gibt es keinen. */}
      {eigenerToken ? (
        <View style={styles.ruheKasten}>
          <Pressable
            onPress={() => setNurHier(!nurHier)}
            accessibilityRole="switch"
            accessibilityState={{ checked: nurHier }}
            style={styles.row}
          >
            <Ionicons
              name={nurHier ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={nurHier ? colors.on : colors.inkFaint}
            />
            <Text style={styles.rowTitle}>Nur auf diesem Gerät</Text>
          </Pressable>
          <Text style={styles.hint}>
            {nurHier
              ? geraetEigen
                ? 'Dieses Gerät hat eine eigene Einstellung. Die anderen folgen weiter dir.'
                : 'Was du jetzt änderst, gilt nur hier – die anderen Geräte bleiben, wie sie sind.'
              : 'Gilt für alle deine Geräte. Für das iPad im Wohnzimmer oder das Wandpanel lohnt sich oft etwas anderes als fürs Telefon neben dem Bett.'}
          </Text>
        </View>
      ) : null}

      {/* «Später» in der Mitteilung (Punkt 514): Der Knopf hiess fest
          «In 30 Min nochmal». Am Herd meint man eine Viertelstunde, im
          Bett den Morgen - die Zahl steht jetzt hier, je Person. */}
      <View style={styles.logKopf}>
        <Ionicons name="alarm-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.logTitel}>«Später» heisst</Text>
        <View style={styles.stundenReihe}>
          {snoozeWahl.map((minuten) => {
            const gewaehlt = snoozeMinuten === minuten;
            return (
              <Pressable
                key={minuten}
                onPress={() => snoozeSetzen(minuten)}
                accessibilityRole="button"
                accessibilityState={{ selected: gewaehlt }}
                style={[styles.stunde, gewaehlt && styles.stundeAn]}
              >
                <Text
                  style={[
                    styles.stundeText,
                    gewaehlt && { color: colors.ink, fontWeight: '700' },
                  ]}
                >
                  {minuten >= 60 ? `${minuten / 60} h` : `${minuten} min`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Empfängergruppen (Punkt 513) - nur für die, die sie ändern
          dürfen; alle anderen sehen sie im Ablauf-Editor als Ziel. */}
      {darfStufen ? (
        <>
          <Pressable
            onPress={() => setGruppenOffen((war) => !war)}
            accessibilityRole="button"
            accessibilityState={{ expanded: gruppenOffen }}
            style={styles.logKopf}
          >
            <Ionicons name="people-outline" size={15} color={colors.inkSoft} />
            <Text style={styles.logTitel}>Empfängergruppen</Text>
            <Text style={styles.hint} numberOfLines={1}>
              {gruppen.length === 0 ? 'keine' : gruppen.map((g) => g.name).join(', ')}
            </Text>
            <Ionicons
              name={gruppenOffen ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={colors.inkSoft}
            />
          </Pressable>
          {gruppenOffen ? (
            <View style={styles.ruheKasten}>
              <Text style={styles.hint}>
                «Eltern» statt zwei Namen in jedem Ablauf: Eine Gruppe ist im
                Ablauf-Editor und bei den Erinnerungen ein Ziel. Kommt jemand
                dazu, ändert man die Gruppe - nicht zwanzig Abläufe.
              </Text>
              {gruppen.map((gruppe) => (
                <View key={gruppe.name} style={styles.stundenBlock}>
                  <View style={styles.logKopf}>
                    <Text style={styles.stundenTitel}>{gruppe.name}</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable
                      onPress={() =>
                        gruppenSpeichern(gruppen.filter((g) => g.name !== gruppe.name))
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Gruppe ${gruppe.name} entfernen`}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={15} color={colors.inkFaint} />
                    </Pressable>
                  </View>
                  <View style={styles.stundenReihe}>
                    {namen.map((name) => {
                      const drin = gruppe.members.includes(name);
                      return (
                        <Pressable
                          key={name}
                          onPress={() =>
                            gruppenSpeichern(
                              gruppen.map((g) =>
                                g.name === gruppe.name
                                  ? {
                                      ...g,
                                      members: drin
                                        ? g.members.filter((m) => m !== name)
                                        : [...g.members, name],
                                    }
                                  : g
                              )
                            )
                          }
                          accessibilityRole="button"
                          accessibilityState={{ selected: drin }}
                          style={[styles.stunde, drin && styles.stundeAn]}
                        >
                          <Text
                            style={[
                              styles.stundeText,
                              drin && { color: colors.ink, fontWeight: '700' },
                            ]}
                          >
                            {name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              <View style={styles.logKopf}>
                <TextInput
                  value={neueGruppe}
                  onChangeText={setNeueGruppe}
                  placeholder="Neue Gruppe, z. B. Eltern"
                  placeholderTextColor={colors.inkFaint}
                  style={styles.eingabe}
                  accessibilityLabel="Name der neuen Gruppe"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    const name = neueGruppe.trim();
                    if (!name || gruppen.some((g) => g.name === name)) return;
                    gruppenSpeichern([...gruppen, { name, members: [] }]);
                    setNeueGruppe('');
                  }}
                />
                <Pressable
                  onPress={() => {
                    const name = neueGruppe.trim();
                    if (!name || gruppen.some((g) => g.name === name)) return;
                    gruppenSpeichern([...gruppen, { name, members: [] }]);
                    setNeueGruppe('');
                  }}
                  accessibilityRole="button"
                  style={styles.testButton}
                >
                  <Ionicons name="add" size={13} color={colors.ink} />
                  <Text style={styles.testText}>Anlegen</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                Eine Gruppe ohne Mitglieder erreicht niemanden - der Hub lässt
                sie weg, bis jemand drin ist.
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Was zuletzt gemeldet wurde - eine weggewischte Mitteilung war
          bisher unauffindbar, und «was hat vorhin gebrummt?» ist genau
          die Frage, die man mit dem Telefon in der Jacke hatte. */}
      <Pressable
        onPress={() => {
          const jetzt = !logOffen;
          setLogOffen(jetzt);
          if (jetzt && log == null) {
            hub
              .get<{ log?: typeof log } | null>('/api/push/log', {
                fallback: null,
                still: true,
              })
              .then((data) => setLog(data?.log ?? []));
          }
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: logOffen }}
        style={styles.logKopf}
      >
        <Ionicons name="time-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.logTitel}>Posteingang</Text>
        <Ionicons
          name={logOffen ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.inkSoft}
        />
      </Pressable>
      {logOffen ? (
        log == null ? (
          <Text style={styles.hint}>Wird geladen …</Text>
        ) : log.length === 0 ? (
          <Text style={styles.hint}>In den letzten Tagen kam nichts.</Text>
        ) : (
          log.slice(0, 20).map((eintrag, index) => {
            // Tippbar, wo der Hub ein Ziel mitgeschickt hat (Punkt 472
            // der Werkbank): Eine weggewischte Klingel war bisher
            // endgültig weg, obwohl das Standbild im Hub liegt. Ohne
            // Ziel bleibt die Zeile eine Zeile - ein Tipp, der nichts
            // tut, ist schlimmer als keiner.
            const inhalt = (
              <>
                <Text style={styles.logZeit}>{epochTime(eintrag.at)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {eintrag.title}
                  </Text>
                  {eintrag.body ? (
                    <Text style={styles.hint} numberOfLines={2}>
                      {eintrag.body}
                    </Text>
                  ) : null}
                  {/* Der Unterschied zwischen «ich habe es übersehen» und
                      «das Haus hat es für sich behalten». Ohne diese Zeile
                      liest sich der Zettel wie das Erste, und man sucht den
                      Fehler bei sich. */}
                  {eintrag.verpasst ? (
                    <Text style={styles.verpasstMarke}>
                      {verpasstsatz(eintrag.held)}
                    </Text>
                  ) : null}
                  {/* «Angenommen» heisst nicht «angekommen» (Punkt 475).
                      Ohne diese Zeile sieht eine Meldung, die nie ein
                      Telefon erreicht hat, genauso aus wie eine, die
                      man übersehen hat. */}
                  {eintrag.nicht_zugestellt?.length ? (
                    <Text style={[styles.verpasstMarke, { color: colors.warnInk }]}>
                      Nicht zugestellt: {eintrag.nicht_zugestellt[0]}
                    </Text>
                  ) : null}
                </View>
                {eintrag.ziel ? (
                  <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
                ) : null}
              </>
            );
            if (!eintrag.ziel || !onZiel) {
              return (
                <View key={index} style={styles.logZeile}>
                  {inhalt}
                </View>
              );
            }
            return (
              <Pressable
                key={index}
                onPress={() => onZiel(eintrag.ziel as string)}
                accessibilityRole="button"
                accessibilityLabel={`${eintrag.title} öffnen`}
                style={({ pressed }) => [styles.logZeile, pressed && { opacity: 0.7 }]}
              >
                {inhalt}
              </Pressable>
            );
          })
        )
      ) : null}

      {/* Suche über die Kategorien (Punkt 477 der Werkbank). Über
          vierzig Schalter in acht Gruppen: Wer «Sauger» abstellen will,
          scrollt sonst durch alles und schaltet im Zweifel die Gruppe
          ab, in der auch das Wichtige steckt. Steht erst da, wenn es
          wirklich viele sind - bei zehn Schaltern ist ein Suchfeld
          Ballast. */}
      {categories != null && categories.length > 15 ? (
        <View style={styles.suchZeile}>
          <Ionicons name="search" size={15} color={colors.inkSoft} />
          <TextInput
            style={styles.suchFeld}
            value={suchtext}
            onChangeText={setSuchtext}
            placeholder="Nachrichtenart suchen"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Nachrichtenart suchen"
          />
          {suchtext ? (
            <Pressable
              onPress={() => setSuchtext('')}
              accessibilityRole="button"
              accessibilityLabel="Suche leeren"
            >
              <Ionicons name="close-circle" size={16} color={colors.inkFaint} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.hint}>Nicht abrufbar: {error}</Text>
      ) : categories == null ? (
        <Text style={styles.hint}>Wird geladen …</Text>
      ) : categories.filter((category) => passtZurSuche(category, suchtext)).length ===
        0 ? (
        <Text style={styles.hint}>
          Nichts passt zu «{suchtext}». Gesucht wird in Name, Gruppe und dem
          Beispielsatz.
        </Text>
      ) : (
        groupCategories(
          categories.filter((category) => passtZurSuche(category, suchtext)),
          groupOrder
        ).map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {/* flexWrap: Auf dem Telefon eine Spalte, auf dem breiten
                Schirm zwei bis drei - dieselbe Liste, ohne Sonderfall. */}
            <View style={styles.sectionRows}>
              {section.items.map((category) => {
                const on = !muted.includes(category.key);
                const offen = detail === category.key;
                const still = stillsatz(category.still_bis, Date.now() / 1000);
                return (
                  <View key={category.key} style={styles.rowBlock}>
                    <View style={styles.row}>
                      <Pressable
                        onPress={() => toggle(category.key)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={category.label}
                        style={styles.rowSchalter}
                      >
                        <Ionicons
                          name={on ? 'checkmark-circle' : 'ellipse-outline'}
                          size={20}
                          color={on ? colors.on : colors.inkFaint}
                        />
                        <Text
                          style={[styles.rowTitle, !on && { color: colors.inkFaint }]}
                          numberOfLines={1}
                        >
                          {category.label}
                        </Text>
                      </Pressable>
                      {/* Stillgestellt gehört auf die Zeile selbst: Es
                          läuft ab, und wer es nicht sieht, sucht den
                          Fehler beim Push-Dienst. */}
                      {still ? <Text style={styles.stillMarke}>{still}</Text> : null}
                      <Pressable
                        onPress={() => {
                          setDetail(offen ? null : category.key);
                          setProbe(null);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${category.label}: Vorschau und Test`}
                        accessibilityState={{ expanded: offen }}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={offen ? 'chevron-up' : 'ellipsis-horizontal'}
                          size={16}
                          color={colors.inkFaint}
                        />
                      </Pressable>
                    </View>
                    {offen ? (
                      <View style={styles.detail}>
                        {/* Was auf dem Sperrbildschirm stehen wird. Ohne
                            das bestellt man eine Überschrift ab und weiss
                            nicht, was darunter läuft. */}
                        {category.beispiel ? (
                          <View style={styles.vorschau}>
                            <Text style={styles.vorschauTitel} numberOfLines={2}>
                              {category.beispiel[0]}
                            </Text>
                            <Text style={styles.hint} numberOfLines={3}>
                              {category.beispiel[1]}
                            </Text>
                          </View>
                        ) : null}
                        <Text style={styles.hint}>
                          {category.dringend
                            ? 'Kommt sofort – auch wenn ein Fokus läuft.'
                            : 'Darf warten – kommt, wenn das Telefon ohnehin wach ist.'}
                          {category.deckel
                            ? ` Höchstens ${category.deckel}× am Tag.`
                            : ''}
                          {category.immer
                            ? ' Keine Ruhezeit hält sie auf.'
                            : ''}
                        </Text>
                        {/* Die Stufe fürs Haus (Punkt 512): Wer die
                            Batteriewarnung sofort will, stellt es hier
                            ein - für alle, denn sie beschreibt, was die
                            Meldung ist, nicht wer sie liest. */}
                        {darfStufen && category.stufe ? (
                          <View style={styles.stundenReihe}>
                            {(['leise', 'dringend', 'kritisch'] as const).map((stufe) => {
                              const gewaehlt = category.stufe === stufe;
                              return (
                                <Pressable
                                  key={stufe}
                                  onPress={() => stufeSetzen(category.key, stufe)}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: gewaehlt }}
                                  style={[styles.stunde, gewaehlt && styles.stundeAn]}
                                >
                                  <Text
                                    style={[
                                      styles.stundeText,
                                      gewaehlt && { color: colors.ink, fontWeight: '700' },
                                    ]}
                                  >
                                    {STUFEN_WORT[stufe]}
                                    {stufe === category.stufe_standard ? ' ·' : ''}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                        {category.stufe === 'kritisch' && !kritischErlaubt ? (
                          <Text style={styles.hint}>
                            «Kritisch» durchbricht Stummschalter und «Nicht
                            stören» - dafür braucht der Build eine Berechtigung
                            von Apple (push.critical_alerts im Hub). Bis dahin
                            kommt die Meldung als «Sofort».
                          </Text>
                        ) : null}
                        <View style={styles.detailKnoepfe}>
                          <Pressable
                            onPress={() => kategorieTesten(category.key)}
                            accessibilityRole="button"
                            style={styles.testButton}
                          >
                            <Ionicons
                              name="paper-plane-outline"
                              size={13}
                              color={colors.ink}
                            />
                            <Text style={styles.testText}>Probe schicken</Text>
                          </Pressable>
                          {category.immer ? null : (
                            <Pressable
                              onPress={() =>
                                stillstellen(category.key, category.still_bis ? 0 : 24)
                              }
                              accessibilityRole="button"
                              style={styles.testButton}
                            >
                              <Ionicons
                                name={
                                  category.still_bis
                                    ? 'volume-high-outline'
                                    : 'notifications-off-outline'
                                }
                                size={13}
                                color={colors.ink}
                              />
                              <Text style={styles.testText}>
                                {category.still_bis ? 'Wieder melden' : '24 h still'}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                        {probe?.key === category.key ? (
                          <Text style={styles.hint}>{probe.text}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}
      </>
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18, flexShrink: 1 },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    testButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    testText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    section: { gap: 2 },
    sectionTitle: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 4,
    },
    sectionRows: { flexDirection: 'row', flexWrap: 'wrap' },
    // Der Block trägt die Breite; die Zeile darin ist nur noch die
    // Zeile, damit die aufgeklappte Vorschau darunter passt und nicht
    // daneben.
    rowBlock: {
      minWidth: 290,
      flexGrow: 1,
      flexBasis: 290,
      maxWidth: 420,
      paddingRight: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    rowSchalter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    logKopf: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    logTitel: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', flex: 1 },
    logZeile: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    logZeit: { color: colors.inkFaint, fontSize: 12, minWidth: 92, paddingTop: 1 },
    verpasstMarke: { color: colors.warnInk, fontSize: 12, lineHeight: 17 },
    ruheKasten: {
      gap: 8,
      paddingLeft: 21,
      paddingBottom: 4,
      borderLeftWidth: 2,
      borderLeftColor: colors.surfaceBorder,
      marginLeft: 6,
    },
    // Die Suche über die Kategorien (Punkt 477 der Werkbank).
    suchZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: colors.surfaceSoft,
    },
    suchFeld: { flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 2 },
    stundenBlock: { gap: 4 },
    stundenTitel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    stundenReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    stunde: {
      minWidth: 30,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.surfaceSoft,
    },
    stundeAn: { backgroundColor: colors.accent },
    eingabe: {
      flex: 1,
      color: colors.ink,
      fontSize: 13,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: colors.surfaceSoft,
    },
    stundeText: { color: colors.inkSoft, fontSize: 12 },
    detail: {
      gap: 8,
      paddingLeft: 30,
      paddingBottom: 8,
      flexBasis: '100%',
    },
    detailKnoepfe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    vorschau: {
      gap: 2,
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    vorschauTitel: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    stillMarke: { color: colors.inkFaint, fontSize: 11, flexShrink: 0 },
  });
