import {
  artStand,
  ersterWeg,
  kinderStand,
  reichweiteStand,
  sichtschutzStand,
  zugangStand,
} from './benutzerblatt';

describe('Welcher Zugangsweg offen steht', () => {
  it('ohne Adresse der QR-Code – der schnellste Weg, wenn man danebensteht', () => {
    expect(ersterWeg(null)).toBe('qr');
    expect(ersterWeg('')).toBe('qr');
  });

  it('mit hinterlegter Adresse die E-Mail – der Weg war schon einmal dieser', () => {
    expect(ersterWeg('lina@example.ch')).toBe('mail');
  });
});

describe('Was im zugeklappten Kopf steht', () => {
  it('unbegrenzt, wenn nichts eingestellt ist', () => {
    expect(zugangStand(null, null)).toBe('unbegrenzt');
  });

  it('das Ablaufdatum, wenn eines gesetzt ist', () => {
    expect(zugangStand('2026-09-01', null)).toBe('bis 2026-09-01');
  });

  it('das Zeitfenster dazu', () => {
    expect(zugangStand('2026-09-01', { from: '07:00', to: '20:00' })).toBe(
      'bis 2026-09-01 · 07:00–20:00'
    );
    expect(zugangStand(null, { from: '22:00', to: '06:00' })).toBe(
      'unbegrenzt · 22:00–06:00'
    );
  });

  it('aber keine halbe Zeitangabe – die sperrt nichts', () => {
    expect(zugangStand(null, { from: '07:00', to: '' })).toBe('unbegrenzt');
    expect(zugangStand(null, { from: '', to: '20:00' })).toBe('unbegrenzt');
  });

  it('sagt, ob es eine Person oder das Wandtablet ist', () => {
    expect(artStand(true)).toBe('Gemeinschaftsgerät');
    expect(artStand(false)).toBe('Persönlicher Zugang');
    expect(artStand(undefined)).toBe('Persönlicher Zugang');
  });

  it('sagt, ob ein Riegel liegt', () => {
    expect(sichtschutzStand(true)).toBe('Passwort gesetzt');
    expect(sichtschutzStand(false)).toBe('kein Riegel');
  });

  it('zählt die Räume der Kinder-Ansicht, statt sie aufzuzählen', () => {
    expect(kinderStand(null)).toBe('aus');
    expect(kinderStand([])).toBe('aus');
    expect(kinderStand(['Küche'])).toBe('1 Raum');
    expect(kinderStand(['Küche', 'Bad', 'Levins Zimmer'])).toBe('3 Räume');
  });
});

describe('reichweiteStand', () => {
  it('sagt ausdrücklich, dass ohne Auswahl alles gilt', () => {
    // Fehlt der Satz, sieht der Abschnitt aus wie eine Einstellung, die
    // man noch machen muss - während er richtig steht.
    expect(reichweiteStand(null)).toBe('ganzes Haus');
    expect(reichweiteStand([])).toBe('ganzes Haus');
  });

  it('nennt den einen Raum beim Namen', () => {
    // «1 Raum» beantwortet die Frage nicht, «Kinderzimmer Levin» schon.
    expect(reichweiteStand(['Kinderzimmer Levin'])).toBe('Kinderzimmer Levin');
    expect(reichweiteStand(['Küche', 'Bad'])).toBe('2 Räume');
  });
});
