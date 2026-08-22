import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings, SystemStatus } from '../api/types';
import { Card } from '../components/Card';
import { HistoryChart } from '../components/HistoryChart';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Energie: was gerade zieht, was der Tag gekostet hat, welches Gerät wie
 * viel davon ausmacht – und wie sich der Monat gegen den letzten schlägt.
 *
 * Grundlage sind alle Geräte, die `power` oder `energy_today` melden – bei
 * uns die Schalt-Messsteckdosen. Der Strompreis steht in der config.yaml
 * unter `energy` und kommt über den System-Status mit; ohne ihn bleiben die
 * Kostenzeilen einfach weg.
 */

interface Months {
  month: string;
  last_month: string;
  this_month_kwh: number;
  last_month_kwh: number;
  last_month_so_far_kwh: number;
  days: { day: string; kwh: number }[];
  /** Hochrechnung aufs Monatsende – aus dem Tagesschnitt, nicht aus dem
   *  letzten Tag (ein Waschtag hochgerechnet hilft niemandem). */
  forecast?: {
    per_day_kwh: number;
    projected_kwh: number;
    days_done: number;
    days_total: number;
  };
  /** Derselbe Monat im Vorjahr; 0 heisst «wissen wir noch nicht». */
  year_ago_kwh?: number;
  /** Verbrauch je Stunde – beantwortet «wann?», nicht nur «wie viel?». */
  hours_today?: { hour: number; kwh: number }[];
  hours_yesterday?: { hour: number; kwh: number }[];
}

interface DeviceEnergy {
  top: {
    entity_id: string;
    name: string;
    room?: string | null;
    kwh: number;
    watts: number | null;
  }[];
  standby: {
    entity_id: string;
    name: string;
    room?: string | null;
    watts: number;
    kwh_year: number;
    cost_year: number | null;
  }[];
  price_per_kwh: number | null;
  currency: string;
}

