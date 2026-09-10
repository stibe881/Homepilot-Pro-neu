import { Automation } from '../screens/automations/entwurf';
import {
  dupliziere,
  kopieName,
  pauseBis,
  ruht,
  tiefen,
  warumNicht,
} from './ablaufhilfen';

const ablauf = (patch: Partial<Automation>): Automation =>
  ({
    id: 'a1',
    alias: 'Flurlicht',
    triggers: [],
    conditions: [],
    actions: [],
    editable: true,
    enabled: true,
    ...patch,
  }) as Automation;

describe('Duplizieren (Punkt 313)', () => {
  it('findet einen freien Namen', () => {
    // Zwei Abläufe mit demselben Namen sind der Anfang einer langen
    // Suche: In der Liste sieht man nicht, welcher geschaltet hat.
    expect(kopieName('Flurlicht', [])).toBe('Flurlicht (Kopie)');
    expect(kopieName('Flurlicht', ['Flurlicht (Kopie)'])).toBe('Flurlicht (Kopie 2)');
    expect(kopieName('  ', [])).toBe('Ablauf (Kopie)');
  });

  it('kopiert ausgeschaltet und ohne Verlauf', () => {
    // Eine Kopie, die sofort mitläuft, schaltet dasselbe Gerät ein
    // zweites Mal - bevor jemand sie angepasst hat.
    const kopie = dupliziere(
      ablauf({ last_fired: 123, quiet_until: 456, orphaned: true }),
      ['Flurlicht']
    );
    expect(kopie.id).toBe('');
    expect(kopie.alias).toBe('Flurlicht (Kopie)');
    expect(kopie.enabled).toBe(false);
    expect(kopie.last_fired).toBeNull();
    expect(kopie.quiet_until).toBeNull();
    expect(kopie.orphaned).toBe(false);
  });
});

describe('Pausieren (Punkt 311)', () => {
  it('reicht bis morgens um sechs, nicht 24 Stunden weit', () => {
    // Wer abends um elf pausiert, will es nicht um elf Uhr nachts
    // wieder eingeschaltet bekommen - mitten im Ablauf.
    const abends = new Date('2026-09-10T23:00:00');
    const bis = new Date(pauseBis(1, abends) * 1000);
    expect(bis.getHours()).toBe(6);
    expect(bis.getDate()).toBe(11);
  });

  it('sagt, ob gerade Ruhe ist', () => {
    const jetzt = new Date('2026-09-10T12:00:00Z');
    expect(ruht({ quiet_until: jetzt.getTime() / 1000 + 60 }, jetzt)).toBe(true);
    expect(ruht({ quiet_until: jetzt.getTime() / 1000 - 60 }, jetzt)).toBe(false);
    expect(ruht({ quiet_until: null }, jetzt)).toBe(false);
  });
});

describe('Einrückung (Punkt 316)', () => {
  it('rückt ein, was zu einem if gehört', () => {
    expect(
      tiefen([{ kind: 'command' }, { kind: 'if' }, { kind: 'command' }, { kind: 'end' }, { kind: 'command' }])
    ).toEqual([0, 0, 1, 0, 0]);
  });

  it('fällt nicht unter null', () => {
    expect(tiefen([{ kind: 'end' }, { kind: 'command' }])).toEqual([0, 0]);
  });
});

describe('Warum nicht gelaufen (Punkt 309)', () => {
  it('nennt die Bedingung, die nicht passte', () => {
    // Ohne diese Antwort baut man den Ablauf um, obwohl bloss eine
    // Bedingung nicht passte.
    expect(warumNicht({ executed: false, skipped: ['Sonne steht zu hoch'] })).toBe(
      'Nicht gelaufen: Sonne steht zu hoch passte nicht'
    );
    expect(warumNicht({ executed: false, skipped: ['a', 'b'] })).toBe(
      'Nicht gelaufen: 2 Bedingungen passten nicht'
    );
  });

  it('schweigt, wenn er gelaufen ist', () => {
    expect(warumNicht({ executed: true })).toBe('');
    expect(warumNicht(null)).toBe('');
  });

  it('nennt einen Fehler beim Namen', () => {
    expect(warumNicht({ executed: false, error: 'Hue antwortet nicht' })).toBe(
      'Fehler: Hue antwortet nicht'
    );
  });
});
