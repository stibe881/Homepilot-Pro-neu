import { Entity } from '../api/types';
import {
  anwesenheitsSatz,
  geburtstagsName,
  geburtstagsSatz,
  terminSatz,
} from './startkarte';

const zone = (name: string, stand: string): Entity =>
  ({
    id: `geofence.${name.toLowerCase()}`,
    name,
    kind: 'binary_sensor',
    integration: 'geofence',
    state: { state: stand },
    commands: [],
  }) as unknown as Entity;

describe('anwesenheitsSatz', () => {
  it('nennt, wer daheim und wer unterwegs ist - mit Vornamen', () => {
    expect(
      anwesenheitsSatz([
        zone('Stefan Gross', 'home'),
        zone('Bine', 'home'),
        zone('Levin', 'away'),
      ])
    ).toBe('Stefan & Bine zuhause · Levin unterwegs');
  });

  it('behauptet nichts über Zonen, die sich nie gemeldet haben', () => {
    expect(anwesenheitsSatz([zone('Levin', 'unknown')])).toBeNull();
    expect(anwesenheitsSatz([])).toBeNull();
  });

  it('zählt die Sammelfrage «anyone_home» nicht als Person', () => {
    const sammel = zone('Jemand zuhause', 'on');
    (sammel as { id: string }).id = 'geofence.anyone_home';
    expect(anwesenheitsSatz([sammel, zone('Stefan', 'home')])).toBe(
      'Stefan zuhause'
    );
  });

  it('führt eine benannte Zone («quartier») als unterwegs', () => {
    // Wer im Quartier ist, ist nicht daheim - aber geortet.
    expect(anwesenheitsSatz([zone('Levin', 'quartier')])).toBe('Levin unterwegs');
  });
});

describe('terminSatz', () => {
  it('kürzt die Adresse auf ihren lesbaren Teil', () => {
    expect(
      terminSatz('17:30', 'Fussballtraining', 'Sportplatz, 6210 Sursee, Schweiz')
    ).toBe('17:30 Fussballtraining, Sportplatz');
  });

  it('kommt ohne Ort aus und schweigt ohne Titel', () => {
    expect(terminSatz('17:30', 'Fussballtraining', null)).toBe(
      '17:30 Fussballtraining'
    );
    expect(terminSatz('17:30', '', 'Sursee')).toBeNull();
  });
});

describe('geburtstagsName', () => {
  it('lässt vom Kalender-Satz den Namen übrig', () => {
    expect(geburtstagsName('Flo hat Geburtstag')).toBe('Flo');
    expect(geburtstagsName('Geburtstag von Oma')).toBe('Oma');
    expect(geburtstagsName("Sam's birthday")).toBe('Sam');
    expect(geburtstagsName('Reto – Geburtstag')).toBe('Reto');
    expect(geburtstagsName('Flo')).toBe('Flo');
  });
});

describe('geburtstagsSatz', () => {
  const jetzt = new Date('2026-08-30T18:00:00');

  it('nennt den nächsten Geburtstag mit Abstand', () => {
    const events = [
      { summary: 'Zahnarzt', start: '2026-08-31T09:00:00', birthday: false },
      { summary: 'Flo hat Geburtstag', start: '2026-09-04', birthday: true, all_day: true },
    ];
    expect(geburtstagsSatz(events, jetzt)).toBe('Flo in 5 Tagen');
  });

  it('schweigt ohne Geburtstage', () => {
    expect(geburtstagsSatz([], jetzt)).toBeNull();
    expect(geburtstagsSatz(null, jetzt)).toBeNull();
  });
});
