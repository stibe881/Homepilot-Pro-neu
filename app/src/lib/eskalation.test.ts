import {
  ESKALATION_VORGABE,
  Schaltbar,
  boxenKandidaten,
  eskalationLesen,
  eskalationStand,
  fristLabel,
  geschaltetStand,
  istSirene,
  sensorenStand,
  sirenenGruppen,
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
        announce: 'Achtung',
        announce_target: 'raum',
        announce_speakers: ['cast.kueche', ''],
        volume: 80,
      })
    ).toEqual({
      enabled: true,
      after: 60,
      sirens: ['hue.sirene'],
      announce: 'Achtung',
      announce_target: 'raum',
      announce_speakers: ['cast.kueche'],
      volume: 80,
    });
  });

  it('faellt bei unbekanntem Durchsageziel auf «alle» zurueck', () => {
    // Im Alarmfall ist eine Durchsage überallhin besser als gar keine -
    // dieselbe Regel wie im Hub (integrations/alarm_rules.py).
    expect(eskalationLesen({ announce_target: 'kueche' }).announce_target).toBe('alle');
    expect(eskalationLesen({}).announce_target).toBe('alle');
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
        ...ESKALATION_VORGABE,
        enabled: true,
        after: 30,
        sirens: ['a'],
        announce: 'Hallo',
      })
    ).toBe('nach 30 s: Sirene, Durchsage');
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

describe('sirenenGruppen', () => {
  const geraet = (teile: Partial<Schaltbar>): Schaltbar => ({
    id: 'x.y',
    name: 'Gerät',
    kind: 'switch',
    commands: ['turn_on', 'turn_off'],
    ...teile,
  });

  it('trennt echte Sirenen von gewöhnlichen Schaltern', () => {
    // Im Haus stand unter «Sirenen» ein einziger Eintrag: «Tumbler».
    // Das ist keine Sirene, sondern die Steckdose, an der einer hängt -
    // und als einziger Vorschlag unter dieser Überschrift liest es sich
    // wie ein Fehler des Programms.
    const gruppen = sirenenGruppen([
      geraet({ id: 'hm.sirene', name: 'Sirene Flur' }),
      geraet({ id: 'hue.alarm', name: 'Blitzlicht', kind: 'alert' }),
      geraet({ id: 'z2m.tumbler', name: 'Tumbler' }),
    ]);
    expect(gruppen.sirenen.map((e) => e.id)).toEqual(['hm.sirene', 'hue.alarm']);
    expect(gruppen.schalter.map((e) => e.id)).toEqual(['z2m.tumbler']);
  });

  it('nimmt nur, was sich überhaupt einschalten lässt', () => {
    const gruppen = sirenenGruppen([
      geraet({ id: 'sensor.sirene', name: 'Sirene', commands: [] }),
    ]);
    expect(gruppen.sirenen).toEqual([]);
    expect(gruppen.schalter).toEqual([]);
  });

  it('erkennt die Sirene auch an Gong und Hupe', () => {
    expect(istSirene(geraet({ name: 'Gong Eingang' }))).toBe(true);
    expect(istSirene(geraet({ name: 'Hupe Garage' }))).toBe(true);
    expect(istSirene(geraet({ name: 'Stehlampe' }))).toBe(false);
  });
});

describe('boxenKandidaten', () => {
  it('nimmt, was eine Durchsage abspielen kann - Gruppen inbegriffen', () => {
    // Dieselbe Prüfung wie im Hub (core/say.py): Wer «play_url» kann,
    // kann eine Durchsage. Eine Lautsprechergruppe ist dabei eine Box
    // wie jede andere.
    const boxen = boxenKandidaten([
      { id: 'cast.stube', name: 'Stube', kind: 'media_player', commands: ['play_url'] },
      { id: 'cast.alle', name: 'Ganze Wohnung', kind: 'media_player', commands: ['play_url'] },
      { id: 'hue.licht', name: 'Licht', kind: 'light', commands: ['turn_on'] },
    ]);
    expect(boxen.map((box) => box.id)).toEqual(['cast.alle', 'cast.stube']);
  });
});

describe('geschaltetStand', () => {
  it('sagt «nichts», wenn die Anlage nur meldet', () => {
    // Die wichtigere der beiden Auskünfte: Eine Alarmanlage, die bloss
    // eine Nachricht schickt, vertreibt niemanden.
    expect(geschaltetStand({})).toBe('nichts');
    expect(geschaltetStand({ trigger: [] })).toBe('nichts');
  });

  it('zählt über alle Zeitpunkte zusammen', () => {
    expect(
      geschaltetStand({
        trigger: [{ entity_id: 'a', command: 'turn_on' }],
        clear: [{ entity_id: 'a', command: 'turn_off' }],
      })
    ).toBe('2 Befehle');
    expect(geschaltetStand({ trigger: [{ entity_id: 'a', command: 'turn_on' }] })).toBe(
      '1 Befehl'
    );
  });
});
