import {
  BATTERIE,
  FUNKSTILLE,
  SABOTAGE,
  blindStufe,
  blindTitel,
  artWort,
} from './alarmblind';

const stelle = (art: string, label = 'Keller') => ({
  entity_id: 'hm.keller',
  label,
  art,
});

describe('blindTitel', () => {
  it('nennt Sabotage zuerst', () => {
    // Dieselbe Regel wie im Hub: Sabotage gehört in die Zeile, die man
    // zuerst liest, nicht in den Text darunter.
    expect(blindTitel([stelle(BATTERIE), stelle(SABOTAGE)])).toBe('Sabotage gemeldet');
  });

  it('zählt stille Sensoren', () => {
    expect(blindTitel([stelle(FUNKSTILLE)])).toBe('Ein Sensor antwortet nicht');
    expect(blindTitel([stelle(FUNKSTILLE), stelle(FUNKSTILLE, 'Bad')])).toBe(
      '2 Sensoren antworten nicht'
    );
  });

  it('schweigt, wenn nichts blind ist', () => {
    expect(blindTitel([])).toBe('');
    expect(blindStufe([])).toBeNull();
  });
});

describe('blindStufe', () => {
  it('unterscheidet drei Stufen', () => {
    // Eine schwache Batterie in Gelb neben gemeldeter Sabotage in Rot
    // sagt auf einen Blick, was zuerst drankommt.
    expect(blindStufe([stelle(SABOTAGE)])).toBe('sabotage');
    expect(blindStufe([stelle(FUNKSTILLE)])).toBe('warn');
    expect(blindStufe([stelle(BATTERIE)])).toBe('hinweis');
  });
});

describe('artWort', () => {
  it('sagt, was fehlt – nicht nur, dass etwas fehlt', () => {
    expect(artWort(FUNKSTILLE)).toBe('antwortet nicht mehr');
  });

  it('reicht Unbekanntes durch, statt es zu verschlucken', () => {
    expect(artWort('etwas Neues')).toBe('etwas Neues');
  });
});
