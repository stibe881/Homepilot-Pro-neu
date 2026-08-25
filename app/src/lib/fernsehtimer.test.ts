import { Entity } from '../api/types';
import {
  FALLBACK_MINUTEN,
  chipZeile,
  fensterZeile,
  kannTimer,
  restMinuten,
  timerAuswahl,
} from './fernsehtimer';

const JETZT = 1_700_000_000_000;

const tv = (over: Record<string, unknown> = {}, commands = ['sleep_timer']): Entity =>
  ({
    id: 'androidtv.wohnzimmer',
    name: 'Fernseher',
    kind: 'media_player',
    integration: 'androidtv',
    available: true,
    commands,
    state: { state: 'on', ...over },
  }) as unknown as Entity;

describe('Einschlaf-Timer des Fernsehers', () => {
  it('rechnet die Restzeit aus dem Zeitpunkt des Hubs', () => {
    // Der Hub schickt einen Zeitpunkt, keinen Zähler: Wer einschläft,
    // sperrt sein Telefon, und ein Timer, der davon abhinge, wäre keiner.
    expect(restMinuten(JETZT / 1000 + 90 * 60, JETZT)).toBe(90);
    // Aufgerundet - «0 min» neben einem laufenden Timer liest sich wie
    // ein Fehler.
    expect(restMinuten(JETZT / 1000 + 10, JETZT)).toBe(1);
    expect(restMinuten(JETZT / 1000 - 60, JETZT)).toBeNull();
    expect(restMinuten(null, JETZT)).toBeNull();
    expect(restMinuten(undefined, JETZT)).toBeNull();
  });

  it('erkennt, welches Gerät einen Timer kann', () => {
    expect(kannTimer(tv())).toBe(true);
    expect(kannTimer(tv({}, ['turn_on', 'turn_off']))).toBe(false);
  });

  it('nimmt die Zeiten des Hubs, sonst die eigenen', () => {
    expect(timerAuswahl(tv({ sleep_minutes: [30, 60, 90, 120, 150] }))).toEqual([
      30, 60, 90, 120, 150,
    ]);
    // Ältere Hub-Fassungen schicken die Liste nicht mit.
    expect(timerAuswahl(tv())).toEqual(FALLBACK_MINUTEN);
    expect(timerAuswahl(tv({ sleep_minutes: ['x', null] }))).toEqual(FALLBACK_MINUTEN);
  });

  it('schreibt die Restzeit auf den Favoriten-Chip', () => {
    // Genau das war der Wunsch: auf der Startseite sehen, wie lange der
    // Fernseher noch läuft. Vorher stand dort «An» - das weiss man
    // selbst, man sitzt ja davor.
    expect(chipZeile(tv({ sleep_until: JETZT / 1000 + 90 * 60 }), JETZT)).toBe(
      'Aus in 1 h 30 min'
    );
    expect(chipZeile(tv({ sleep_until: JETZT / 1000 + 30 * 60 }), JETZT)).toBe(
      'Aus in 30 min'
    );
    // Ohne Timer wieder die schlichte Auskunft.
    expect(chipZeile(tv(), JETZT)).toBe('An');
    expect(chipZeile(tv({ state: 'off' }), JETZT)).toBe('Aus');
  });

  it('sagt im Fenster, ob schon einer läuft', () => {
    expect(fensterZeile(tv(), JETZT)).toBe('Kein Timer gestellt');
    expect(fensterZeile(tv({ sleep_until: JETZT / 1000 + 120 * 60 }), JETZT)).toBe(
      'Der Fernseher geht in 2 h aus'
    );
  });
});
