/** Entwurf ↔ gespeicherte Form: die neuen Felder aus dem zweiten Heft. */
import {
  EMPTY,
  EMPTY_STEP,
  EMPTY_TRIGGER,
  buildConditions,
  stepToActions,
  actionsToSteps,
  triggerFromConfig,
  triggerToConfig,
  zeitpunktLabel,
} from './entwurf';

describe('Zufalls-Versatz (Punkt 155)', () => {
  it('wandert in die gespeicherte Form und zurück', () => {
    const config = triggerToConfig({ ...EMPTY_TRIGGER, kind: 'time', at: '21:30', jitter: '15' });
    expect(config).toEqual({ type: 'time', at: '21:30', jitter: 15 });
    expect(triggerFromConfig(config).jitter).toBe('15');
  });

  it('leer oder Unsinn heisst pünktlich', () => {
    expect(triggerToConfig({ ...EMPTY_TRIGGER, kind: 'time', at: '21:30' }).jitter).toBeUndefined();
    expect(
      triggerToConfig({ ...EMPTY_TRIGGER, kind: 'sun', jitter: 'viel' }).jitter
    ).toBeUndefined();
  });
});

describe('Feiertags-Bedingung (Punkt 154)', () => {
  it('speichert das Häkchen als except_holidays', () => {
    const conditions = buildConditions({
      ...EMPTY,
      conditionKind: 'time',
      exceptHolidays: true,
    });
    expect(conditions).toEqual([{ type: 'time', except_holidays: true }]);
  });

  it('ohne Häkchen bleibt die Bedingung schlank', () => {
    const conditions = buildConditions({
      ...EMPTY,
      conditionKind: 'time',
      conditionAfter: '08:00',
    });
    expect(conditions[0].except_holidays).toBeUndefined();
  });
});

describe('Nachricht-Empfänger (Punkt 158)', () => {
  it('leer heisst weiterhin an alle', () => {
    const [action] = stepToActions({ ...EMPTY_STEP, kind: 'notify', title: 'Hallo', body: '' });
    expect(action.to).toBe('all');
  });

  it('ein Name wandert hin und zurück', () => {
    const [action] = stepToActions({
      ...EMPTY_STEP,
      kind: 'notify',
      title: 'Wäsche',
      body: 'fertig',
      notifyTo: 'Stefan',
    });
    expect(action.to).toBe('Stefan');
    const [zurueck] = actionsToSteps([action]);
    expect(zurueck.notifyTo).toBe('Stefan');
    // «all» wird beim Öffnen wieder zur leeren Auswahl.
    expect(actionsToSteps([{ ...action, to: 'all' }])[0].notifyTo).toBe('');
  });
});

describe('zeitpunktLabel (Punkte 159/161)', () => {
  const jetzt = new Date(2026, 7, 22, 12, 0); // Samstag
  it('sagt heute, morgen oder den Wochentag', () => {
    const heute = new Date(2026, 7, 22, 21, 12).getTime() / 1000;
    const morgen = new Date(2026, 7, 23, 6, 0).getTime() / 1000;
    const montag = new Date(2026, 7, 24, 9, 5).getTime() / 1000;
    expect(zeitpunktLabel(heute, jetzt)).toBe('heute 21:12');
    expect(zeitpunktLabel(morgen, jetzt)).toBe('morgen 06:00');
    expect(zeitpunktLabel(montag, jetzt)).toBe('Mo 09:05');
  });
});
