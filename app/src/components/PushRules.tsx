import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from './Card';
import { Colors, type, useColors } from '../theme';
import { HubFehler, hubClient } from '../api/client';

/**
 * Die eingebauten Push-Nachrichten des Hubs als Kategorie «Push» unter
 * den Abläufen.
 *
 * Frostwarnung, offene Fenster, volle Waschmaschine: Diese Nachrichten
 * verschickt der Hub von sich aus, und bisher waren Schwellen und
 * Wartezeiten fest einprogrammiert. Hier stehen sie neben den selbst
 * gebauten Abläufen – sichtbar, abschaltbar, und wo es eine Schwelle
 * gibt, verstellbar.
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
}: {
  settings: HubSettings;
  mayEdit: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Zugeklappt wie die anderen Kategorien: erst die Übersicht.
  const [open, setOpen] = useState(false);

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Die Karte zeigt Fehler selbst an - deshalb «still».
    hub
      .get<{ rules?: Rule[] }>('/api/notifyrules', { still: true })
      .then((data) => setRules(data.rules ?? []))
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [hub]);

  useEffect(load, [load]);

  const save = async (rule: Rule) => {
    // Sofort anzeigen, damit das Antippen nicht hakt; der Hub bestätigt
    // mit den geprüften (in die Grenzen gezwungenen) Werten.
    setRules((prev) =>
      (prev ?? []).map((entry) => (entry.key === rule.key ? rule : entry))
    );
    try {
      const data = await hub.put<{ rules?: Rule[] }>(
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

  if (error) {
    return <Text style={styles.note}>Push-Regeln nicht abrufbar: {error}</Text>;
  }
  if (!rules) {
    return null;
  }

  const active = rules.filter((rule) => rule.enabled).length;

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
          {active === rules.length ? rules.length : `${active}/${rules.length}`}
        </Text>
      </Pressable>

      {open ? (
        <>
          {rules.map((rule) => (
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
            </Card>
          ))}
          <Text style={styles.footnote}>
            Diese Regeln gelten für alle. Wer eine Art Nachricht nur für sich
            nicht will, bestellt sie in den Einstellungen unter
            Benachrichtigungen ab. Die Alarm-Nachrichten stehen bewusst nicht
            hier – die lassen sich nicht abschalten.
          </Text>
        </>
      ) : null}
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
    groupTitle: {
      flex: 1,
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    groupCount: { color: colors.onGradientSoft, fontSize: 12, fontWeight: '700' },
    card: { minHeight: 0, gap: 6 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    detail: { color: colors.inkSoft, fontSize: type.cardSub, marginTop: 2 },
    iconButton: { padding: 6 },
    paramRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 2,
    },
    paramLabel: { color: colors.inkSoft, fontSize: 13, flex: 1 },
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
