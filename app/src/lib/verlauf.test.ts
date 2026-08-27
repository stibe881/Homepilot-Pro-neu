/**
 * Der Satz unter dem Geräteverlauf: bis wann reicht er?
 *
 * Getestet wird die Fallunterscheidung, nicht die Formulierung: Ein
 * übergelaufener Ringpuffer und ein junger Hub sagen dasselbe («wenige
 * Einträge») und meinen Gegenteiliges.
 */
import { reichweiteText } from './verlauf';

const JETZT = new Date('2026-08-21T12:00:00Z').getTime();
const VOR_DREI_STUNDEN = JETZT / 1000 - 3 * 3600;

describe('reichweiteText', () => {
  it('sagt beim jungen Hub, dass das Protokoll erst seit dem Start läuft', () => {
    const text = reichweiteText(
      { started: VOR_DREI_STUNDEN, oldest: VOR_DREI_STUNDEN, count: 4, limit: 2000, full: false },
      JETZT
    );
    expect(text).toContain('ersten Start');
    // Er ist nicht mehr flüchtig - das darf dastehen.
    expect(text).toContain('übersteht Neustarts');
    expect(text).not.toContain('gefallen');
  });

  it('sagt beim vollen Puffer, dass Älteres weg ist', () => {
    const text = reichweiteText(
      { started: JETZT / 1000 - 90 * 3600, oldest: VOR_DREI_STUNDEN, count: 2000, limit: 2000, full: true },
      JETZT
    );
    expect(text).toContain('gefallen');
  });

  it('schweigt, wenn der Hub die Spanne nicht mitgeschickt hat', () => {
    expect(reichweiteText(null, JETZT)).toBe('');
  });
});
