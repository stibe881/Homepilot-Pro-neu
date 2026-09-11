/**
 * Die Geräteauswahl im Ablauf- und Szenen-Editor (Punkt 534 der Werkbank).
 *
 * Geprüft wird, was beim Umbau versprochen wurde: dass jede Chip-Reihe
 * ihre Frage trägt und dass ein eingestelltes Gerät nicht mehr
 * verschwindet, nur weil jemand seinen Namen antippt.
 */
import React from 'react';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Entity } from '../../api/types';
import { SceneDevices } from './szenen-editor';

// Die Symbolschrift zieht das halbe Expo-Font-Paket nach; hier zählt,
// was an Text und Knöpfen dasteht.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const lampe = {
  id: 'demo.licht',
  kind: 'light',
  name: 'Licht Wohnzimmer',
  integration: 'demo',
  room: 'Wohnzimmer',
  state: { state: 'off' },
  commands: ['turn_on', 'turn_off', 'toggle', 'set_brightness', 'set_color_temp'],
  available: true,
} as unknown as Entity;

const texte = (baum: ReactTestRenderer): string[] =>
  baum.root
    .findAll((knoten) => typeof knoten.props.children === 'string')
    .map((knoten) => String(knoten.props.children));

const knopf = (baum: ReactTestRenderer, marke: string): { onPress: () => void } =>
  baum.root.findAll((knoten) => knoten.props.accessibilityLabel === marke)[0]
    .props as { onPress: () => void };

function bauen(actions: { entity_id: string; command: string }[], onActions = jest.fn()) {
  let baum!: ReactTestRenderer;
  act(() => {
    baum = create(
      <SceneDevices
        entities={[lampe]}
        actions={actions}
        onActions={onActions}
        showSnapshot={false}
        allowToggle
        luxSensors={[]}
      />
    );
  });
  return { baum, onActions };
}

describe('Ein gewähltes Gerät im Editor', () => {
  it('stellt jede Chip-Reihe als Frage', () => {
    // Der gemeldete Zustand: fünf Reihen Chips untereinander, beschriftet
    // war eine. «nach Tageszeit» stand allein in einer zweiten Zeile und
    // sah aus wie ein sechster Prozentwert.
    const { baum } = bauen([{ entity_id: lampe.id, command: 'toggle' }]);
    const gesehen = texte(baum);
    expect(gesehen).toContain('Was soll passieren?');
    expect(gesehen).toContain('Helligkeit');
    expect(gesehen).toContain('Oder rechnen lassen');
    expect(gesehen).toContain('Wie lange an?');
    expect(gesehen).toContain('Weisston');
  });

  it('trennt die feste Zahl von der gerechneten Helligkeit', () => {
    const { baum } = bauen([{ entity_id: lampe.id, command: 'toggle' }]);
    const gesehen = texte(baum);
    // Beides steht da - aber unter zwei verschiedenen Fragen, und das
    // hält der Test oben fest. Hier geht es darum, dass die Quelle nicht
    // mehr in der Reihe der Prozentwerte steckt.
    const helligkeit = gesehen.indexOf('Helligkeit');
    const quelle = gesehen.indexOf('Oder rechnen lassen');
    expect(gesehen.indexOf('100 %')).toBeGreaterThan(helligkeit);
    expect(gesehen.indexOf('100 %')).toBeLessThan(quelle);
    expect(gesehen.indexOf('nach Tageszeit')).toBeGreaterThan(quelle);
  });

  it('macht aus dem Namen keinen Knopf mehr', () => {
    // Der Grund für das eigene Kreuz: Vorher war der ganze Kopf die
    // Ankreuzfläche. Wer ein Gerät eingestellt hatte und dann auf den
    // Namen tippte, um nachzusehen, verlor alles daran.
    const { baum, onActions } = bauen([{ entity_id: lampe.id, command: 'toggle' }]);
    const treffer = baum.root.findAll(
      (knoten) =>
        knoten.props.accessibilityRole === 'checkbox' &&
        String(knoten.props.accessibilityLabel ?? '').startsWith('Licht Wohnzimmer')
    );
    expect(treffer).toHaveLength(0);
    // Und die Fläche um den Namen löst auch sonst nichts aus.
    const kopf = baum.root.findAll(
      (knoten) => knoten.props.children === 'Licht Wohnzimmer'
    )[0].props as { onPress?: () => void };
    act(() => {
      kopf.onPress?.();
    });
    expect(onActions).not.toHaveBeenCalled();
  });

  it('nimmt es weg, wenn man das Kreuz drückt', () => {
    const { baum, onActions } = bauen([{ entity_id: lampe.id, command: 'toggle' }]);
    act(() => {
      knopf(baum, 'Licht Wohnzimmer wieder entfernen').onPress();
    });
    expect(onActions).toHaveBeenCalledWith([]);
  });
});

describe('Die Liste, aus der man wählt', () => {
  it('nennt beide Abschnitte beim Namen', () => {
    // Vorher war es eine durchlaufende Reihe von Gerätenamen, in der nur
    // ein Häkchen den Unterschied machte.
    const { baum } = bauen([]);
    expect(texte(baum)).toContain('Gerät wählen');
    const { baum: mitWahl } = bauen([{ entity_id: lampe.id, command: 'turn_on' }]);
    expect(texte(mitWahl)).toContain('Ausgewählt');
    expect(texte(mitWahl)).toContain('1 Gerät');
  });

  it('nimmt ein angetipptes Gerät in die Wahl', () => {
    const { baum, onActions } = bauen([]);
    act(() => {
      knopf(baum, 'Licht Wohnzimmer, Licht').onPress();
    });
    expect(onActions).toHaveBeenCalledTimes(1);
    expect(onActions.mock.calls[0][0]).toHaveLength(1);
  });
});
