/**
 * «Konsole koppeln» auf der Verbindungen-Seite (Punkt 643).
 *
 * Geprüft wird der Weg, den ein Mensch geht: Anmeldung im Browser
 * öffnen, die Adresse der Seite danach einfügen, dann den Code von der
 * Konsole eintippen. Und dass die App den Hub fragt, wo sie steht -
 * ein Konto, das schon liegt, soll niemand ein zweites Mal anmelden.
 */
import React from 'react';
import { Linking, Text } from 'react-native';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Entity } from '../api/types';
import { PsKopplung } from './PsKopplung';

const mockGet = jest.fn();
const mockPost = jest.fn();

// Die Symbolschrift zieht das halbe Expo-Font-Paket nach; hier zählt
// der Weg durch die Kachel, nicht das Kettensymbol davor.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../api/client', () => ({
  hubClient: () => ({ get: mockGet, post: mockPost }),
}));

jest.mock('../hooks/HubContext', () => ({
  useSettings: () => ({ url: 'http://hub', token: 'x' }),
}));

const PFAD = '/api/playstation/playstation.192_168_1_60/pair';
const RUECKKEHR =
  'https://remoteplay.dl.playstation.net/remoteplay/redirect?code=abc&cid=1';

const ps = {
  id: 'playstation.192_168_1_60',
  kind: 'media_player',
  name: 'PlayStation 5',
  integration: 'playstation',
  state: { state: 'off', paired: false, remote_play: true },
  commands: ['dpad_up', 'cross'],
  available: true,
} as unknown as Entity;

const texte = (baum: ReactTestRenderer): string =>
  baum.root
    .findAllByType(Text)
    .map((knoten) => String(knoten.props.children))
    .join(' | ');

const knopf = (baum: ReactTestRenderer, label: string) =>
  baum.root.findAll(
    (k) => k.props.accessibilityLabel === label && typeof k.props.onPress === 'function'
  )[0]?.props as { onPress: () => void } | undefined;

const feld = (baum: ReactTestRenderer, label: string) =>
  baum.root.findAll(
    (k) =>
      k.props.accessibilityLabel === label && typeof k.props.onChangeText === 'function'
  )[0]?.props as
    { onChangeText: (text: string) => void; onSubmitEditing: () => void } | undefined;

let openURL: jest.SpyInstance;

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ ok: true });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
});

