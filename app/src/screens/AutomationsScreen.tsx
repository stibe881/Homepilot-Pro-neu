import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, type, useColors } from '../theme';

interface Automation {
  id: string;
  alias: string;
  triggers: any[];
  conditions: any[];
  actions: any[];
}

/** Zeigt die im Hub geladenen Automationen (GET /api/automations). */
export function AutomationsScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${settings.url}/api/automations`, {
      headers: settings.token ? { Authorization: `Bearer ${settings.token}` } : {},
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Hub antwortet mit ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setAutomations(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, [settings.url, settings.token]);

  if (error) {
    return <Text style={styles.note}>Abläufe nicht abrufbar: {error}</Text>;
  }
  if (automations === null) {
    return <Text style={styles.note}>Wird geladen …</Text>;
  }
  if (automations.length === 0) {
    return (
      <Text style={styles.note}>
        Noch keine Abläufe – sie werden im Abschnitt „automations“ der
        config.yaml des Hubs angelegt.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {automations.map((automation) => (
        <Card key={automation.id} style={styles.card}>
          <Text style={styles.title}>{automation.alias}</Text>
          <Text style={styles.detail}>
            {describe(automation.triggers.length, 'Auslöser', 'Auslöser')} ·{' '}
            {describe(automation.conditions.length, 'Bedingung', 'Bedingungen')} ·{' '}
            {describe(automation.actions.length, 'Aktion', 'Aktionen')}
          </Text>
          {automation.triggers.map((trigger, index) => (
            <Text key={index} style={styles.trigger}>
              {trigger.entity_id
                ? `wenn ${trigger.entity_id} → ${trigger.to ?? 'sich ändert'}`
                : trigger.at
                  ? `täglich um ${trigger.at}`
                  : `alle ${trigger.seconds} s`}
            </Text>
          ))}
        </Card>
      ))}
    </View>
  );
}

function describe(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  list: { gap: 14, marginTop: 4 },
  card: { minHeight: 0, gap: 6 },
  title: {
    color: colors.ink,
    fontSize: type.cardTitle,
    fontWeight: '700',
  },
  detail: {
    color: colors.inkSoft,
    fontSize: type.cardSub,
  },
  trigger: {
    color: colors.inkFaint,
    fontSize: 12,
  },
  note: {
    color: colors.onGradientSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 20,
    maxWidth: 460,
  },
});