interface CycleStat {
  entity_id: string;
  name: string;
  runs: number;
  average_seconds: number;
  last_seconds: number;
  last_finished?: number | null;
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** «2026-07» → «Juli» (rein, testbar). */
function monthName(month: string): string {
  const number = Number(month?.slice(5, 7));
  return MONTH_NAMES[number - 1] ?? month;
}

/** Sekunden als «1 Std 45 Min» – Minuten allein liest niemand gern. */
function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} Std ${rest} Min` : `${minutes / 60} Std`;
}

/**
 * Wie viel mehr oder weniger als der Vergleichswert – in Prozent.
 *
 * ``null``, wenn es nichts zu vergleichen gibt: «unendlich viel mehr als
 * 0» ist keine Aussage, mit der jemand etwas anfangen kann.
 */
function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}
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
  const [months, setMonths] = useState<Months | null>(null);
  const [cycles, setCycles] = useState<CycleStat[]>([]);
  const [devices, setDevices] = useState<DeviceEnergy | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Aufgeklapptes Gerät samt Verlauf, und die Breite dafür.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

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
    // Der Monatsvergleich und die Programmläufe sind hübsch, aber nicht
    // lebenswichtig – schlägt der Abruf fehl, bleibt die Karte einfach weg,
    // statt die ganze Seite mit einem Fehler zu belegen.
    fetch(`${settings.url}/api/energy/months`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then(setMonths)
      .catch(() => setMonths(null));
    fetch(`${settings.url}/api/energy/devices`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then(setDevices)
      .catch(() => setDevices(null));
    fetch(`${settings.url}/api/appliances/cycles`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setCycles(data?.stats ?? []))
      .catch(() => setCycles([]));
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
        {/* Programmläufe hängen nicht an einer Messsteckdose – die Waschmaschine
            meldet ihr Ende selbst und gehört deshalb auch hier hin. */}
        <Cycles stats={cycles} styles={styles} colors={colors} />
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

      <HoursCard months={months} styles={styles} />

      <MonthCard
        months={months}
        price={price}
        currency={currency}
        styles={styles}
        colors={colors}
      />

      {devices && devices.top.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Wohin der Strom geht</Text>
          <Text style={styles.hint}>Heute, absteigend.</Text>
          {devices.top.map((row, index) => (
            <View key={row.entity_id} style={styles.rankRow}>
              <Text style={styles.rankNumber}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rankName} numberOfLines={1}>
                  {row.name}
                </Text>
                {row.room ? <Text style={styles.hint}>{row.room}</Text> : null}
              </View>
              <Text style={styles.rankValue}>
                {row.kwh.toFixed(2)} kWh
                {price ? `  ·  ${(row.kwh * price).toFixed(2)} ${currency}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {devices && devices.standby.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Dauerverbraucher</Text>
          <Text style={styles.hint}>
            Diese Geräte ziehen rund um die Uhr Strom. Hochgerechnet aufs Jahr –
            eine Momentaufnahme, aber die richtige Grössenordnung für die Frage,
            wo sich eine schaltbare Steckdose lohnt.
          </Text>
          {devices.standby.map((row) => (
            <View key={row.entity_id} style={styles.rankRow}>
              <Ionicons name="flash-outline" size={16} color={colors.warn} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rankName} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={styles.hint}>
                  {row.watts} W · {row.kwh_year} kWh im Jahr
                </Text>
              </View>
              {row.cost_year ? (
                <Text style={styles.rankValue}>
                  {row.cost_year.toFixed(0)} {devices.currency}/Jahr
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={styles.measure}
        />
        <Text style={styles.heading}>Nach Gerät</Text>
        <Text style={styles.hint}>
          Antippen zeigt den Verlauf der letzten Stunden – daran sieht man,
          ob ein Gerät durchläuft oder nur kurz anspringt.
        </Text>
        {byPower.map((entity) => {
          // Anteil am aktuellen Gesamtverbrauch – als Balken hinter der Zeile.
          const watts = Number(entity.state.power) || 0;
          const share = totalPower > 0 ? Math.round((watts / totalPower) * 100) : 0;
          const kwh = Number(entity.state.energy_today);
          const open = expanded === entity.id;
          return (
            <Pressable
              key={entity.id}
              onPress={() => setExpanded(open ? null : entity.id)}
              accessibilityRole="button"
              style={styles.row}
            >
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
                {open && width > 0 ? (
                  <HistoryChart
                    entity={entity}
                    settings={settings}
                    width={Math.max(120, width - 78)}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </Card>

      <Cycles stats={cycles} styles={styles} colors={colors} />
    </View>
  );
}

/**
 * Der Tagesverlauf in Stunden.
 *
 * Der Tageswert sagt, *wie viel* verbraucht wurde – erst die Stunden
 * sagen, *wann*: der Backofen um 18 Uhr, nicht der Kühlschrank. Gestern
 * liegt zum Umschalten daneben, mit derselben Skala, damit die Balken
 * vergleichbar bleiben.
 */
function HoursCard({
  months,
  styles,
}: {
  months: Months | null;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const today = months?.hours_today ?? [];
  const yesterday = months?.hours_yesterday ?? [];
  // Unter zwei Stunden gibt es keinen Verlauf zu sehen.
  if (!months || today.length + yesterday.length < 2) return null;

  const shown = day === 'today' ? today : yesterday;
  const byHour = new Map(shown.map((entry) => [entry.hour, entry.kwh]));
  const peak = Math.max(
    0.05,
    ...today.map((entry) => entry.kwh),
    ...yesterday.map((entry) => entry.kwh)
  );
  const total = shown.reduce((sum, entry) => sum + entry.kwh, 0);

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Tagesverlauf</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['today', 'yesterday'] as const).map((key) => (
          <Pressable
            key={key}
            onPress={() => setDay(key)}
            accessibilityRole="button"
            style={[styles.hourChip, day === key && styles.hourChipActive]}
          >
            <Text
              style={[styles.hourChipText, day === key && styles.hourChipTextActive]}
            >
              {key === 'today' ? 'heute' : 'gestern'}
            </Text>
          </Pressable>
        ))}
      </View>
      {shown.length === 0 ? (
        <Text style={styles.hint}>
          {day === 'today'
            ? 'Für heute liegt noch nichts vor.'
            : 'Von gestern liegt nichts vor – die Stunden werden erst seit ' +
              'diesem Stand mitgeschrieben.'}
        </Text>
      ) : (
        <>
          <View style={styles.days}>
            {Array.from({ length: 24 }, (_, hour) => (
              <View key={hour} style={styles.dayColumn}>
                <View
                  style={[
                    styles.dayBar,
                    {
                      height: Math.max(
                        byHour.has(hour) ? 2 : 0,
                        Math.round(((byHour.get(hour) ?? 0) / peak) * 48)
                      ),
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          <Text style={styles.rowDetail}>
            Ein Balken je Stunde (0–23 Uhr), zusammen {total.toFixed(1)} kWh.
            Die Skala ist für heute und gestern dieselbe.
          </Text>
        </>
      )}
    </Card>
  );
}

/**
 * Der Monatsvergleich.
 *
 * Verglichen wird mit demselben Zeitraum des Vormonats, nicht mit dem
 * ganzen: Am 3. des Monats neben einem vollen Vormonat zu stehen sähe nach
 * einer Ersparnis aus, die es nicht gibt. Der volle Vormonat steht
 * trotzdem daneben – als Grössenordnung, wo der Monat hinführt.
 */
function MonthCard({
  months,
  price,
  currency,
  styles,
  colors,
}: {
  months: Months | null;
  price: number;
  currency: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (!months) return null;

  const soFar = months.this_month_kwh;
  const before = months.last_month_so_far_kwh;
  const delta = change(soFar, before);
  const peak = Math.max(1, ...months.days.map((entry) => entry.kwh));

  if (months.days.length === 0 && months.last_month_kwh === 0) {
    return (
      <Card style={styles.card}>
        <Text style={styles.heading}>{monthName(months.month)}</Text>
        <Text style={styles.hint}>
          Der Verbrauch wird ab jetzt täglich mitgeschrieben. Der Vergleich
          mit dem Vormonat steht hier, sobald ein Monat zusammengekommen ist –
          die Zähler der Steckdosen selbst vergessen jede Nacht alles.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{monthName(months.month)}</Text>
      <View style={styles.facts}>
        <Fact label="bisher" value={`${soFar.toFixed(1)} kWh`} />
        {price ? (
          <Fact label="Kosten" value={`${(soFar * price).toFixed(2)} ${currency}`} />
        ) : null}
        {months.forecast && months.forecast.days_done >= 3 ? (
          <Fact
            label="Hochrechnung"
            value={`${months.forecast.projected_kwh.toFixed(0)} kWh`}
          />
        ) : null}
        {months.year_ago_kwh ? (
          <Fact
            label={`${monthName(months.month)} im Vorjahr`}
            value={`${months.year_ago_kwh.toFixed(1)} kWh`}
          />
        ) : null}
        <Fact
          label={`${monthName(months.last_month)}, gleicher Zeitraum`}
          value={`${before.toFixed(1)} kWh`}
        />
        <Fact
          label={`${monthName(months.last_month)}, ganzer Monat`}
          value={`${months.last_month_kwh.toFixed(1)} kWh`}
        />
      </View>

      {delta === null ? (
        <Text style={styles.hint}>
          Aus {monthName(months.last_month)} liegt für diesen Zeitraum noch
          nichts vor – ohne Vergleichswert wäre jede Prozentzahl erfunden.
        </Text>
      ) : (
        <View style={styles.trend}>
          <Ionicons
            name={delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : 'remove'}
            size={18}
            color={delta > 0 ? colors.danger : delta < 0 ? colors.on : colors.inkFaint}
          />
          <Text style={styles.rowDetail}>
            {delta === 0
              ? `Gleich viel wie im ${monthName(months.last_month)}.`
              : `${Math.abs(delta)} % ${delta > 0 ? 'mehr' : 'weniger'} als im ` +
                `${monthName(months.last_month)} zur selben Zeit.`}
          </Text>
        </View>
      )}

      {months.days.length > 1 ? (
        <View style={styles.days}>
          {months.days.map((entry) => (
            <View key={entry.day} style={styles.dayColumn}>
              <View
                style={[
                  styles.dayBar,
                  { height: Math.max(2, Math.round((entry.kwh / peak) * 48)) },
                ]}
              />
            </View>
          ))}
        </View>
      ) : null}
      {months.days.length > 1 ? (
        <Text style={styles.rowDetail}>
          Ein Balken je Tag, der höchste sind {peak.toFixed(1)} kWh.
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Wie oft und wie lange die Haushaltgeräte laufen.
 *
 * Der letzte Lauf steht neben dem Durchschnitt: Erst der Vergleich zeigt,
 * ob ein Gerät schleichend länger braucht – beim Tumbler ist das meist ein
 * verstopftes Flusensieb.
 */
function Cycles({
  stats,
  styles,
  colors,
}: {
  stats: CycleStat[];
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (stats.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Programmläufe</Text>
      {stats.map((entry) => {
        // Ab einem Viertel über dem Schnitt lohnt sich der Hinweis; darunter
        // schwankt jedes Programm ohnehin.
        const longer =
          entry.runs > 2 && entry.last_seconds > entry.average_seconds * 1.25;
        return (
          <View key={entry.entity_id} style={styles.row}>
            <Ionicons
              name={longer ? 'alert-circle-outline' : 'time-outline'}
              size={18}
              color={longer ? colors.danger : colors.inkFaint}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.rowHead}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.rowValue}>{duration(entry.average_seconds)}</Text>
              </View>
              <Text style={styles.rowDetail}>
                {entry.runs} {entry.runs === 1 ? 'Lauf' : 'Läufe'} · zuletzt{' '}
                {duration(entry.last_seconds)}
                {longer ? ' – deutlich länger als sonst' : ''}
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={styles.hint}>
        Gezählt wird ab dem Start – ein Programm, das beim Neustart des Hubs
        schon lief, bleibt aussen vor, statt mit einer geratenen Dauer in der
        Statistik zu stehen.
      </Text>
    </Card>
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
    // Nur zum Messen der verfügbaren Breite für den Verlauf.
    rankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rankNumber: {
    color: colors.inkFaint,
    fontSize: 13,
    fontWeight: '700',
    width: 18,
    textAlign: 'center',
  },
  rankName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  rankValue: {
    color: colors.inkSoft,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  measure: { height: 0 },
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
    trend: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    days: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 3,
      height: 48,
      marginTop: 4,
    },
    dayColumn: { flex: 1, justifyContent: 'flex-end', minWidth: 3 },
    dayBar: { borderRadius: 2, backgroundColor: colors.accent },
    hourChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.track,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    // Wie die Favoriten-Chips der Übersicht: aktiv heisst Akzent-Rand,
    // nicht gefüllt – so bleibt der Text in jeder Theme-Farbe lesbar.
    hourChipActive: { borderColor: colors.accent },
    hourChipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    hourChipTextActive: { color: colors.ink },
  });
