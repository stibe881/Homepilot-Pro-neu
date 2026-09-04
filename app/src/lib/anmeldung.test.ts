/**
 * Die Anmeldemaske - und der erzwungene Wechsel des Initialpassworts.
 *
 * Der Fall: Der Verwalter legt «Maja» mit einem Initialpasswort an.
 * Maja meldet sich mit ihrem Namen an (keine E-Mail nötig) und muss
 * beim ersten Mal ein eigenes Passwort setzen - das Initialpasswort
 * kennt ja auch der Verwalter.
 */
import { looksLikeEmail, validate, wechselProblem } from './anmeldung';

describe('validate', () => {
  test('beim Anmelden genügt ein Name - für das Initialpasswort', () => {
    expect(validate('login', 'Maja', 'initial-123')).toBeNull();
    expect(validate('login', 'du@example.ch', 'initial-123')).toBeNull();
  });

  test('ohne Eingabe oder mit kurzem Passwort geht nichts', () => {
    expect(validate('login', '  ', 'initial-123')).toContain('Name oder E-Mail');
    expect(validate('login', 'Maja', 'kurz')).toContain('acht Zeichen');
  });

  test('Passwort vergessen braucht zwingend eine E-Mail-Adresse', () => {
    expect(validate('recover', 'Maja', '')).toContain('E-Mail');
    expect(validate('recover', 'du@example.ch', '')).toBeNull();
  });
});

describe('wechselProblem', () => {
  test('ein gutes neues Passwort geht durch', () => {
    expect(wechselProblem('initial-123', 'mein-eigenes-9', 'mein-eigenes-9')).toBeNull();
  });

  test('zu kurz, gleich wie vorher oder nicht wiederholt - je ein Satz', () => {
    expect(wechselProblem('initial-123', 'kurz', 'kurz')).toContain('acht Zeichen');
    expect(wechselProblem('initial-123', 'initial-123', 'initial-123')).toContain(
      'anderes'
    );
    expect(wechselProblem('initial-123', 'mein-eigenes-9', 'vertippt')).toContain(
      'stimmen nicht überein'
    );
  });
});

test('looksLikeEmail bleibt grosszügig, aber nicht beliebig', () => {
  expect(looksLikeEmail('du@example.ch')).toBe(true);
  expect(looksLikeEmail('Maja')).toBe(false);
});
