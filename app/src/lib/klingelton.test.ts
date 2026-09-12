import {
  Klingelbox,
  Klingeltonstand,
  LAUTSTAERKE_VORGABE,
  boxAendern,
  boxStand,
  boxUmschalten,
  klingeltonSatz,
  lautsprecherName,
  spanneSatz,
  uhrzeitSauber,
  nachtSatz,
} from './klingelton';

describe('lautsprecherName', () => {
  it('hängt den Raum an, wenn er nicht schon im Namen steckt', () => {
    expect(lautsprecherName({ id: '1', name: 'Küche', room: 'Küche' })).toBe('Küche');
    expect(lautsprecherName({ id: '1', name: 'Box', room: 'Wohnzimmer' })).toBe(
      'Box · Wohnzimmer'
    );
    expect(lautsprecherName({ id: '1', name: 'Box', room: null })).toBe('Box');
  });
});

const nurIds = (boxen: Klingelbox[]) => boxen.map((box) => box.id);
const alsBoxen = (ids: string[]): Klingelbox[] =>
  ids.map((id) => ({ id, volume: LAUTSTAERKE_VORGABE, from: '00:00', to: '24:00' }));

describe('boxUmschalten', () => {
  it('nimmt eine Box dazu und wieder heraus', () => {
    expect(nurIds(boxUmschalten([], 'a'))).toEqual(['a']);
    expect(nurIds(boxUmschalten(alsBoxen(['a']), 'b'))).toEqual(['a', 'b']);
    expect(nurIds(boxUmschalten(alsBoxen(['a', 'b']), 'a'))).toEqual(['b']);
  });
});

describe('klingeltonSatz', () => {
  const sounds = [
    { key: 'dingdong', label: 'Ding-Dong' },
    { key: 'hupe', label: 'Hupe' },
  ];
  const candidates = [
    { id: 'a', name: 'Küche', room: 'Küche' },
    { id: 'b', name: 'Wohnzimmer', room: 'Wohnzimmer' },
    { id: 'c', name: 'Bad', room: 'Bad' },
  ];

  it('sagt, dass es still bleibt, ohne gewählte Box', () => {
    const stand: Klingeltonstand = { sound: 'dingdong', speakers: [], sounds, candidates };
    expect(klingeltonSatz(stand)).toMatch(/Push-Nachricht allein/);
    expect(klingeltonSatz(null)).toMatch(/Push-Nachricht allein/);
  });

  it('nennt Ton und Box bei einer oder zwei Boxen', () => {
    const stand: Klingeltonstand = {
      sound: 'hupe',
      speakers: alsBoxen(['a']),
      sounds,
      candidates,
    };
    expect(klingeltonSatz(stand)).toBe('«Hupe» spielt auf Küche.');

    const zwei: Klingeltonstand = { ...stand, speakers: alsBoxen(['a', 'b']) };
    expect(klingeltonSatz(zwei)).toBe('«Hupe» spielt auf Küche und Wohnzimmer.');
  });

  it('zählt ab drei Boxen statt sie alle zu nennen', () => {
    const stand: Klingeltonstand = {
      sound: 'dingdong',
      speakers: alsBoxen(['a', 'b', 'c']),
      sounds,
      candidates,
    };
    expect(klingeltonSatz(stand)).toBe('«Ding-Dong» spielt auf 3 Boxen.');
  });

  it('kommt auch mit einem unbekannten Ton-Schlüssel klar', () => {
    const stand: Klingeltonstand = {
      sound: 'irgendwas',
      speakers: alsBoxen(['a']),
      sounds,
      candidates,
    };
    expect(klingeltonSatz(stand)).toBe('«irgendwas» spielt auf Küche.');
  });
});

// ── Je Box: wie laut, und wann überhaupt ─────────────────────────────────
//
// Gewünscht im Haus: «Bei jedem Lautsprecher, den man aktiviert, soll man
// die Lautstärke einzeln definieren» und «die Zeit, wann es da klingelt».

describe('Lautstärke und Zeit je Box', () => {
  const box = (id: string, rest: Partial<Klingelbox> = {}): Klingelbox => ({
    id,
    volume: LAUTSTAERKE_VORGABE,
    from: '00:00',
    to: '24:00',
    ...rest,
  });

  it('nimmt eine neue Box mit den Vorgaben herein', () => {
    const nachher = boxUmschalten([], 'demo.kueche');
    expect(nachher).toEqual([box('demo.kueche')]);
  });

  it('nimmt eine abgewählte Box samt ihren Einstellungen heraus', () => {
    // Gewollt: Wer sie später wieder dazunimmt, fängt sichtbar bei den
    // Vorgaben an, statt eine halb vergessene Nachtsperre zu erben.
    const vorher = [box('a', { volume: 20, from: '07:00', to: '20:00' }), box('b')];
    expect(boxUmschalten(vorher, 'a')).toEqual([box('b')]);
  });

  it('ändert nur die angesprochene Box', () => {
    const vorher = [box('a'), box('b')];
    const nachher = boxAendern(vorher, 'b', { volume: 20 });
    expect(nachher[0].volume).toBe(LAUTSTAERKE_VORGABE);
    expect(nachher[1].volume).toBe(20);
  });

  it('liest Getipptes als Uhrzeit', () => {
    expect(uhrzeitSauber('7', '00:00')).toBe('07:00');
    expect(uhrzeitSauber('730', '00:00')).toBe('07:30');
    expect(uhrzeitSauber('7:5', '00:00')).toBe('07:05');
    expect(uhrzeitSauber('23:59', '00:00')).toBe('23:59');
    expect(uhrzeitSauber('24:00', '00:00')).toBe('24:00');
  });

  it('fällt bei Unsinn auf die Vorgabe zurück statt stumm zu werden', () => {
    expect(uhrzeitSauber('abends', '08:00')).toBe('08:00');
    expect(uhrzeitSauber('99:99', '08:00')).toBe('08:00');
    expect(uhrzeitSauber('', '08:00')).toBe('08:00');
  });

  it('sagt «immer», wenn die Spanne keine ist', () => {
    // Ein Zahlenpaar dastehen zu lassen wäre die schlechtere Auskunft:
    // Wer es liest, rechnet nach, ob das immer heisst oder nie.
    expect(spanneSatz(box('a'))).toBe('immer');
    expect(spanneSatz(box('a', { from: '07:00', to: '07:00' }))).toBe('immer');
    expect(spanneSatz(box('a', { from: '22:00', to: '07:00' }))).toBe('22:00 – 07:00');
  });

  it('kennt den Stand einer Box, auch wenn sie nicht gewählt ist', () => {
    expect(boxStand([], 'neu').volume).toBe(LAUTSTAERKE_VORGABE);
    expect(boxStand([box('a', { volume: 20 })], 'a').volume).toBe(20);
  });
});

describe('nachtSatz', () => {
  it('schweigt bei «wie am Tag» und nennt sonst Fenster und Wirkung', () => {
    expect(nachtSatz(undefined)).toBe('');
    expect(nachtSatz({ mode: 'normal', from: 22, to: 7 })).toBe('');
    expect(nachtSatz({ mode: 'leise', from: 22, to: 7 })).toBe(
      'Nachts (von 22 bis 7 Uhr) spielt er leiser.'
    );
    expect(nachtSatz({ mode: 'still', from: 23, to: 6 })).toMatch(/still – nur die Push/);
  });
});
