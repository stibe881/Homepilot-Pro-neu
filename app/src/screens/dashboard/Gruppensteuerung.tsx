import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CommandData, Entity } from '../../api/types';
import { Bar } from '../../components/Bar';
import { Card } from '../../components/Card';
import { space, useColors } from '../../theme';
import { makeStyles } from './stile';

/** Gruppen-Steuerung: schaltet alle Geräte einer Gruppe auf einmal.
 *  Storen-Gruppen bekommen einen gemeinsamen Prozent-Schieber. */
export function GroupControls({
  entities,
  groups,
  onCommand,
}: {
  entities: Entity[];
  groups: string[];
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  return (
    <View style={{ gap: space.gap }}>
      {groups.map((name) => (
        <GroupRow
          key={name}
          name={name}
          members={entities.filter((entity) => entity.group === name)}
          onCommand={onCommand}
        />
      ))}
    </View>
  );
}

function GroupRow({
  name,
  members,
  onCommand,
}: {
  name: string;
  members: Entity[];
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const covers = members.filter((entity) => entity.kind === 'cover');
  const positionable = covers.filter((entity) => entity.commands.includes('set_position'));
  const switches = members.filter((entity) => entity.commands.includes('turn_on'));
  const locks = members.filter((entity) => entity.kind === 'lock');

  // Startwert des Schiebers: Durchschnitt der aktuellen Storen-Positionen.
  const avg = positionable.length
    ? Math.round(
        positionable.reduce(
          (sum, entity) =>
            sum + (typeof entity.state.position === 'number' ? entity.state.position : 0),
          0
        ) / positionable.length
      )
    : 0;
  const [pos, setPos] = useState(avg);

  const fan = (list: Entity[], command: string, data?: CommandData) =>
    list.forEach((entity) => onCommand(entity.id, command, data));

  return (
    <Card style={styles.groupCard}>
      <View style={styles.groupHead}>
        <Ionicons name="layers-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.groupName}>{name}</Text>
        <Text style={styles.groupCount}>
          {members.length} {members.length === 1 ? 'Gerät' : 'Geräte'}
        </Text>
      </View>

      {switches.length > 0 ? (
        <View style={styles.groupButtons}>
          <GroupButton label="Alle ein" onPress={() => fan(switches, 'turn_on')} />
          <GroupButton label="Alle aus" onPress={() => fan(switches, 'turn_off')} />
        </View>
      ) : null}

      {covers.length > 0 ? (
        <View style={styles.groupButtons}>
          <GroupButton label="Hoch" onPress={() => fan(covers, 'open')} />
          <GroupButton label="Stopp" onPress={() => fan(covers, 'stop')} />
          <GroupButton label="Runter" onPress={() => fan(covers, 'close')} />
        </View>
      ) : null}

      {positionable.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Bar value={pos} onChange={setPos} />
          <GroupButton
            label={`Auf ${pos}% setzen`}
            onPress={() => fan(positionable, 'set_position', { position: pos })}
            wide
          />
        </View>
      ) : null}

      {locks.length > 0 ? (
        <View style={styles.groupButtons}>
          <GroupButton label="Abschliessen" onPress={() => fan(locks, 'lock')} />
          <GroupButton label="Aufschliessen" onPress={() => fan(locks, 'unlock')} />
        </View>
      ) : null}
    </Card>
  );
}

function GroupButton({
  label,
  onPress,
  wide,
}: {
  label: string;
  onPress: () => void;
  wide?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.groupButton,
        wide && { flex: 0, alignSelf: 'stretch' },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={styles.groupButtonText}>{label}</Text>
    </Pressable>
  );
}
