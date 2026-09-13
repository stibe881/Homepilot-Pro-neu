import { tastenStaerke } from './tastenhaptik';

describe('Wie sich eine Taste anfühlt', () => {
  /**
   * Das Steuerkreuz drückt man in Serie – fünfmal nach unten durch ein
   * Menü. Ein Stampfen bei jedem Druck wäre lästiger als hilfreich.
   */
  it('das Steuerkreuz tickt fein', () => {
    for (const taste of ['dpad_up', 'dpad_down', 'dpad_left', 'dpad_right']) {
      expect(tastenStaerke(taste)).toBe('leicht');
    }
  });

  it('OK und die Ein-/Aus-Taste sind Entscheidungen', () => {
    for (const taste of ['ok', 'toggle', 'turn_on', 'turn_off']) {
      expect(tastenStaerke(taste)).toBe('kraeftig');
    }
  });

  it('alles andere tickt fein', () => {
    for (const taste of ['back', 'home', 'volume_up', 'volume_down', 'mute', 'play']) {
      expect(tastenStaerke(taste)).toBe('leicht');
    }
  });

  it('das Kreuz der PlayStation wiegt wie OK, die übrigen Konsolentasten ticken fein', () => {
    // Punkt 634: Kreuz bestätigt - dieselbe Rolle wie OK. Kreis,
    // Dreieck, Viereck und die Reihe darunter drückt man im Menü in
    // Serie, wie das Steuerkreuz.
    expect(tastenStaerke('cross')).toBe('kraeftig');
    for (const taste of ['circle', 'triangle', 'square', 'share', 'ps', 'options']) {
      expect(tastenStaerke(taste)).toBe('leicht');
    }
  });

  it('eine unbekannte Taste tickt auch – kein Sonderfall', () => {
    expect(tastenStaerke('irgendwas')).toBe('leicht');
  });
});
