import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings, SystemStatus } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Energie: was gerade zieht, was der Tag gekostet hat, und welches Gerät
 * wie viel davon ausmacht.
 *
 * Grundlage sind alle Geräte, die `power` oder `energy_today` melden – bei
 * uns die Schalt-Messsteckdosen. Der Strompreis steht in der config.yaml
 * unter `energy` und kommt über den System-Status mit; ohne ihn bleiben die
 * Kostenzeilen einfach weg.
 */
export function EnergyScreen({
  settings,
  entities = [],
}: {
  settings: HubSettings;
  entities?: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const headers: Record<string, string> = settings.token
      ? { Authorization: `Bearer ${settings.token}` }
      : {};
    fetch(`${settings.url}/api/system/status`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then(setStatus)
      .catch((err) => setError(String(err.message ?? err)));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  const measured = entities.filter(
    (entity) => entity.state.power != null || entity.state.energy_today != null
  );
  const price = status?.energy?.price_per_kwh ?? 0;
  const currency = status?.energy?.currency ?? 'CHF';
  const totalPower = measured.reduce(
    (sum, entity) => sum + (Number(entity.state.power) || 0),
    0
  );
  const totalKwh = measured.reduce(
    (sum, entity) => sum + (Number(entity.state.energy_today) || 0),
    0
  );
  const byPower = [...measured].sort(
    (a, b) => (Number(b.state.power) || 0) - (Number(a.state.power) || 0)
  );

  if (measured.length === 0) {
    return (
      <View style={styles.stack}>
        <Card style={styles.card}>
          <Text style={styles.heading}>Energie</Text>
          <Text style={styles.hint}>
            {error
              ? `Status nicht abrufbar: ${error}`
              : 'Noch kein Gerät misst den Verbrauch. Schalt-Messsteckdosen ' +
                '(z.B. Homematic HmIP-PSM) melden Leistung und Tagesverbrauch ' +
                'automatisch hierher.'}
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Card style={styles.card}>
        <Text style={styles.heading}>Im Moment</Text>
        <View style={styles.facts}>
          <Fact label="gerade jetzt" value={`${Math.round(totalPower)} W`} />
          <Fact label="heute" value={`${totalKwh.toFixed(2)} kWh`} />
          {price ? (
            <Fact
              label="Kosten heute"
              value={`${(totalKwh * price).toFixed(2)} ${currency}`}
            />
          ) : null}
          {price && totalKwh > 0 ? (
            <Fact
              label="≈ pro Monat"
              value={`${(totalKwh * price * 30).toFixed(0)} ${currency}`}
            />
          ) : null}
        </View>
        {!price ? (
          <Text style={styles.hint}>
            Für die Kosten fehlt der Strompreis. In der config.yaml des Hubs
            unter „energy“ eintragen – in Franken je kWh, nicht in Rappen:
            25.41 Rp./kWh sind price_per_kwh: 0.2541 (currency: CHF).
          </Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.heading}>Nach Gerät</Text>
        {byPower.map((entity) => {
          // Anteil am aktuellen Gesamtverbrauch – als Balken hinter der Zeile.
          const watts = Number(entity.state.power) || 0;
          const share = totalPower > 0 ? Math.round((watts / totalPower) * 100) : 0;
          const kwh = Number(entity.state.energy_today);
          return (
            <View key={entity.id} style={styles.row}>
              <Ionicons
                name="flash-outline"
                size={18}
                color={watts > 0 ? colors.accent : colors.inkFaint}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {entity.name}
                  </Text>
                  <Text style={styles.rowValue}>
                    {entity.state.power != null ? `${Math.round(watts)} W` : '–'}
                  </Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${share}%` }]} />
                </View>
                <Text style={styles.rowDetail}>
                  {Number.isFinite(kwh)
                    ? `heute ${kwh.toFixed(2)} kWh` +
                      (price ? ` · ${(kwh * price).toFixed(2)} ${currency}` : '')
                    : 'kein Tagesverbrauch gemeldet'}
                  {entity.room ? ` · ${entity.room}` : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
    fact: { minWidth: 96 },
    factValue: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    factLabel: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
    rowValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    rowDetail: { color: colors.inkSoft, fontSize: 12 },
    bar: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.track,
      overflow: 'hidden',
    },
    barFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  });
