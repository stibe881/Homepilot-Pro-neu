import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Activity, Entity } from '../api/types';
import { colors, radius, type } from '../theme';
import { Card } from './Card';

const SEVERITY_COLOR: Record<string, string> = {
  Extreme: colors.danger,
  Severe: colors.danger,
  Moderate: colors.warn,
  Minor: colors.warn,
};

/**
 * Breite Spalte rechts (Tablet) bzw. Abschnitt unten (Telefon):
 * Wetterlage und was zuletzt im Haus passiert ist.
 */
export function SidePanel({
  entities,
  activity,
  width,
}: {
  entities: Entity[];
  activity: Activity[];
  width?: number;
}) {
  const alert = entities.find((entity) => entity.kind === 'alert');

  return (
    <View style={[styles.column, width ? { width } : { flex: 1 }]}>
      {alert ? <AlertPanel entity={alert} /> : null}

      <Card style={styles.activityCard}>
        <Text style={styles.heading}>Zuletzt passiert</Text>
        {activity.length === 0 ? (
          <Text style={styles.empty}>
            Noch keine Änderung, seit die App verbunden ist.
          </Text>
        ) : (
          <View style={styles.list}>
            {activity.slice(0, 7).map((item) => (
              <View key={item.id} style={styles.activityRow}>
                <View style={styles.bullet} />
                <Text numberOfLines={1} style={styles.activityName}>
                  {item.name}
                </Text>
                <Text style={styles.activitySummary}>{item.summary}</Text>
                <Text style={styles.activityTime}>
                  {new Date(item.at).toLocaleTimeString('de-CH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

function AlertPanel({ entity }: { entity: Entity }) {
  const count = entity.state.count ?? 0;
  const severity = entity.state.max_severity;
  const tone = count > 0 ? SEVERITY_COLOR[severity] ?? colors.warn : colors.on;
  const alerts: any[] = entity.state.alerts ?? [];

  return (
    <Card style={styles.alertCard}>
      <View style={styles.alertHead}>
        <Ionicons
          name={count > 0 ? 'thunderstorm-outline' : 'sunny-outline'}
          size={26}
          color={tone}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Wetterlage</Text>
          <Text style={styles.alertSource}>{entity.name}</Text>
        </View>
      </View>

      <Text style={[styles.alertCount, { color: tone }]}>
        {count > 0 ? `${count} Warnungen` : 'Keine Warnungen'}
      </Text>

      <View style={styles.list}>
        {alerts.slice(0, 4).map((item, index) => (
          <View key={index} style={styles.alertRow}>
            <View
              style={[
                styles.severityBar,
                { backgroundColor: SEVERITY_COLOR[item.severity] ?? colors.inkFaint },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.alertEvent}>
                {item.event ?? item.title}
              </Text>
              <Text numberOfLines={1} style={styles.alertArea}>
                {item.area}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  column: { gap: 14 },
  alertCard: { gap: 12, minHeight: 0 },
  activityCard: { gap: 12, minHeight: 0, flexShrink: 1 },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heading: {
    color: colors.ink,
    fontSize: type.cardTitle,
    fontWeight: '700',
  },
  alertSource: {
    color: colors.inkFaint,
    fontSize: 12,
    marginTop: 1,
  },
  alertCount: {
    fontSize: 28,
    fontWeight: '700',
  },
  list: { gap: 10 },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  severityBar: {
    width: 3,
    height: 30,
    borderRadius: radius.pill,
  },
  alertEvent: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '500',
  },
  alertArea: {
    color: colors.inkSoft,
    fontSize: 12,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.inkFaint,
  },
  activityName: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  activitySummary: {
    color: colors.inkSoft,
    fontSize: 13,
    flex: 1,
  },
  activityTime: {
    color: colors.inkFaint,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
});
