import {
  fatalerStartfehler,
  fehlerZeilen,
  globalenFangInstallieren,
  startfehlerAbo,
  startmarke,
  startmarken,
} from './startfehler';

describe('fehlerZeilen', () => {
  it('nimmt Meldung und die ersten Stapelzeilen eines Error', () => {
    const fehler = new Error('Cannot read property x of undefined');
    fehler.stack = 'Error: Cannot read property x of undefined\n  at eins (a.ts:1)\n  at zwei (b.ts:2)';
    const { titel, text } = fehlerZeilen(fehler);
    expect(titel).toBe('Cannot read property x of undefined');
    // Die erste Zeile ist die Meldung selbst - die steht schon im Titel.
    expect(text).toBe('at eins (a.ts:1)\nat zwei (b.ts:2)');
  });

  it('kürzt einen langen Stapel auf acht Zeilen', () => {
    const fehler = new Error('kaputt');
    fehler.stack = ['Error: kaputt', ...Array.from({ length: 20 }, (_, i) => `  at f${i} (x.ts:${i})`)].join('\n');
    expect(fehlerZeilen(fehler).text.split('\n')).toHaveLength(8);
  });

  it('kommt auch mit einem geworfenen Text zurecht', () => {
    // `throw 'text'` ist kein Error - und kam bisher als «undefined» an.
    expect(fehlerZeilen('so nicht')).toEqual({ titel: 'so nicht', text: '' });
  });

  it('macht aus einem geworfenen Objekt lesbares JSON', () => {
    const { titel, text } = fehlerZeilen({ code: 'E_NIX', detail: 'fehlt' });
    expect(titel).toBe('Unbekannter Fehler');
    expect(text).toContain('E_NIX');
  });

  it('bleibt bei einem Error ohne Meldung beim Namen', () => {
    const fehler = new Error('');
    fehler.stack = '';
    expect(fehlerZeilen(fehler).titel).toBe('Error');
  });
});

describe('globaler Fang', () => {
  it('meldet einen fatalen Startfehler an die Startwache statt ihn nur zu loggen', () => {
    // Der schwarze Bildschirm vom 29. August: geschluckt, geloggt, nie
    // gezeigt. Seitdem muss ein fataler Fehler im Startfenster die
    // Zuhörer wecken und abrufbar sein.
    let vorherGerufen = 0;
    const vorher = () => {
      vorherGerufen += 1;
    };
    let installiert: ((fehler: unknown, fatal?: boolean) => void) | undefined;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => vorher,
      setGlobalHandler: (h: (fehler: unknown, fatal?: boolean) => void) => {
        installiert = h;
      },
    };
    const konsole = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      globalenFangInstallieren();
      expect(installiert).toBeDefined();

      let geweckt = 0;
      const abmelden = startfehlerAbo(() => {
        geweckt += 1;
      });

      const fehler = new Error('Modul X fehlt');
      installiert!(fehler, true);
      expect(geweckt).toBe(1);
      expect(fatalerStartfehler()).toBe(fehler);
      // Im Startfenster übernimmt das Netz - der alte Handler (der den
      // Prozess abbrechen würde) bleibt aussen vor.
      expect(vorherGerufen).toBe(0);

      // Nicht-fatale Fehler gehen unverändert an den alten Handler.
      installiert!(new Error('nur eine Warnung'), false);
      expect(vorherGerufen).toBe(1);
      expect(geweckt).toBe(1);

      abmelden();
      installiert!(new Error('nach dem Abmelden'), true);
      expect(geweckt).toBe(1);
    } finally {
      konsole.mockRestore();
      delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    }
  });
});

describe('startmarke', () => {
  it('hält Etappen mit Zeit fest und weckt die Zuhörer', () => {
    let geweckt = 0;
    const abmelden = startfehlerAbo(() => {
      geweckt += 1;
    });
    startmarke('Etappe eins');
    expect(geweckt).toBe(1);
    const liste = startmarken();
    const eintrag = liste.find((m) => m.name === 'Etappe eins');
    expect(eintrag).toBeDefined();
    expect(eintrag!.nachMs).toBeGreaterThanOrEqual(0);

    // Dieselbe Etappe zählt nur einmal - Effekte dürfen mehrfach feuern.
    startmarke('Etappe eins');
    expect(startmarken().filter((m) => m.name === 'Etappe eins')).toHaveLength(1);
    expect(geweckt).toBe(1);
    abmelden();
  });
});
