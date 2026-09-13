/**
 * Die Fernbedienung, einmal als Fernseher und einmal als PlayStation
 * (Punkt 643).
 *
 * Geprüft wird, was ein Mensch auf dem Blatt findet: An der Konsole die
 * Symboltasten des Controllers und Share · PS · Options - und keine
 * Lautstärke, keinen Transport, kein OK in der Mitte des Kreuzes. Am
 * Fernseher alles wie vorher; der Umbau darf ihn nicht anfassen.
 */
import fs from 'fs';
import React from 'react';
import { Text } from 'react-native';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Entity } from '../api/types';
import { TvRemote } from './TvRemote';

// Die Symbolschrift zieht das halbe Expo-Font-Paket nach; hier zählt
// die Beschriftung der Tasten, nicht ihr Zeichen.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
  MaterialCommunityIcons: () => null,
}));

const mockTapped = jest.fn();
const mockTriggered = jest.fn();
jest.mock('../lib/haptics', () => ({
  tapped: () => mockTapped(),
  triggered: () => mockTriggered(),
}));

const konsole = {
  id: 'playstation.192_168_1_60',
  kind: 'media_player',
  name: 'PlayStation 5',
  integration: 'playstation',
  state: { state: 'on', has_screen: true, apps: [], app: 'Gran Turismo 7', paired: true },
  commands: [
    'turn_on',
    'turn_off',
    'toggle',
    'dpad_up',
    'dpad_down',
    'dpad_left',
    'dpad_right',
    'ok',
    'back',
    'home',
    'ps',
    'cross',
    'circle',
    'triangle',
    'square',
    'options',
    'share',
  ],
  available: true,
} as unknown as Entity;

const fernseher = {
  id: 'androidtv.10_0_0_5',
  kind: 'media_player',
  name: 'Fernseher Wohnzimmer',
  integration: 'androidtv',
  state: { state: 'on', app: 'Plex', paired: true },
  commands: [
    'toggle',
    'dpad_up',
    'ok',
    'back',
    'home',
    'volume_up',
    'volume_down',
    'mute',
    'next',
  ],
  available: true,
} as unknown as Entity;

const texte = (baum: ReactTestRenderer): string =>
  baum.root
    .findAllByType(Text)
    .map((knoten) => String(knoten.props.children))
    .join(' | ');

/** Über die Beschriftung, nicht über den Bauteiltyp - sie ist ohnehin
 *  das, woran ein Mensch die Taste erkennt. */
const taste = (baum: ReactTestRenderer, label: string) =>
  baum.root.findAll(
    (k) => k.props.accessibilityLabel === label && typeof k.props.onPress === 'function'
  )[0]?.props as { onPress: () => void } | undefined;

beforeEach(() => {
  mockTapped.mockReset();
  mockTriggered.mockReset();
});

describe('TvRemote an der PlayStation', () => {
  it('zeigt die Tasten des Controllers und nichts vom Fernseher', async () => {
    const onCommand = jest.fn();
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote
          visible
          name="egal"
          onClose={() => {}}
          onCommand={onCommand}
          entity={konsole}
        />
      );
    });
    for (const label of [
      'Dreieck',
      'Viereck',
      'Kreis',
      'Kreuz',
      'Share',
      'PS',
      'Options',
    ]) {
      expect(taste(baum, label)).toBeTruthy();
    }
    // Das Steuerkreuz bleibt, An/Aus auch.
    expect(taste(baum, 'Hoch')).toBeTruthy();
    expect(taste(baum, 'An/Aus')).toBeTruthy();
    // Kein OK (das Kreuz bestätigt), keine Lautstärke, kein Transport,
    // kein Home - die Konsole kann nichts davon.
    for (const label of [
      'OK',
      'Lauter',
      'Leiser',
      'Stumm',
      'Play/Pause',
      'Weiter',
      'Home',
    ]) {
      expect(taste(baum, label)).toBeUndefined();
    }
  });

  it('heisst wie die Konsole und nennt das laufende Spiel', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote
          visible
          name="egal"
          onClose={() => {}}
          onCommand={() => {}}
          entity={konsole}
        />
      );
    });
    expect(texte(baum)).toContain('PlayStation 5');
    expect(texte(baum)).toContain('Gran Turismo 7');
    expect(texte(baum)).not.toContain('egal');
  });

  it('schickt die Befehle aus dem Vertrag - und das Kreuz wiegt wie OK', async () => {
    const onCommand = jest.fn();
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote
          visible
          name="egal"
          onClose={() => {}}
          onCommand={onCommand}
          entity={konsole}
        />
      );
    });
    await act(async () => {
      taste(baum, 'Kreuz')!.onPress();
    });
    expect(onCommand).toHaveBeenLastCalledWith('cross', undefined);
    expect(mockTriggered).toHaveBeenCalledTimes(1);
    await act(async () => {
      taste(baum, 'Kreis')!.onPress();
      taste(baum, 'Options')!.onPress();
      taste(baum, 'PS')!.onPress();
    });
    expect(onCommand.mock.calls.map((aufruf) => aufruf[0])).toEqual([
      'cross',
      'circle',
      'options',
      'ps',
    ]);
    expect(mockTapped).toHaveBeenCalledTimes(3);
  });
});

