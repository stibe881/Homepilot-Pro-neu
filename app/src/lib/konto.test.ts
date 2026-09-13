/**
 * Das eigene Konto: Sitzungen ordnen, Zeilen texten, Passwörter prüfen
 * (Punkt 244 der Werkbank).
 */
import {
  Geraetesitzung,
  geraeteKopf,
  geraeteName,
  geraeteZeile,
  passwortProblem,
  revokedSatz,
  sortiereSitzungen,
} from './konto';

const JETZT_MS = 1_700_000_000_000;
const JETZT_S = JETZT_MS / 1000;

const sitzung = (rest: Partial<Geraetesitzung>): Geraetesitzung => ({
  id: 'sid',
  ...rest,
});

describe('sortiereSitzungen', () => {
  it('stellt das eigene Gerät zuoberst, auch wenn es lange still war', () => {
    // Das eigene Gerät ist der Fixpunkt - nicht das zuletzt benutzte.
    const reihe = sortiereSitzungen([
      sitzung({ id: 'b', seen: JETZT_S - 10 }),
      sitzung({ id: 'a', current: true, seen: JETZT_S - 9999 }),
    ]);
    expect(reihe.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('ordnet den Rest nach der letzten Benutzung, frisch zuerst', () => {
    // Das vergessene iPad im Ferienhaus soll zuunterst stehen.
    const reihe = sortiereSitzungen([
      sitzung({ id: 'alt', seen: JETZT_S - 86_400 * 30 }),
      sitzung({ id: 'frisch', seen: JETZT_S - 60 }),
      sitzung({ id: 'mittel', seen: JETZT_S - 3600 }),
    ]);
    expect(reihe.map((s) => s.id)).toEqual(['frisch', 'mittel', 'alt']);
  });

  it('nimmt created, wenn seen fehlt, und lässt das Original stehen', () => {
    const original = [
      sitzung({ id: 'nur-created', created: JETZT_S - 60 }),
      sitzung({ id: 'gesehen', seen: JETZT_S - 10 }),
    ];
    const reihe = sortiereSitzungen(original);
    expect(reihe.map((s) => s.id)).toEqual(['gesehen', 'nur-created']);
    // Kein Sortieren am lebenden Zustand - der gehört React.
    expect(original[0].id).toBe('nur-created');
  });
});

describe('geraeteName', () => {
  it('nimmt das Label und hat einen Namen für namenlose', () => {
    expect(geraeteName(sitzung({ label: 'Stefans iPhone' }))).toBe('Stefans iPhone');
    expect(geraeteName(sitzung({ label: '  ' }))).toBe('Unbenanntes Gerät');
    expect(geraeteName(sitzung({}))).toBe('Unbenanntes Gerät');
  });
});

describe('geraeteZeile', () => {
  it('nennt das eigene Gerät beim Namen der Zusicherung', () => {
    // Wer aufräumt, braucht vor allem die Gewissheit, nicht das Gerät
    // in der eigenen Hand zu beenden.
    expect(geraeteZeile(sitzung({ current: true, seen: JETZT_S }), JETZT_MS)).toBe(
      'dieses Gerät'
    );
  });

  it('sagt bei den anderen, wann sie zuletzt da waren', () => {
    expect(geraeteZeile(sitzung({ seen: JETZT_S - 3 * 3600 }), JETZT_MS)).toBe(
      'zuletzt vor 3 Std.'
    );
    expect(geraeteZeile(sitzung({}), JETZT_MS)).toBe('nie benutzt');
  });

  it('kennzeichnet Sitzungen, die nie ablaufen', () => {
    // Das Wandtablet sähe sonst aus wie eine vergessene Anmeldung.
    expect(
      geraeteZeile(sitzung({ keep: true, seen: JETZT_S - 60 }), JETZT_MS)
    ).toContain('bleibt angemeldet');
  });
});

describe('passwortProblem', () => {
  it('verlangt zuerst das bisherige Passwort', () => {
    expect(passwortProblem('', 'neunzeichen', 'neunzeichen')).toContain('bisherige');
  });

  it('verlangt acht Zeichen für das neue', () => {
    expect(passwortProblem('altes', 'kurz', 'kurz')).toContain('acht Zeichen');
  });

  it('lehnt dasselbe Passwort ab', () => {
    // Ein Wechsel auf sich selbst würde trotzdem alle anderen Geräte
    // abmelden - ohne dass irgendetwas sicherer geworden wäre.
    expect(passwortProblem('gleichbleibt', 'gleichbleibt', 'gleichbleibt')).toContain(
      'dasselbe'
    );
  });

  it('fängt die vertippte Wiederholung', () => {
    expect(passwortProblem('altes', 'neunzeichen', 'neunzeichem')).toContain(
      'stimmen nicht überein'
    );
  });

  it('lässt eine saubere Eingabe durch', () => {
    expect(passwortProblem('altes', 'neunzeichen', 'neunzeichen')).toBeNull();
  });
});

describe('revokedSatz', () => {
  it('nennt die Zahl der abgemeldeten Geräte', () => {
    expect(revokedSatz(0)).toBe('Passwort geändert. Sonst war kein Gerät angemeldet.');
    expect(revokedSatz(1)).toBe(
      'Passwort geändert – das eine andere Gerät wurde abgemeldet.'
    );
    expect(revokedSatz(3)).toBe('Passwort geändert – 3 andere Geräte wurden abgemeldet.');
  });
});

describe('geraeteZeile mit Adresse (Punkt 626)', () => {
  it('sagt, woher die Anmeldung kam', () => {
    expect(
      geraeteZeile(sitzung({ seen: JETZT_S - 3 * 3600, address: '192.168.1.44' }), JETZT_MS)
    ).toBe('zuletzt vor 3 Std. · 192.168.1.44');
  });

  it('verschweigt, was der Hub selbst nicht weiss', () => {
    // Alte Sitzungen haben keine Adresse; «unbekannt» schreibt der Hub
    // ohne Absender - beides ist keine Auskunft.
    expect(geraeteZeile(sitzung({ current: true }), JETZT_MS)).toBe('dieses Gerät');
    expect(geraeteZeile(sitzung({ seen: JETZT_S - 300, address: 'unbekannt' }), JETZT_MS)).toBe(
      'zuletzt vor 5 Min.'
    );
  });
});

describe('geraeteKopf (Punkt 625)', () => {
  it('beantwortet «ist da noch etwas angemeldet?» im zugeklappten Zustand', () => {
    expect(geraeteKopf(null, JETZT_MS)).toBe('wird geladen …');
    expect(geraeteKopf([], JETZT_MS)).toBe('keine angemeldeten Geräte');
    expect(geraeteKopf([sitzung({ seen: JETZT_S - 3600 * 3 })], JETZT_MS)).toBe(
      '1 Gerät · zuletzt vor 3 Std.'
    );
    // Das jüngste zählt - nicht das vergessene.
    expect(
      geraeteKopf(
        [sitzung({ seen: JETZT_S - 86400 * 30 }), sitzung({ id: 'b', seen: JETZT_S - 300 })],
        JETZT_MS
      )
    ).toBe('2 Geräte · zuletzt vor 5 Min.');
  });
});
