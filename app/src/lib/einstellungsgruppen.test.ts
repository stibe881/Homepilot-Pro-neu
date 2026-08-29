import {
  GRUPPEN,
  alarmPlakette,
  farbeVon,
  filtere,
  gruppiere,
  passt,
} from './einstellungsgruppen';

const punkt = (key: string, label: string, detail = '') => ({ key, label, detail });

describe('gruppiere', () => {
  it('ordnet die Punkte den Gruppen in der festgelegten Reihenfolge zu', () => {
    const gruppen = gruppiere([
      punkt('system', 'System'),
      punkt('alarm', 'Alarmanlage'),
      punkt('account', 'Konto'),
      punkt('automations', 'Abläufe'),
    ]);
    expect(gruppen.map((gruppe) => gruppe.key)).toEqual(['bedienen', 'geraet', 'einrichten']);
    // Innerhalb der Gruppe zählt die Reihenfolge aus GRUPPEN, nicht die
    // der übergebenen Liste.
    expect(gruppen[0].punkte.map((p) => p.key)).toEqual(['automations', 'alarm']);
  });

  it('lässt leere Gruppen weg', () => {
    const gruppen = gruppiere([punkt('account', 'Konto')]);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0].titel).toBe('Dieses Gerät');
  });

  it('verliert keinen Punkt, den niemand einer Gruppe zugeordnet hat', () => {
    const gruppen = gruppiere([punkt('account', 'Konto'), punkt('neuling', 'Neu')]);
    const sammel = gruppen.find((gruppe) => gruppe.key === 'weitere');
    expect(sammel?.punkte.map((p) => p.key)).toEqual(['neuling']);
  });

  it('gibt bei leerer Eingabe nichts zurück', () => {
    expect(gruppiere([])).toEqual([]);
  });

  it('kennt jede in GRUPPEN genannte Taste nur einmal', () => {
    const alle = GRUPPEN.flatMap((gruppe) => gruppe.keys);
    expect(new Set(alle).size).toBe(alle.length);
  });
});

describe('passt', () => {
  it('findet über den Namen', () => {
    expect(passt(punkt('energy', 'Energie', 'Verbrauch je Gerät'), 'ener')).toBe(true);
  });

  it('findet über die Beschreibung', () => {
    expect(passt(punkt('energy', 'Energie', 'Verbrauch und Kosten'), 'kosten')).toBe(true);
  });

  it('findet über ein Stichwort, das nirgends steht', () => {
    // «push» kommt im Text des Kontos nicht vor - gesucht wird es trotzdem.
    expect(passt(punkt('account', 'Konto', 'Profil und Darstellung'), 'push')).toBe(true);
    expect(passt(punkt('besuch', 'Besuch', 'Wer gerade da ist'), 'wlan')).toBe(true);
  });

  it('ist gegen Akzente und Grossschreibung gleichgültig', () => {
    expect(passt(punkt('automations', 'Abläufe', ''), 'ABLAUFE')).toBe(true);
    expect(passt(punkt('automations', 'Abläufe', ''), 'abläu')).toBe(true);
  });

  it('verlangt alle Wörter, aber in beliebiger Reihenfolge', () => {
    const konto = punkt('account', 'Konto', 'Profil, Darstellung, App-Symbol');
    expect(passt(konto, 'push konto')).toBe(true);
    expect(passt(konto, 'konto push')).toBe(true);
    expect(passt(konto, 'konto zigbee')).toBe(false);
  });

  it('lässt ohne Suchtext alles durch', () => {
    expect(passt(punkt('system', 'System', ''), '')).toBe(true);
    expect(passt(punkt('system', 'System', ''), '   ')).toBe(true);
  });
});

describe('filtere', () => {
  it('behält die Reihenfolge der Eingabe', () => {
    const punkte = [
      punkt('alarm', 'Alarmanlage', 'Sensoren'),
      punkt('system', 'System', 'Sicherung'),
      punkt('energy', 'Energie', 'Verbrauch'),
    ];
    expect(filtere(punkte, 'sicher').map((p) => p.key)).toEqual(['alarm', 'system']);
  });
});

describe('farbeVon', () => {
  it('gibt jedem bekannten Punkt einen Ton', () => {
    expect(farbeVon('energy')).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('fällt bei Unbekanntem auf Grau zurück, statt zu fehlen', () => {
    expect(farbeVon('gibtsnicht')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('alarmPlakette', () => {
  it('nennt die echte Anlage scharf, sobald sie nicht unscharf ist', () => {
    expect(alarmPlakette('alarm', 'armed_away')).toEqual({ text: 'Scharf', ton: 'gut' });
    expect(alarmPlakette('alarm', 'unscharf')).toEqual({ text: 'Unscharf', ton: 'ruhig' });
    expect(alarmPlakette('alarm', 'disarmed')).toEqual({ text: 'Unscharf', ton: 'ruhig' });
  });

  it('warnt, wenn sie ausgelöst hat', () => {
    expect(alarmPlakette('alarm', 'ausgeloest')).toEqual({ text: 'Ausgelöst', ton: 'warnung' });
    expect(alarmPlakette('alarm', 'triggered')?.ton).toBe('warnung');
  });

  it('kennt beim Notnagel-Schalter nur ein und aus', () => {
    expect(alarmPlakette('switch', 'on')).toEqual({ text: 'Scharf', ton: 'gut' });
    expect(alarmPlakette('switch', 'off')).toEqual({ text: 'Unscharf', ton: 'ruhig' });
  });

  it('schweigt ohne Zustand, statt etwas zu behaupten', () => {
    expect(alarmPlakette('alarm', '')).toBeUndefined();
    expect(alarmPlakette('alarm', null)).toBeUndefined();
  });
});