describe('PsKopplung', () => {
  it('geht den ganzen Weg: Anmeldung, Adresse, Code', async () => {
    mockGet.mockResolvedValue({
      account: false,
      paired: false,
      online_id: null,
      remote_play: true,
    });
    mockPost.mockResolvedValueOnce({ ok: true, login_url: 'https://auth.example/login' });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<PsKopplung entity={ps} />);
    });
    expect(mockGet).toHaveBeenCalledWith(PFAD, { still: true });
    expect(texte(baum)).toContain('PSN-Konto');

    // Schritt 1: Anmeldung im Browser.
    await act(async () => {
      knopf(baum, 'PSN-Anmeldung öffnen')!.onPress();
    });
    expect(mockPost).toHaveBeenCalledWith(PFAD, { neu: false }, { still: true });
    expect(openURL).toHaveBeenCalledWith('https://auth.example/login');

    // Die Rückkehr-Adresse einfügen.
    mockPost.mockResolvedValueOnce({ ok: true, online_id: 'stefan' });
    await act(async () => {
      feld(baum, 'Adresse der Seite nach der Anmeldung')!.onChangeText(`  ${RUECKKEHR}\n`);
    });
    await act(async () => {
      knopf(baum, 'Konto übernehmen')!.onPress();
    });
    expect(mockPost).toHaveBeenLastCalledWith(
      `${PFAD}/account`,
      { redirect_url: RUECKKEHR },
      { still: true }
    );

    // Schritt 2: der Code von der Konsole - mit dem Konto davor.
    expect(texte(baum)).toContain('Code von der Konsole');
    expect(texte(baum)).toContain('stefan');
    await act(async () => {
      feld(baum, 'Code von der Konsole')!.onChangeText('1234 5678');
    });
    await act(async () => {
      feld(baum, 'Code von der Konsole')!.onSubmitEditing();
    });
    expect(mockPost).toHaveBeenLastCalledWith(
      `${PFAD}/pin`,
      { pin: '12345678' },
      { still: true }
    );
    expect(texte(baum)).toContain('Gekoppelt');
  });

  it('steigt beim Code ein, wenn das Konto schon liegt', async () => {
    // Ein Konto, das schon da ist, soll niemand ein zweites Mal
    // anmelden müssen - der Hub sagt, wo es steht.
    mockGet.mockResolvedValue({
      account: true,
      paired: false,
      online_id: 'stefan',
      remote_play: true,
    });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<PsKopplung entity={ps} />);
    });
    expect(knopf(baum, 'PSN-Anmeldung öffnen')).toBeUndefined();
    expect(feld(baum, 'Code von der Konsole')).toBeTruthy();
  });

  it('schickt die Anmeldeseite nicht als Rückkehr-Adresse los', async () => {
    // Der naheliegende Fehler: die Adresse kopieren, auf der man sich
    // angemeldet hat - die hat keinen Code.
    mockGet.mockResolvedValue({
      account: false,
      paired: false,
      online_id: null,
      remote_play: true,
    });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<PsKopplung entity={ps} />);
    });
    await act(async () => {
      feld(baum, 'Adresse der Seite nach der Anmeldung')!.onChangeText(
        'https://auth.example/login'
      );
    });
    await act(async () => {
      knopf(baum, 'Konto übernehmen')!.onPress();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('schickt einen halben Code gar nicht erst los', async () => {
    mockGet.mockResolvedValue({
      account: true,
      paired: false,
      online_id: 'stefan',
      remote_play: true,
    });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<PsKopplung entity={ps} />);
    });
    await act(async () => {
      feld(baum, 'Code von der Konsole')!.onChangeText('1234567');
    });
    await act(async () => {
      feld(baum, 'Code von der Konsole')!.onSubmitEditing();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('stellt die Absage neben das Feld und lässt es stehen', async () => {
    // Ein falscher Code gilt an der Konsole weiter - sie zeigt
    // denselben, bis man das Menü verlässt. Der Tippfehler ist
    // wahrscheinlicher als ein neuer Code.
    mockGet.mockResolvedValue({
      account: true,
      paired: false,
      online_id: 'stefan',
      remote_play: true,
    });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<PsKopplung entity={ps} />);
    });
    mockPost.mockRejectedValueOnce(new Error('Die Konsole hat den Code abgelehnt'));
    await act(async () => {
      feld(baum, 'Code von der Konsole')!.onChangeText('99999999');
    });
    await act(async () => {
      feld(baum, 'Code von der Konsole')!.onSubmitEditing();
    });
    expect(texte(baum)).toContain('Die Konsole hat den Code abgelehnt');
    expect(feld(baum, 'Code von der Konsole')).toBeTruthy();
  });

  it('bietet ohne Bibliothek keinen Knopf an', async () => {
    // Die PSN-Anmeldung gehört zur selben Bibliothek wie die Tasten -
    // ein Knopf wäre eine Sackgasse.
    mockGet.mockResolvedValue({
      account: false,
      paired: false,
      online_id: null,
      remote_play: false,
    });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(<PsKopplung entity={ps} />);
    });
    expect(texte(baum)).toContain('Remote-Play-Bibliothek');
    expect(knopf(baum, 'PSN-Anmeldung öffnen')).toBeUndefined();
    expect(knopf(baum, 'Neu koppeln')).toBeUndefined();
  });

  it('steht an der gekoppelten Konsole als ruhige Zeile und fragt den Hub erst beim Aufklappen', async () => {
    mockGet.mockResolvedValue({
      account: true,
      paired: true,
      online_id: 'stefan',
      remote_play: true,
    });
    mockPost.mockResolvedValue({ ok: true, login_url: 'https://auth.example/login' });
    let baum!: ReactTestRenderer;
    await act(async () => {
      baum = create(
        <PsKopplung
          entity={{ ...ps, state: { ...ps.state, paired: true } }}
          dringend={false}
        />
      );
    });
    expect(texte(baum)).toContain('Konsole koppeln');
    expect(mockGet).not.toHaveBeenCalled();

    await act(async () => {
      knopf(baum, 'Konsole koppeln')!.onPress();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(texte(baum)).toContain('Gekoppelt');
    expect(texte(baum)).toContain('stefan');

    // Der Ausweg: Konto und Registrierung weg, von vorn.
    await act(async () => {
      knopf(baum, 'Neu koppeln')!.onPress();
    });
    expect(mockPost).toHaveBeenCalledWith(PFAD, { neu: true }, { still: true });
    expect(openURL).toHaveBeenCalledWith('https://auth.example/login');
    expect(feld(baum, 'Adresse der Seite nach der Anmeldung')).toBeTruthy();
  });
});
