import { Entity } from '../api/types';
import {
  FALLBACK_MINUTEN,
  chipZeile,
  fensterZeile,
  kannTimer,
  restMinuten,
  timerAuswahl,
  timerZeile,
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

  it('schreibt die Restzeit auch in die Raumzeile', () => {
    // Der Timer ist eine eigene Entität neben dem Fernseher. In der
    // Raumkachel stand darüber «Läuft» - richtig und nutzlos, denn was
    // man wissen will, ist: wie lange noch.
    const timerGeraet = (over: Record<string, unknown>): Entity =>
      ({
        id: 'androidtv.schlafzimmer_timer',
        name: 'Fernseher Schlafzimmer Timer',
        kind: 'timer',
        integration: 'androidtv',
        available: true,
        commands: ['sleep_timer'],
        state: over,
      }) as unknown as Entity;

    expect(timerZeile(timerGeraet({ state: 'on', sleep_until: JETZT / 1000 + 9 * 60 }), JETZT)).toBe(
      '9 min'
    );
    // Ohne bekanntes Ende bleibt «Läuft» - immer noch mehr als «Aus».
    expect(timerZeile(timerGeraet({ state: 'on' }), JETZT)).toBe('Läuft');
    expect(timerZeile(timerGeraet({ state: 'off' }), JETZT)).toBe('Aus');
    // Ein abgelaufener Zeitpunkt ist kein Timer mehr.
    expect(
      timerZeile(timerGeraet({ state: 'off', sleep_until: JETZT / 1000 - 60 }), JETZT)
    ).toBe('Aus');
  });

  it('sagt im Fenster, ob schon einer läuft', () => {
    expect(fensterZeile(tv(), JETZT)).toBe('Kein Timer gestellt');
    expect(fensterZeile(tv({ sleep_until: JETZT / 1000 + 120 * 60 }), JETZT)).toBe(
      'Der Fernseher geht in 2 h aus'
    );
  });
});
