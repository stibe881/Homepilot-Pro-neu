import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, type, useColors } from '../theme';
import { HubFehler, hubClient } from '../api/client';
import { pushAblaeufe, pushBeschreibung } from '../lib/pushablaeufe';
import { nachGruppen } from '../lib/pushgruppen';
import {
  Tuerstand,
  geordnet,
  kontaktName,
  naechsteWahl,
  tuerSatz,
} from '../lib/waschkueche';
import { Automation, triggerIcon } from '../screens/automations/entwurf';

/**
 * Alles, was das Haus aufs Telefon schickt – als Kategorie «Push» unter
 * den Abläufen.
 *
 * Zwei Arten stehen hier nebeneinander, weil sie dieselbe Frage
 * beantworten («was meldet mir das Haus?»):
 *
 * - Die **eingebauten Nachrichten** des Wächters: Frostwarnung, offene
 *   Fenster, volle Waschmaschine. Sie verschickt der Hub von sich aus;
 *   früher waren Schwellen und Wartezeiten fest einprogrammiert, jetzt
 *   lassen sie sich abschalten und verstellen.
 * - Die **selbst gebauten Abläufe**, die eine Nachricht verschicken.
 *   Sie lagen bisher nur in der Ablauf-Liste unter ihrer Kategorie – wer
 *   hier nachsah, welche Nachrichten es gibt, übersah genau die, die er
 *   selbst gebaut hatte. Sie bleiben vollständig bearbeitbar: der
 *   Schalter wirkt sofort, der Stift öffnet denselben Editor wie oben.
 *
 * Global, nicht je Person: Die Regeln bestimmen, ob der Hub überhaupt
 * meldet. Wer eine Kategorie nur für sich nicht will, bestellt sie in den
 * Einstellungen unter Benachrichtigungen ab.
 */

interface RuleParam {
  key: string;
  label: string;
  unit: string;
  value: number;
  default: number;
  min: number;
  max: number;
  step: number;
}

interface Rule {
  key: string;
  title: string;
  detail: string;
  enabled: boolean;
  params: RuleParam[];
  /** Unterkategorie, wie der Hub sie vergibt (core/push.py) – dieselbe
   *  wie im Profil unter Benachrichtigungen. */
  group?: string;
}

/** Einen Schritt weiter, aber in den Grenzen (rein, testbar). */
export function stepValue(param: RuleParam, direction: 1 | -1): number {
  const next = param.value + direction * param.step;
  const clamped = Math.max(param.min, Math.min(param.max, next));
  // Gegen 0.1+0.2-Reste beim halben Grad der Frostschwelle.
  return Math.round(clamped * 10) / 10;
}

