/**
 * «Fernseher koppeln» auf der Kachel.
 *
 * Geprüft wird der Weg, den ein Mensch geht: Knopf drücken, zum
 * Fernseher schauen, Zahl eintippen. Und dass eine Absage dort steht,
 * wo man sie sucht - neben dem Feld und nicht als Einblendung, die
 * wieder weg ist, bevor man sie gelesen hat.
 */
import React from 'react';
import { Text } from 'react-native';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Entity } from '../api/types';
import { TvKopplung } from './TvKopplung';

const mockPost = jest.fn();

// Die Symbolschrift zieht das halbe Expo-Font-Paket nach; hier zählt
// der Weg durch die Kachel, nicht das Kettensymbol davor.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../api/client', () => ({
  hubClient: () => ({ post: mockPost }),
}));

jest.mock('../hooks/HubContext', () => ({
  useSettings: () => ({ url: 'http://hub', token: 'x' }),
}));

const tv = {
  id: 'androidtv.10_0_0_5',
  kind: 'media_player',
  name: 'Fernseher Wohnzimmer',
  integration: 'androidtv',
  state: { state: 'off', paired: false },
  commands: ['sleep_timer'],
  available: false,
} as unknown as Entity;

const texte = (baum: ReactTestRenderer): string =>
  baum.root
    .findAllByType(Text)
    .map((knoten) => String(knoten.props.children))
    .join(' | ');

/** Über die Beschriftung und nicht über den Bauteiltyp: `Pressable` ist
 *  unter dem Prüfstand nicht dasselbe Objekt, die Beschriftung schon –
 *  und sie ist ohnehin das, woran ein Mensch den Knopf erkennt. */
const knopf = (baum: ReactTestRenderer, label: string) =>
  baum.root.findAll(
    (k) => k.props.accessibilityLabel === label && typeof k.props.onPress === 'function'
  )[0]?.props as { onPress: () => void } | undefined;

const feld = (baum: ReactTestRenderer) =>
  baum.root.findAll((k) => typeof k.props.onChangeText === 'function')[0].props as {
    onChangeText: (text: string) => void;
    onSubmitEditing: () => void;
  };

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue({ ok: true });
});

describe('TvKopplung', () => {
  it('fragt erst, dann nimmt es den Code entgegen', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<TvKopplung entity={tv} />);
    });
    expect(texte(baum)).toContain('Nicht gekoppelt');

    await act(async () => {
      knopf(baum, 'Fernseher koppeln')!.onPress();
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/androidtv/androidtv.10_0_0_5/pair',
      { neu: false },
      { still: true }
    );

    // Jetzt steht die Zahl auf dem Fernseher - und hier ein Feld dafür.
    await act(async () => {
      feld(baum).onChangeText(' a1b 2c3 ');
    });
    await act(async () => {
      feld(baum).onSubmitEditing();
    });
    expect(mockPost).toHaveBeenLastCalledWith(
      '/api/androidtv/androidtv.10_0_0_5/pair/code',
      { code: 'A1B2C3' },
      { still: true }
    );
  });

  it('schickt einen halben Code gar nicht erst los', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<TvKopplung entity={tv} />);
    });
    await act(async () => {
      knopf(baum, 'Fernseher koppeln')!.onPress();
    });
    mockPost.mockClear();
    await act(async () => {
      feld(baum).onChangeText('123');
    });
    await act(async () => {
      feld(baum).onSubmitEditing();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('stellt die Absage neben das Feld und geht zurück auf Anfang', async () => {
    // Ein falscher Code beendet den Versuch auch beim Fernseher: Er zeigt
    // beim nächsten Anlauf eine neue Zahl. Gegen die alte weiterzuprüfen
    // hiesse, gegen nichts zu prüfen.
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<TvKopplung entity={tv} />);
    });
    await act(async () => {
      knopf(baum, 'Fernseher koppeln')!.onPress();
    });
    mockPost.mockRejectedValueOnce(new Error('Der Code stimmt nicht'));
    await act(async () => {
      feld(baum).onChangeText('999999');
    });
    await act(async () => {
      feld(baum).onSubmitEditing();
    });
    expect(texte(baum)).toContain('Der Code stimmt nicht');
    expect(knopf(baum, 'Fernseher koppeln')).toBeTruthy();
  });

  it('bietet den Ausweg für das tote Zertifikat an', async () => {
    // Wer am Fernseher die Daten des Remote-Dienstes löscht, dessen
    // Zertifikat verbindet weiter und wirkt nicht mehr - ohne «ganz neu»
    // käme man aus dem Zustand nie heraus.
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<TvKopplung entity={tv} />);
    });
    await act(async () => {
      knopf(baum, 'Ganz neu koppeln')!.onPress();
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/androidtv/androidtv.10_0_0_5/pair',
      { neu: true },
      { still: true }
    );
  });
});
