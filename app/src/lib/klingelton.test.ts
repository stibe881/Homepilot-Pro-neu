import {
  Klingeltonstand,
  boxUmschalten,
  klingeltonSatz,
  lautsprecherName,
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

describe('boxUmschalten', () => {
  it('nimmt eine Box dazu und wieder heraus', () => {
    expect(boxUmschalten([], 'a')).toEqual(['a']);
    expect(boxUmschalten(['a'], 'b')).toEqual(['a', 'b']);
    expect(boxUmschalten(['a', 'b'], 'a')).toEqual(['b']);
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
      speakers: ['a'],
      sounds,
      candidates,
    };
    expect(klingeltonSatz(stand)).toBe('«Hupe» spielt auf Küche.');

    const zwei: Klingeltonstand = { ...stand, speakers: ['a', 'b'] };
    expect(klingeltonSatz(zwei)).toBe('«Hupe» spielt auf Küche und Wohnzimmer.');
  });

  it('zählt ab drei Boxen statt sie alle zu nennen', () => {
    const stand: Klingeltonstand = {
      sound: 'dingdong',
      speakers: ['a', 'b', 'c'],
      sounds,
      candidates,
    };
    expect(klingeltonSatz(stand)).toBe('«Ding-Dong» spielt auf 3 Boxen.');
  });

  it('kommt auch mit einem unbekannten Ton-Schlüssel klar', () => {
    const stand: Klingeltonstand = {
      sound: 'irgendwas',
      speakers: ['a'],
      sounds,
      candidates,
    };
    expect(klingeltonSatz(stand)).toBe('«irgendwas» spielt auf Küche.');
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