describe('TvRemote am Fernseher', () => {
  it('bleibt, wie sie war', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote
          visible
          name="Fernseher Wohnzimmer"
          onClose={() => {}}
          onCommand={() => {}}
          entity={fernseher}
        />
      );
    });
    for (const label of ['OK', 'Home', 'Lauter', 'Play/Pause', 'An/Aus']) {
      expect(taste(baum, label)).toBeTruthy();
    }
    for (const label of ['Kreuz', 'Kreis', 'Share', 'PS', 'Options']) {
      expect(taste(baum, label)).toBeUndefined();
    }
    expect(texte(baum)).toContain('Fernseher Wohnzimmer');
  });

  it('ist ohne Gerät ein Fernseher - die bestehenden Aufrufe bleiben gültig', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<TvRemote visible name="TV" onClose={() => {}} onCommand={() => {}} />);
    });
    expect(taste(baum, 'OK')).toBeTruthy();
    expect(taste(baum, 'Kreuz')).toBeUndefined();
  });
});

describe('Die Szenen unten an der Fernbedienung (Punkt 646)', () => {
  it('zeigt bis zu zwei Knöpfe und löst die richtige Szene aus', async () => {
    const onSzene = jest.fn();
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote
          visible
          name="Fernseher Wohnzimmer"
          onClose={() => {}}
          onCommand={() => {}}
          entity={fernseher}
          szenen={[
            { id: 'kino', name: 'Kino' },
            { id: 'zocken', name: 'Zocken' },
          ]}
          onSzene={onSzene}
        />
      );
    });
    expect(texte(baum)).toContain('Kino');
    expect(texte(baum)).toContain('Zocken');
    await act(async () => {
      taste(baum, 'Szene Zocken starten')!.onPress();
    });
    expect(onSzene).toHaveBeenCalledWith('zocken');
  });

  it('zeigt nichts ohne Auswahl', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote
          visible
          name="Fernseher Wohnzimmer"
          onClose={() => {}}
          onCommand={() => {}}
          entity={fernseher}
        />
      );
    });
    expect(texte(baum)).not.toContain('Kino');
  });
});

describe('TvRemote und die Befehlsliste des Geräts', () => {
  it('lässt Ton- und Abspieltasten weg, die das Gerät nicht führt', async () => {
    // Der Fall aus dem Haus (Punkt 643): Vom Raumkopf aus kam die
    // PlayStation ins Fernseher-Blatt, und jede Ton-Taste endete beim Hub
    // mit «unterstützt das Kommando nicht».
    const nurSteuerkreuz = {
      ...fernseher,
      commands: ['toggle', 'dpad_up', 'ok', 'back', 'home'],
    } as unknown as Entity;
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote visible name="egal" onClose={() => {}} onCommand={() => {}} entity={nurSteuerkreuz} />
      );
    });
    expect(taste(baum, 'Stumm')).toBeUndefined();
    expect(taste(baum, 'Play/Pause')).toBeUndefined();
    expect(taste(baum, 'Zurück')).toBeDefined();
  });

  it('zeigt dem Fernseher weiterhin alles', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <TvRemote visible name="egal" onClose={() => {}} onCommand={() => {}} entity={fernseher} />
      );
    });
    expect(taste(baum, 'Stumm')).toBeDefined();
  });

  it('bekommt vom Raumkopf aus das Gerät mit', () => {
    // Quelltext-Prüfung: Die zweite Fernbedienung der Startseite muss
    // `entity` durchreichen, sonst bedient sie jede Konsole als Fernseher.
    const quelle = fs.readFileSync(`${__dirname}/../screens/DashboardScreen.tsx`, 'utf8');
    const stelle = quelle.slice(quelle.indexOf('<TvRemote'));
    const block = stelle.slice(0, stelle.indexOf('/>'));
    expect(block).toMatch(/entity=\{remoteTv\}/);
  });
});

