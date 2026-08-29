import { Platform } from 'react-native';

import { aufnahmeFehler, bestesFormat, dauerText, kannAufnehmen } from './sprachnotiz';

describe('bestesFormat', () => {
  it('nimmt Opus, wenn der Browser es kann', () => {
    expect(bestesFormat((typ) => typ === 'audio/webm;codecs=opus')).toBe(
      'audio/webm;codecs=opus'
    );
  });

  it('weicht auf mp4 aus, wenn es kein WebM gibt', () => {
    // Safari nimmt mp4 auf, nicht WebM.
    expect(bestesFormat((typ) => typ === 'audio/mp4')).toBe('audio/mp4');
  });

  it('liefert nichts, wenn der Browser keines kennt', () => {
    expect(bestesFormat(() => false)).toBeUndefined();
  });

  it('lässt sich von einer werfenden Prüfung nicht aufhalten', () => {
    expect(
      bestesFormat((typ) => {
        if (typ.includes('webm')) throw new Error('kaputt');
        return typ === 'audio/mp4';
      })
    ).toBe('audio/mp4');
  });
});

describe('dauerText', () => {
  it('zählt Sekunden', () => {
    expect(dauerText(7400)).toBe('0:07');
  });

  it('füllt die Sekunden auf zwei Stellen', () => {
    expect(dauerText(65_000)).toBe('1:05');
  });

  it('zeigt bei negativen Werten null', () => {
    expect(dauerText(-500)).toBe('0:00');
  });
});

describe('aufnahmeFehler', () => {
  it('nennt die fehlende Freigabe beim Namen', () => {
    expect(aufnahmeFehler({ name: 'NotAllowedError' })).toContain('nicht freigegeben');
  });

  it('unterscheidet ein fehlendes von einem belegten Mikrofon', () => {
    expect(aufnahmeFehler({ name: 'NotFoundError' })).toBe('Kein Mikrofon gefunden.');
    expect(aufnahmeFehler({ name: 'NotReadableError' })).toContain('belegt');
  });

  it('hat auch für Unbekanntes einen Satz', () => {
    expect(aufnahmeFehler(new Error('was auch immer'))).toBe('Die Aufnahme ging nicht los.');
  });
});


describe('kannAufnehmen', () => {
  const echt = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: echt, configurable: true });
  });

  function auf(os: string) {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }

  it('sagt auf dem Telefon ja, ohne vorher zu fragen', () => {
    // Nach der Erlaubnis zu fragen, bloss um den Knopf zu zeigen, hiesse
    // das Fenster «HomePilot möchte auf das Mikrofon zugreifen»
    // aufzumachen, bevor jemand etwas sagen wollte.
    auf('ios');
    expect(kannAufnehmen()).toBe(true);
  });

  it('fragt im Browser das Fenster, ob es eines hat', () => {
    auf('web');
    const recorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    // Ein Knopf, der nie geht, ist ein Versprechen, das die App nicht hält.
    expect(kannAufnehmen()).toBe(false);
    if (recorder) (globalThis as { MediaRecorder?: unknown }).MediaRecorder = recorder;
  });
});

describe('aufnahmeFehler, je nach Welt', () => {
  const echt = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: echt, configurable: true });
  });

  it('schickt einen ans Telefon und nicht in den Browser', () => {
    // «Im Browser erlauben» half auf dem iPhone niemandem.
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    expect(aufnahmeFehler({ name: 'NotAllowedError' })).toContain(
      'Einstellungen des Telefons'
    );
  });
});