export function PushRules({
  settings,
  mayEdit,
  automations,
  onEdit,
  onToggle,
}: {
  settings: HubSettings;
  mayEdit: boolean;
  /** Alle Abläufe – die meldenden davon stehen hier mit drin. */
  automations: Automation[] | null;
  /** Den Ablauf im gewohnten Editor öffnen. */
  onEdit: (automation: Automation) => void;
  /** Ein- und ausschalten, ohne den Editor zu öffnen. */
  onToggle: (automation: Automation, enabled: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  // Reihenfolge der Unterkategorien – kommt vom Hub, damit «Sicherheit»
  // oben steht und «Betrieb» unten.
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Zugeklappt wie die anderen Kategorien: erst die Übersicht.
  const [open, setOpen] = useState(false);
  // Die Waschküchentüre gehört zur Regel «Haushaltgerät noch voll» und
  // steht deshalb in deren Karte - nicht in einer eigenen Einstellung,
  // die niemand mit der Nachricht in Verbindung brächte.
  const [tuer, setTuer] = useState<Tuerstand | null>(null);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Die Karte zeigt Fehler selbst an - deshalb «still».
    hub
      .get<{ rules?: Rule[]; groups?: string[] }>('/api/notifyrules', { still: true })
      .then((data) => {
        setRules(data.rules ?? []);
        setGroupOrder(data.groups ?? []);
      })
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [hub]);

  useEffect(load, [load]);

  // Erst beim Aufklappen: Wer die Push-Liste nie öffnet, soll dafür
  // keinen zweiten Aufruf bezahlen.
  useEffect(() => {
    if (!open) return;
    hub
      .get<Tuerstand>('/api/laundry', { still: true })
      .then(setTuer)
      // Ein Hub, der die Route noch nicht kennt, ist kein Grund, die
      // ganze Push-Liste rot zu machen - die Auswahl fällt dann weg.
      .catch(() => setTuer(null));
  }, [hub, open]);

  const tuerWaehlen = async (id: string) => {
    const naechste = naechsteWahl(tuer, id);
    try {
      setTuer(await hub.put<Tuerstand>('/api/laundry', { door: naechste }, { still: true }));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const save = async (rule: Rule) => {
    // Sofort anzeigen, damit das Antippen nicht hakt; der Hub bestätigt
    // mit den geprüften (in die Grenzen gezwungenen) Werten.
    setRules((prev) =>
      (prev ?? []).map((entry) => (entry.key === rule.key ? rule : entry))
    );
    try {
      const data = await hub.put<{ rules?: Rule[]; groups?: string[] }>(
        `/api/notifyrules/${rule.key}`,
        {
          enabled: rule.enabled,
          params: Object.fromEntries(
            rule.params.map((param) => [param.key, param.value])
          ),
        },
        { still: true }
      );
      setRules(data.rules ?? []);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      load();
    }
  };

  const toggle = (rule: Rule) => save({ ...rule, enabled: !rule.enabled });

  const nudge = (rule: Rule, param: RuleParam, direction: 1 | -1) =>
    save({
      ...rule,
      params: rule.params.map((entry) =>
        entry.key === param.key
          ? { ...entry, value: stepValue(entry, direction) }
          : entry
      ),
    });

  // Die eigenen Abläufe stehen schon in der Liste, die dieser Bildschirm
  // ohnehin geholt hat - sie brauchen keinen zweiten Aufruf und bleiben
  // darum auch sichtbar, wenn der für die eingebauten Regeln scheitert.
  const ablaeufe = pushAblaeufe(automations);
  const eingebaut = rules ?? [];

  if (!rules && !error) {
    return null;
  }

  const active =
    eingebaut.filter((rule) => rule.enabled).length +
    ablaeufe.filter((automation) => automation.enabled !== false).length;
  const gesamt = eingebaut.length + ablaeufe.length;

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.groupHead}
      >
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={colors.onGradientSoft}
        />
        <Text style={styles.groupTitle}>Push</Text>
        <Text style={styles.groupCount}>
          {active === gesamt ? gesamt : `${active}/${gesamt}`}
        </Text>
      </Pressable>

      {open ? (
        <>
          {error ? (
            <Text style={styles.note}>
              Eingebaute Push-Regeln nicht abrufbar: {error}
            </Text>
          ) : null}
          {/* In Unterkategorien, wie sie der Hub vergibt - dieselben wie
              im Profil unter Benachrichtigungen. Elf gleich aussehende
              Karten beantworten sonst nicht, was hier eigentlich zur
              Frage steht: Was weckt mich nachts, was ist bloss Betrieb? */}
          {nachGruppen(eingebaut, groupOrder).map((gruppe) => (
          <View key={gruppe.title} style={{ gap: 10 }}>
          <Text style={styles.gruppe}>{gruppe.title}</Text>
          {gruppe.items.map((rule) => (
            <Card key={rule.key} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.title, !rule.enabled && { color: colors.inkFaint }]}
                  >
                    {rule.title}
                    {rule.enabled ? '' : ' · aus'}
                  </Text>
                  <Text style={styles.detail}>{rule.detail}</Text>
                </View>
                <Pressable
                  onPress={() => toggle(rule)}
                  disabled={!mayEdit}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: rule.enabled }}
                  accessibilityLabel={`${rule.title} ${rule.enabled ? 'abschalten' : 'einschalten'}`}
                  style={styles.iconButton}
                >
                  <Ionicons
                    name={rule.enabled ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={rule.enabled ? colors.on : colors.inkFaint}
                  />
                </Pressable>
              </View>

              {rule.enabled
                ? rule.params.map((param) => (
                    <View key={param.key} style={styles.paramRow}>
                      <Text style={styles.paramLabel}>{param.label}</Text>
                      {mayEdit ? (
                        <Pressable
                          onPress={() => nudge(rule, param, -1)}
                          disabled={param.value <= param.min}
                          accessibilityLabel={`${param.label} verringern`}
                          style={[
                            styles.stepButton,
                            param.value <= param.min && { opacity: 0.35 },
                          ]}
                        >
                          <Ionicons name="remove" size={16} color={colors.ink} />
                        </Pressable>
                      ) : null}
                      <Text style={styles.paramValue}>
                        {param.value} {param.unit}
                      </Text>
                      {mayEdit ? (
                        <Pressable
                          onPress={() => nudge(rule, param, 1)}
                          disabled={param.value >= param.max}
                          accessibilityLabel={`${param.label} erhöhen`}
                          style={[
                            styles.stepButton,
                            param.value >= param.max && { opacity: 0.35 },
                          ]}
                        >
                          <Ionicons name="add" size={16} color={colors.ink} />
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                : null}

              {/* Woran der Hub abliest, dass jemand die volle Maschine
                  gesehen hat. Ohne diese Türe bleibt es bei einer
                  Nachricht je Programm - siehe lib/waschkueche.ts. */}
              {rule.key === 'appliance' && rule.enabled && tuer ? (
                <Tuerwahl
                  stand={tuer}
                  mayEdit={mayEdit}
                  onWaehlen={tuerWaehlen}
                  styles={styles}
                  colors={colors}
                />
              ) : null}
            </Card>
          ))}
          </View>
          ))}

          {/* Und darunter, in derselben Form: die selbst gebauten Abläufe,
              die eine Nachricht verschicken. Sie bleiben Abläufe - der
              Stift öffnet denselben Editor wie in der Liste oben. */}
          {ablaeufe.length > 0 ? (
            <Text style={styles.gruppe}>Eigene Abläufe</Text>
          ) : null}
          {ablaeufe.map((automation) => {
            const an = automation.enabled !== false;
            return (
              <Card key={automation.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      {/* Worauf hört er? Uhr, Sonne, Bewegung - dasselbe
                          Symbol wie in der Ablauf-Liste. */}
                      <Ionicons
                        name={triggerIcon(automation) as keyof typeof Ionicons.glyphMap}
                        size={15}
                        color={an ? colors.inkSoft : colors.inkFaint}
                      />
                      <Text
                        style={[
                          styles.title,
                          { flexShrink: 1 },
                          !an && { color: colors.inkFaint },
                        ]}
                      >
                        {automation.alias}
                        {an ? '' : ' · aus'}
                      </Text>
                    </View>
                    <Text style={styles.detail}>{pushBeschreibung(automation)}</Text>
                    <Text style={styles.origin}>
                      Eigener Ablauf – steht auch oben in der Liste.
                    </Text>
                  </View>
                  {automation.editable && mayEdit ? (
                    <>
                      <Pressable
                        onPress={() => onToggle(automation, !an)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: an }}
                        accessibilityLabel={`${automation.alias} ${an ? 'abschalten' : 'einschalten'}`}
                        style={styles.iconButton}
                      >
                        <Ionicons
                          name={an ? 'checkmark-circle' : 'ellipse-outline'}
                          size={24}
                          color={an ? colors.on : colors.inkFaint}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => onEdit(automation)}
                        accessibilityRole="button"
                        accessibilityLabel={`${automation.alias} bearbeiten`}
                        style={styles.iconButton}
                      >
                        <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
                      </Pressable>
                    </>
                  ) : (
                    // Aus der config.yaml: Der Hub führt ihn aus, die Datei
                    // gehört aber nicht der App.
                    <Text style={styles.badge}>
                      {automation.editable ? 'nur lesen' : 'aus config.yaml'}
                    </Text>
                  )}
                </View>
              </Card>
            );
          })}

          <Text style={styles.footnote}>
            Die eingebauten Regeln gelten für alle. Wer eine Art Nachricht nur
            für sich nicht will, bestellt sie in den Einstellungen unter
            Benachrichtigungen ab. Die Alarm-Nachrichten stehen bewusst nicht
            hier – die lassen sich nicht abschalten.
          </Text>
          {ablaeufe.length === 0 ? (
            <Text style={styles.footnote}>
              Eigene Abläufe mit dem Schritt «Nachricht senden» erscheinen hier
              von selbst mit.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * Die Türe der Waschküche als Auswahl.
 *
 * Zugeklappt steht nur der Satz da, was gerade gilt: In aller Regel hat
 * der Hub die richtige Türe schon gefunden, und dann ist hier nichts zu
 * tun. Erst wer sie ändern will, klappt die Liste auf.
 */
function Tuerwahl({
  stand,
  mayEdit,
  onWaehlen,
  styles,
  colors,
}: {
  stand: Tuerstand;
  mayEdit: boolean;
  onWaehlen: (id: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const [offen, setOffen] = useState(false);
  const liste = geordnet(stand);

  return (
    <View style={styles.tuerBlock}>
      <Text style={styles.tuerTitel}>Ausgeräumt heisst: jemand war in der Waschküche</Text>
      <Text style={styles.detail}>{tuerSatz(stand)}</Text>
      {mayEdit && liste.length > 0 ? (
        <Pressable
          onPress={() => setOffen((wert) => !wert)}
          accessibilityRole="button"
          accessibilityState={{ expanded: offen }}
          accessibilityLabel="Türe der Waschküche wählen"
          style={styles.tuerChip}
        >
          <Ionicons name="log-in-outline" size={14} color={colors.inkSoft} />
          <Text style={styles.tuerChipText}>Andere Türe</Text>
          <Ionicons
            name={offen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.inkSoft}
          />
        </Pressable>
      ) : null}
      {offen
        ? liste.map((kontakt) => {
            const gilt = stand.using === kontakt.id;
            return (
              <Pressable
                key={kontakt.id}
                onPress={() => onWaehlen(kontakt.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: gilt }}
                style={styles.tuerZeile}
              >
                <Ionicons
                  name={gilt ? 'radio-button-on' : 'radio-button-off'}
                  size={16}
                  color={gilt ? colors.on : colors.inkFaint}
                />
                <Text style={[styles.tuerZeileText, gilt && { color: colors.ink }]}>
                  {kontaktName(kontakt)}
                </Text>
                {/* Was der Hub von selbst gefunden hat - damit man sieht,
                    wohin ein zweites Antippen zurückführt. */}
                {stand.guess === kontakt.id ? (
                  <Text style={styles.badge}>Vorschlag</Text>
                ) : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    note: { color: colors.onGradientSoft, fontSize: 13 },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 6,
      paddingBottom: 2,
    },
    // Dieselbe Zeile wie die Kategorien darüber - sie steht in derselben
    // Liste. Stünde hier weiter «PUSH» in Grossbuchstaben zwischen
    // «Lautsprecher» und «Wandtaster», sähe es nach einer anderen Ebene
    // aus, obwohl es dieselbe ist.
    groupTitle: {
      flex: 1,
      color: colors.onGradient,
      fontSize: 15,
      fontWeight: '700',
    },
    groupCount: { color: colors.onGradientSoft, fontSize: 13, fontWeight: '700' },
    /** Zwischenüberschrift einer Unterkategorie. Kleiner als die
     *  «PUSH»-Zeile darüber: Sie gliedert, sie ist nicht die Überschrift. */
    gruppe: {
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 4,
    },
    card: { minHeight: 0, gap: 6 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    detail: { color: colors.inkSoft, fontSize: type.cardSub, marginTop: 2 },
    /** Woher die Nachricht kommt – leise, aber vorhanden: Sonst sucht man
     *  den Ablauf, den man gerade abgeschaltet hat, oben vergeblich. */
    origin: { color: colors.inkFaint, fontSize: 11, marginTop: 2 },
    badge: { color: colors.inkFaint, fontSize: 11 },
    iconButton: { padding: 6 },
    paramRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 2,
    },
    paramLabel: { color: colors.inkSoft, fontSize: 13, flex: 1 },
    /** Die Türwahl sitzt in derselben Karte, aber abgesetzt: Sie ist
     *  keine Schwelle wie die Zeilen darüber, sondern ein Gerät. */
    tuerBlock: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceBorder,
      gap: 4,
    },
    tuerTitel: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    tuerChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.surfaceBorder,
    },
    tuerChipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    tuerZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    tuerZeileText: { color: colors.inkSoft, fontSize: 13, flex: 1 },
    paramValue: {
      color: colors.ink,
      fontSize: 14,
      fontWeight: '600',
      minWidth: 92,
      textAlign: 'center',
    },
    stepButton: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    footnote: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17 },
  });
