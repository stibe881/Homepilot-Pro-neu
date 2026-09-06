import {
  fussnote,
  fussnoten,
  istJahr,
  kwhText,
  lichtDetail,
  monatName,
  stromJahrSaetze,
  stromMonatSaetze,
  temperaturSatz,
  trendText,
  zeitraumTitel,
} from './langzeit';

describe('kwhText', () => {
  it('gibt kleinen Werten eine Nachkommastelle, grossen keine', () => {
    expect(kwhText(8.54)).toBe('8.5 kWh');
    expect(kwhText(142.4)).toBe('142 kWh');
  });

  it('trennt Tausender mit dem Schweizer Apostroph', () => {
    expect(kwhText(1240.6)).toBe('1’241 kWh');
  });
});

describe('trendText', () => {
  it('traegt das Vorzeichen, damit mehr wie mehr aussieht', () => {
    expect(trendText(12)).toBe('+12 %');
    expect(trendText(-8.5)).toBe('−8.5 %');
    expect(trendText(0)).toBe('±0 %');
  });

  it('gibt ohne Vergleichswert nichts aus', () => {
    expect(trendText(null)).toBeNull();
    expect(trendText(undefined)).toBeNull();
  });
});

describe('zeitraumTitel', () => {
  it('macht aus dem Startdatum den Monatsnamen bzw. das Jahr', () => {
    expect(zeitraumTitel('monat', '2026-09-01')).toBe('September 2026');
    expect(zeitraumTitel('jahr', '2026-01-01')).toBe('2026');
  });

  it('reicht Unlesbares durch, statt zu erfinden', () => {
    expect(monatName('kaputt')).toBe('kaputt');
  });
});

describe('stromMonatSaetze', () => {
  const basis = {
    monat: '2026-09',
    aktuell_kwh: 142,
    vormonat_kwh: 127,
    vormonat_gesamt_kwh: 310,
    vorjahresmonat_kwh: 180,
    trend_vormonat_prozent: 11.8,
    trend_vorjahr_prozent: -21.1,
  };

  it('vergleicht fair und sagt das auch', () => {
    const saetze = stromMonatSaetze(basis);
    expect(saetze[0]).toBe(
      'Bisher 142 kWh – 11.8 % mehr als im Vormonat bis zum selben Tag (127 kWh).'
    );
    // Der ganze Vormonat steht daneben, aber als Einordnung, nicht als
    // Vergleich.
    expect(saetze[1]).toBe('Der ganze Vormonat kam auf 310 kWh.');
    expect(saetze[2]).toBe('Derselbe Monat vor einem Jahr: 180 kWh (−21.1 %).');
  });

  it('formuliert weniger als weniger', () => {
    const saetze = stromMonatSaetze({ ...basis, trend_vormonat_prozent: -8 });
    expect(saetze[0]).toContain('8 % weniger als im Vormonat');
  });

  it('sagt ohne Vormonat, dass es nichts zu vergleichen gibt', () => {
    const saetze = stromMonatSaetze({
      ...basis,
      vormonat_kwh: 0,
      vormonat_gesamt_kwh: 0,
      vorjahresmonat_kwh: null,
      trend_vormonat_prozent: null,
      trend_vorjahr_prozent: null,
    });
    expect(saetze).toHaveLength(1);
    expect(saetze[0]).toContain('noch nichts zu vergleichen');
  });
});

describe('stromJahrSaetze', () => {
  it('nennt die aufgezeichneten Tage beider Jahre', () => {
    const saetze = stromJahrSaetze({
      jahr: '2026',
      aktuell_kwh: 1240.6,
      aktuell_tage: 249,
      vorjahr_kwh: 1300,
      vorjahr_tage: 210,
      trend_vorjahr_prozent: -4.6,
    });
    expect(saetze[0]).toBe('2026: bisher 1’241 kWh an 249 aufgezeichneten Tagen.');
    expect(saetze[1]).toBe('Vorjahr bis zum selben Tag: 1’300 kWh an 210 Tagen (−4.6 %).');
  });

  it('sagt ohne Vorjahr, dass der Vergleich fehlt', () => {
    const saetze = stromJahrSaetze({
      jahr: '2026',
      aktuell_kwh: 12,
      aktuell_tage: 3,
      vorjahr_kwh: null,
      vorjahr_tage: 0,
      trend_vorjahr_prozent: null,
    });
    expect(saetze[1]).toBe('Vom Vorjahr gibt es noch keine Vergleichswerte.');
  });
});

describe('istJahr', () => {
  it('unterscheidet die beiden Stromformen', () => {
    expect(
      istJahr({ jahr: '2026', aktuell_kwh: 1, aktuell_tage: 1, vorjahr_tage: 0 })
    ).toBe(true);
    expect(
      istJahr({ monat: '2026-09', aktuell_kwh: 1, vormonat_kwh: 0, vormonat_gesamt_kwh: 0 })
    ).toBe(false);
  });
});

describe('lichtDetail', () => {
  it('zaehlt lesbar und nennt den Raum', () => {
    expect(lichtDetail({ entity_id: 'a', count: 42, name: 'Spots', room: 'Küche' })).toBe(
      '42-mal eingeschaltet · Küche'
    );
    expect(lichtDetail({ entity_id: 'a', count: 1, name: 'Spots', room: null })).toBe(
      'einmal eingeschaltet'
    );
  });
});

describe('temperaturSatz', () => {
  it('nennt den waermsten und den kaeltesten Raum', () => {
    expect(
      temperaturSatz({
        waermster: { raum: 'Büro', mittel_c: 24.5, messwerte: 100 },
        kaeltester: { raum: 'Keller', mittel_c: 17.2, messwerte: 80 },
        raeume: [],
      })
    ).toBe('Am wärmsten Büro (im Mittel 24.5 °C), am kältesten Keller (17.2 °C).');
  });

  it('kroent bei nur einem Raum nicht denselben zweimal', () => {
    expect(
      temperaturSatz({
        waermster: { raum: 'Büro', mittel_c: 24.5, messwerte: 100 },
        kaeltester: { raum: 'Büro', mittel_c: 24.5, messwerte: 100 },
        raeume: [],
      })
    ).toBe('Nur Büro misst – im Mittel 24.5 °C.');
  });
});

describe('fussnoten', () => {
  it('kuerzt die Hub-Erklaerungen zu Fussnoten', () => {
    expect(
      fussnote(
        'temperatur: Supabase nicht konfiguriert - wärmster und kältester Raum brauchen die state_history'
      )
    ).toBe('Ohne Supabase fehlt die Temperatur.');
    expect(
      fussnote('strom: keine Verbrauchs-Mitschrift - es misst noch keine Steckdose mit Zähler')
    ).toContain('Steckdose mit Zähler');
  });

  it('reicht Unbekanntes unveraendert durch', () => {
    expect(fussnote('wetter: kaputt')).toBe('wetter: kaputt');
  });

  it('warnt zuerst vor dem unvollstaendigen Protokoll', () => {
    const noten = fussnoten({
      fehlt: ['licht: im Zeitraum ist kein Einschalten protokolliert'],
      licht: [{ entity_id: 'a', count: 3, name: 'Spots' }],
      licht_vollstaendig: false,
    });
    expect(noten[0]).toContain('Untergrenze');
  });

  it('schweigt, wenn das Protokoll reicht', () => {
    expect(
      fussnoten({ fehlt: [], licht: [], licht_vollstaendig: true })
    ).toHaveLength(0);
  });
});
