import React from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { EntityCard } from '../components/EntityCard';
import { useHub } from '../hooks/useHub';
import { colors, gap } from '../theme';

interface Props {
  settings: HubSettings;
  onOpenSettings: () => void;
}

const SECTIONS: { title: string; kinds: string[] }[] = [
  { title: 'Lichter', kinds: ['light'] },
  { title: 'Schalter', kinds: ['switch'] },
  { title: 'Sensoren', kinds: ['sensor', 'binary_sensor'] },
  { title: 'Warnungen', kinds: ['alert'] },
];

const STATUS_LABEL = {
  connected: 'verbunden',
  connecting: 'verbinde …',
  disconnected: 'getrennt',
} as const;

const STATUS_COLOR = {
  connected: colors.green,
  connecting: colors.yellow,
  disconnected: colors.red,
} as const;

export function DashboardScreen({ settings, onOpenSettings }: Props) {
  const { entities, status, sendCommand } = useHub(settings.url, settings.token);

  const grouped = SECTIONS.map((section) => ({
    ...section,
    entities: entities.filter((entity) => section.kinds.includes(entity.kind)),
  }));
  const known = new Set(SECTIONS.flatMap((section) => section.kinds));
  const other = entities.filter((entity) => !known.has(entity.kind));

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.title}>HomePilot</Text>
          <View style={styles.statusRow}>
            <View
              style={[styles.statusDot, { backgroundColor: STATUS_COLOR[status] }]}
            />
            <Text style={styles.statusText}>{STATUS_LABEL[status]}</Text>
          </View>
        </View>
        <Pressable onPress={onOpenSettings} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙︎</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} tintColor={colors.textDim} />}
      >
        {grouped.map(
          (section) =>
            section.entities.length > 0 && (
              <Section key={section.title} title={section.title} entities={section.entities} sendCommand={sendCommand} />
            )
        )}
        {other.length > 0 && (
          <Section title="Weitere" entities={other} sendCommand={sendCommand} />
        )}
        {entities.length === 0 && (
          <Text style={styles.empty}>
            {status === 'connected'
              ? 'Keine Entitäten – Integrationen in der config.yaml des Hubs aktivieren.'
              : 'Warte auf Verbindung zum Hub …'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  entities,
  sendCommand,
}: {
  title: string;
  entities: Entity[];
  sendCommand: (entityId: string, command: string, data?: Record<string, any>) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grid}>
        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            onCommand={(command, data) => sendCommand(entity.id, command, data)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 60,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: colors.textDim,
    fontSize: 13,
  },
  settingsButton: {
    padding: 10,
  },
  settingsIcon: {
    color: colors.textDim,
    fontSize: 24,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: gap * 2,
  },
  section: {
    gap: gap,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: gap,
  },
  empty: {
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
    lineHeight: 20,
  },
});
