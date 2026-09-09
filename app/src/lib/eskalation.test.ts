import {
  ESKALATION_VORGABE,
  eskalationLesen,
  eskalationStand,
  fristLabel,
  sensorenStand,
  sirenenKandidaten,
  verlaufPasst,
} from './eskalation';

describe('eskalationLesen', () => {
  it('faellt bei einem alten Hub ohne Feld auf die Vorgaben zurueck', () => {
    expect(eskalationLesen(undefined)).toEqual(ESKALATION_VORGABE);
    expect(eskalationLesen(null)).toEqual(ESKALATION_VORGABE);
  });

  it('liest eine vollstaendige Konfiguration', () => {
    expect(
      eskalationLesen({
        enabled: true,
        after: 60,
        sirens: ['hue.sirene', ''],
        all_lights: true,
        announce: 'Achtung',
        volume: 80,
      })
    ).toEqual({
      enabled: true,
      after: 60,
      sirens: ['hue.sirene'],
      all_lights: true,
      announce: 'Achtung',
      volume: 80,
    });
  });

  it('begrenzt die Lautstaerke und laesst null als Vorgabe stehen', () => {
    expect(eskalationLesen({ volume: 150 }).volume).toBe(100);
    expect(eskalationLesen({ volume: null }).volume).toBeNull();
  });

  it('laesst eine unsinnige Frist auf der Vorgabe', () => {
    expect(eskalationLesen({ after: -5 }).after).toBe(30);
    expect(eskalationLesen({ after: 'bald' }).after).toBe(30);
  });
});

describe('fristLabel', () => {
  it('nennt Sekunden, Minuten und den Sofort-Fall beim Namen', () => {
    expect(fristLabel(0)).toBe('sofort');
    expect(fristLabel(30)).toBe('30 s');
    expect(fristLabel(120)).toBe('2 min');
  });
});

describe('sirenenKandidaten', () => {
  const sirene = {
    id: 'z.sirene',
    name: 'Sirene Flur',
    kind: 'switch',
    commands: ['turn_on', 'turn_off'],
  };
  const alert = {
    id: 'z.alert',
    name: 'Warnton',
    kind: 'alert',
    commands: ['turn_on'],
  };
  const steckdose = {
    id: 'z.dose',
    name: 'Steckdose Keller',
    kind: 'switch',
    commands: ['turn_on', 'turn_off'],
  };
  const lampe = {
    id: 'hue.spot',
    name: 'Spots',
    kind: 'light',
    commands: ['turn_on', 'turn_off'],
  };
  const kontakt = {
    id: 'z.fenster',
    name: 'Fenster',
    kind: 'binary_sensor',
    commands: [],
  };

  it('stellt Sirenen vor die uebrigen Schalter', () => {
    const kandidaten = sirenenKandidaten([steckdose, lampe, sirene, alert, kontakt]);
    expect(kandidaten.map((entity) => entity.id)).toEqual(['z.sirene', 'z.alert', 'z.dose']);
  });

  it('erkennt eine Sirene auch an der device_class', () => {
    const perKlasse = { ...steckdose, state: { device_class: 'siren' } };
    expect(sirenenKandidaten([perKlasse])[0]).toBe(perKlasse);
  });

  it('bietet nichts an, was sich nicht einschalten laesst', () => {
    expect(sirenenKandidaten([kontakt])).toHaveLength(0);
  });
});

describe('eskalationStand', () => {
  it('sagt aus, solange sie aus ist', () => {
    expect(eskalationStand(ESKALATION_VORGABE)).toBe('aus');
  });

  it('fasst Frist und Wirkung zusammen', () => {
    expect(
      eskalationStand({
        enabled: true,
        after: 30,
        sirens: ['a'],
        all_lights: true,
        announce: 'Hallo',
        volume: null,
      })
    ).toBe('nach 30 s: Sirene, alle Lichter, Durchsage');
  });

  it('verraet, wenn sie eingeschaltet ist, aber nichts taete', () => {
    expect(
      eskalationStand({ ...ESKALATION_VORGABE, enabled: true, sirens: [] })
    ).toBe('an, aber ohne Wirkung');
  });
});

describe('verlaufPasst', () => {
  it('zaehlt die Eskalation zum Alarm-Filter', () => {
    expect(verlaufPasst('escalated', 'triggered')).toBe(true);
    expect(verlaufPasst('triggered', 'triggered')).toBe(true);
    expect(verlaufPasst('escalated', 'armed')).toBe(false);
    expect(verlaufPasst('escalated', 'alle')).toBe(true);
  });
});

describe('sensorenStand', () => {
  it('sagt zugeklappt, wie viele Sensoren im Modus wachen', () => {
    // Die Karte beginnt zugeklappt - dann muss ihr Kopf die Frage
    // beantworten, für die man sonst aufklappen müsste.
    expect(sensorenStand('Nacht', 4)).toBe('Nacht: 4 Sensoren');
    expect(sensorenStand('Abwesend', 1)).toBe('Abwesend: 1 Sensor');
  });

  it('nennt die Null beim Namen', () => {
    // Die wichtigste Auskunft der Seite: Eine scharfe Anlage ohne
    // zugeordneten Sensor bewacht nichts.
    expect(sensorenStand('Nacht', 0)).toBe('Nacht: 0 Sensoren');
  });

  it('kommt auch ohne Modusnamen zurecht', () => {
    expect(sensorenStand('', 2)).toBe('2 Sensoren');
  });
});
