import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, useColors } from '../theme';
import { ROLE_LABELS } from './UsersScreen';

/**
 * Familie: Wer gehört zum Haushalt, wer ist gerade zuhause, was steht an?
 *
 * Mitglieder kommen aus der Benutzerverwaltung des Hubs. Die Anwesenheit
 * wird – wo vorhanden – aus den UniFi-Präsenz-Geräten gelesen (Gerät, dessen
 * Name den Vornamen enthält). Geburtstage und Termine liefert der Google-
 * Kalender; ohne Integration stehen Demo-Daten da.
 */

interface Member {
  name: string;
  role: string;
}

interface Props {
  settings: HubSettings;
  entities: Entity[];
  currentUser?: { name: string; role: string } | null;
}

const DEMO_MEMBERS: Member[] = [
  { name: 'Stefan', role: 'besitzer' },
  { name: 'Anna', role: 'bewohner' },
];

const DEMO_BIRTHDAYS = [
  { name: 'Livia', when: 'in 12 Tagen' },
  { name: 'Marco', when: 'in 4 Wochen' },
];

export function FamilyScreen({ settings, entities, currentUser }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Mitglieder vom Hub – klappt nur mit 'manage_users' (Besitzer). Für alle
  // anderen zeigt die Liste wenigstens die eigene Person.
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersDemo, setMembersDemo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${settings.url}/api/users`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setMembers(data);
      })
      .catch(() => {
        if (!cancelled) {
          if (currentUser) {
            setMembers([{ name: currentUser.name, role: currentUser.role }]);
          } else {
            setMembers(DEMO_MEMBERS);
            setMembersDemo(true);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings.url, settings.token, currentUser]);

  // Anwesenheit: UniFi-Präsenz (binary_sensor, Name enthält den Vornamen).
  const presenceOf = (name: string): 'home' | 'away' | null => {
    const first = name.split(' ')[0].toLowerCase();
    const tracker = entities.find(
      (entity) =>
        entity.kind === 'binary_sensor' &&
        entity.name.toLowerCase().includes(first)
    );
    if (!tracker) return null;
    return tracker.state.state === 'on' ? 'home' : 'away';
  };

  // Kalender: Geburtstage und nächste Termine.
  const calendar = entities.find((entity) => entity.kind === 'calendar');
  const events: any[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  const birthdays = events.filter((event) => /geburtstag|birthday/i.test(event.summary ?? ''));
  const upcoming = events
    .filter((event) => !/geburtstag|birthday/i.test(event.summary ?? ''))
    .slice(0, 4);

  const eventWhen = (event: any) =>
    event.all_day
      ? new Date(event.start).toLocaleDateString('de-CH', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      : new Date(event.start).toLocaleString('de-CH', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  return (
    <View style={styles.stack}>
      <Text style={styles.title}>Familie</Text>

      {/* Mitglieder */}
      <Text style={styles.groupLabel}>
        Mitglieder{membersDemo ? '  ·  Demo' : ''}
      </Text>
      <View style={styles.row}>
        {(members ?? []).map((member) => {
          const presence = presenceOf(member.name);
          return (
            <Card key={member.name} style={styles.memberCard}>
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
                {ROLE_LABELS[member.role] ?? member.role}
              </Text>
              <View style={styles.presenceRow}>
                <View
                  style={[
                    styles.presenceDot,
                    {
                      backgroundColor:
                        presence === 'home'
                          ? colors.on
                          : presence === 'away'
                            ? colors.inkFaint
                            : colors.track,
                    },
                  ]}
                />
                <Text style={styles.presenceText}>
                  {presence === 'home'
                    ? 'Zuhause'
                    : presence === 'away'
                      ? 'Unterwegs'
                      : 'Keine Ortung'}
                </Text>
              </View>
            </Card>
          );
        })}
      </View>
      {members !== null && presenceOf(members[0]?.name ?? '') === null ? (
        <Text style={styles.hint}>
          Für die Anwesenheit in der UniFi-Integration ein Gerät je Person
          eintragen (Name = Vorname), z.B. «iPhone Stefan».
        </Text>
      ) : null}

      {/* Geburtstage */}
      <Text style={styles.groupLabel}>
        Geburtstage{!calendar || birthdays.length === 0 ? '  ·  Demo' : ''}
      </Text>
      <View style={styles.row}>
        {(birthdays.length > 0
          ? birthdays.map((event) => ({
              name: String(event.summary ?? '').replace(/geburtstag/i, '').trim() || event.summary,
              when: eventWhen(event),
            }))
          : DEMO_BIRTHDAYS
        ).map((birthday) => (
          <Card key={birthday.name} style={styles.birthdayCard}>
            <Ionicons name="gift-outline" size={20} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.birthdayName} numberOfLines={1}>
                {birthday.name}
              </Text>
              <Text style={styles.birthdayWhen}>{birthday.when}</Text>
            </View>
          </Card>
        ))}
      </View>

      {/* Familienkalender */}
      <Text style={styles.groupLabel}>
        Nächste Termine{!calendar ? '  ·  Demo' : ''}
      </Text>
      <Card style={styles.calendarCard}>
        {(calendar && upcoming.length > 0
          ? upcoming.map((event) => ({
              title: String(event.summary ?? '—'),
              when: eventWhen(event),
            }))
          : [
              { title: 'Zahnarzt', when: 'Mo 14:30' },
              { title: 'Elternabend', when: 'Mi 19:00' },
              { title: 'Wochenende Tessin', when: 'Sa, ganztägig' },
            ]
        ).map((event, index) => (
          <View key={index} style={styles.eventRow}>
            <View style={styles.eventDot} />
            <Text style={styles.eventTitle} numberOfLines={1}>
              {event.title}
            </Text>
            <Text style={styles.eventWhen}>{event.when}</Text>
          </View>
        ))}
      </Card>
      {!calendar ? (
        <Text style={styles.hint}>
          Google Kalender in der config.yaml einbinden, dann stehen hier die
          echten Termine und Geburtstage.
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
    groupLabel: {
      color: colors.onGradient,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 4,
    },
    hint: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17, marginTop: -6 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },

    memberCard: {
      minHeight: 0,
      alignItems: 'center',
      gap: 6,
      width: 132,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
    memberName: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    memberRole: { color: colors.inkSoft, fontSize: 12 },
    presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    presenceDot: { width: 8, height: 8, borderRadius: 4 },
    presenceText: { color: colors.inkSoft, fontSize: 12 },

    birthdayCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexGrow: 1,
      maxWidth: 240,
    },
    birthdayName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    birthdayWhen: { color: colors.inkSoft, fontSize: 12 },

    calendarCard: { minHeight: 0, gap: 10 },
    eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    eventDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    eventTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', flex: 1 },
    eventWhen: { color: colors.inkSoft, fontSize: 13 },
  });
