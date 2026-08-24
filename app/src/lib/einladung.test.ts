/**
 * Was die App über eine Einladung sagt.
 */
import { einladungFrist, passwortHinweis } from './einladung';

const JETZT = new Date('2026-08-24T12:00:00');
const inMinuten = (m: number) => (JETZT.getTime() + m * 60000) / 1000;

describe('einladungFrist', () => {
  it('zählt die nächste Stunde in Minuten', () => {
    expect(einladungFrist(inMinuten(45), JETZT)).toBe('in 45 Minuten');
  });

  it('nennt sonst die Uhrzeit', () => {
    expect(einladungFrist(inMinuten(5 * 60), JETZT)).toBe('heute um 17:00');
    expect(einladungFrist(inMinuten(24 * 60), JETZT)).toBe('morgen um 12:00');
    expect(einladungFrist(inMinuten(3 * 24 * 60), JETZT)).toBe('am 27.8. um 12:00');
  });

  it('sagt es, wenn die Frist schon vorbei ist', () => {
    // Sonst stünde «läuft in -20 Minuten ab».
    expect(einladungFrist(inMinuten(-20), JETZT)).toContain('abgelaufen');
  });

  it('verträgt Unsinn', () => {
    expect(einladungFrist(undefined, JETZT)).toBe('irgendwann');
    expect(einladungFrist(0, JETZT)).toBe('irgendwann');
  });
});

describe('passwortHinweis', () => {
  it('verlangt eine Mindestlänge', () => {
    expect(passwortHinweis('abc')).toContain('6 Zeichen');
    expect(passwortHinweis('sommer2026')).toBe('');
  });

  it('stolpert nicht über Leerzeichen am Rand', () => {
    expect(passwortHinweis(' sommer2026 ')).toContain('Leerzeichen');
  });
});
