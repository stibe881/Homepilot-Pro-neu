/** Die Kopplung des Fernsehers – die Rechnerei dazu. */
import { Entity } from '../api/types';
import {
  brauchtKopplung,
  codeSauber,
  codeVollstaendig,
  kannKoppeln,
  kopplungsZeile,
} from './fernsehkopplung';

const geraet = (state: Record<string, unknown>): Entity =>
  ({
    id: 'androidtv.10_0_0_5',
    kind: 'media_player',
    name: 'Fernseher Wohnzimmer',
    integration: 'androidtv',
    state,
    commands: ['sleep_timer'],
    available: true,
  }) as Entity;

describe('brauchtKopplung', () => {
  it('fragt nur, wenn der Hub die Kopplung ausdrücklich vermisst', () => {
    expect(brauchtKopplung(geraet({ paired: false }))).toBe(true);
    expect(brauchtKopplung(geraet({ paired: true }))).toBe(false);
  });

  it('behauptet nichts, wo der Hub nichts sagt', () => {
    // Ältere Hub-Fassung oder ein ganz anderes Gerät: Eine
    // Aufforderung zum Koppeln auf einer Hue-Lampe wäre schlimmer als
    // gar keine.
    expect(brauchtKopplung(geraet({}))).toBe(false);
  });
});

describe('kannKoppeln', () => {
  it('gilt für jeden Android-TV, auch den gerade gekoppelten', () => {
    // «Wo finde ich nun das Verbinden zu einem Android TV?» - der Weg
    // stand nur da, wo der Hub die Kopplung schon als abgelehnt erlebt
    // hatte. Ein Weg, den man erst sieht, wenn es zu spät ist, ist
    // keiner. Und es gibt den Fall «verbindet, aber keine Taste wirkt» -
    // da steht «paired» auf ja.
    expect(kannKoppeln(geraet({ paired: true }))).toBe(true);
    expect(kannKoppeln(geraet({ paired: false }))).toBe(true);
  });

  it('lässt jedes andere Gerät in Ruhe', () => {
    expect(kannKoppeln(geraet({}))).toBe(false);
    expect(kannKoppeln(geraet({ paired: 'vielleicht' }))).toBe(false);
  });
});

describe('codeSauber', () => {
  it('nimmt Leerzeichen und Kleinbuchstaben, wie sie kommen', () => {
    // Der Fernseher zeigt «A1B2C3», getippt wird auf einem Telefon.
    expect(codeSauber(' a1b 2c3 ')).toBe('A1B2C3');
    expect(codeSauber('123456789')).toBe('123456');
    expect(codeSauber('')).toBe('');
  });
});

describe('codeVollstaendig', () => {
  it('lässt erst bei sechs Zeichen bestätigen', () => {
    expect(codeVollstaendig('12345')).toBe(false);
    expect(codeVollstaendig('1 2 3 4 5 6')).toBe(true);
  });
});

describe('kopplungsZeile', () => {
  it('unterscheidet «nicht gekoppelt» von «nicht erreichbar»', () => {
    // Zwei ganz verschiedene nächste Schritte: einmal muss jemand vor
    // den Fernseher, einmal braucht es nur Strom und Netz.
    expect(kopplungsZeile(geraet({ paired: false }))).toBe('Nicht gekoppelt');
    expect(
      kopplungsZeile({ ...geraet({ paired: true }), available: false })
    ).toBe('Gekoppelt · gerade nicht erreichbar');
    expect(kopplungsZeile(geraet({ paired: true }))).toBe('Gekoppelt');
  });

  it('sagt «nicht gekoppelt» auch bei einem Gerät, das gerade weg ist', () => {
    // Sonst schickte die Zeile jemanden zum Sicherungskasten, obwohl
    // der Fernseher läuft und nur die Anmeldung ablehnt.
    expect(
      kopplungsZeile({ ...geraet({ paired: false }), available: false })
    ).toBe('Nicht gekoppelt');
  });
});
