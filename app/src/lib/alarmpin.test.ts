/**
 * Die PIN-Abfrage vor dem Entschärfen über die Kachel.
 *
 * Der Fall dahinter: Das Wandtablet ist Bewohner, kommt also nie in den
 * Alarm-Bildschirm mit seinem PIN-Feld. Ohne diese Prüfung schickte die
 * Kachel ein nacktes «toggle» und bekam eine Fehlermeldung zurück.
 */
import { entschaerft, verlangtPin } from './alarmpin';

const anlage = (over: Record<string, unknown> = {}) => ({
  integration: 'alarm',
  state: { state: 'scharf', ...over },
});

describe('entschaerft', () => {
  it('erkennt die eindeutigen Befehle', () => {
    expect(entschaerft('disarm', 'scharf')).toBe(true);
    expect(entschaerft('turn_off', 'scharf')).toBe(true);
  });

  it('liest «toggle» am Zustand ab', () => {
    expect(entschaerft('toggle', 'scharf')).toBe(true);
    expect(entschaerft('toggle', 'ausgeloest')).toBe(true);
    expect(entschaerft('toggle', 'unscharf')).toBe(false);
  });

  it('lässt das Scharfschalten in Ruhe', () => {
    expect(entschaerft('arm_night', 'unscharf')).toBe(false);
  });
});

describe('verlangtPin', () => {
  it('fragt, wenn der Hub eine PIN kennt', () => {
    expect(verlangtPin(anlage({ pin_required: true }), 'toggle', false)).toBe(true);
  });

  it('fragt am Gemeinschaftsgerät auch ohne gesetzte PIN', () => {
    // Damit dort ein Feld steht statt einer Fehlermeldung - der Hub
    // lehnt diesen Fall ohnehin ab.
    expect(verlangtPin(anlage(), 'toggle', true)).toBe(true);
  });

  it('fragt am Telefon ohne gesetzte PIN nicht', () => {
    expect(verlangtPin(anlage(), 'toggle', false)).toBe(false);
  });

  it('fragt nicht zweimal', () => {
    expect(verlangtPin(anlage({ pin_required: true }), 'toggle', true, '2580')).toBe(
      false
    );
  });

  it('lässt das Licht in Ruhe', () => {
    expect(
      verlangtPin({ integration: 'demo', state: { state: 'on' } }, 'toggle', true)
    ).toBe(false);
  });

  it('verträgt eine fehlende Entität', () => {
    expect(verlangtPin(undefined, 'toggle', true)).toBe(false);
  });
});
