import { kachelAktionen } from './kachelmenue';

describe('kachelAktionen', () => {
  it('stellt den Verlauf voran', () => {
    // Umbenannt wird ein Gerät einmal, nachgesehen «wann ging das an?»
    // immer wieder - und die Geste dafür ist dieselbe.
    expect(kachelAktionen({ umbenennen: true, verlauf: true }).map((e) => e.id)).toEqual([
      'verlauf',
      'umbenennen',
    ]);
  });

  it('bleibt bei einem Eintrag, wenn nur eines möglich ist', () => {
    // Wer nicht umbenennen darf, kommt mit dem langen Druck weiterhin
    // direkt zum Verlauf - für ihn ändert sich gar nichts.
    expect(kachelAktionen({ verlauf: true }).map((e) => e.id)).toEqual(['verlauf']);
    expect(kachelAktionen({ umbenennen: true }).map((e) => e.id)).toEqual(['umbenennen']);
  });

  it('bietet nichts an, wo es nichts anzubieten gibt', () => {
    expect(kachelAktionen({})).toEqual([]);
    expect(kachelAktionen({ umbenennen: false, verlauf: false })).toEqual([]);
  });

  it('gibt jedem Eintrag ein Sinnbild und eine Beschriftung', () => {
    for (const eintrag of kachelAktionen({ umbenennen: true, verlauf: true })) {
      expect(eintrag.label.length).toBeGreaterThan(0);
      expect(eintrag.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('Oben nicht mitzählen', () => {
  it('steht bei Licht und Schalter zuunterst', () => {
    // Die seltenste der drei Fragen steht am weitesten weg vom Finger.
    expect(
      kachelAktionen({ umbenennen: true, zaehlung: true, verlauf: true }).map((e) => e.id)
    ).toEqual(['verlauf', 'umbenennen', 'zaehlung']);
  });

  it('sagt, was der Griff bewirkt – nicht, was gerade gilt', () => {
    const [aus] = kachelAktionen({ zaehlung: true });
    expect(aus.label).toBe('Oben nicht mitzählen');
    const [wieder] = kachelAktionen({ zaehlung: true, ungezaehlt: true });
    expect(wieder.label).toBe('Oben wieder mitzählen');
    expect(wieder.id).toBe('zaehlung');
  });

  it('fehlt, wo die Kopfzeile ohnehin nichts zählt', () => {
    // Eine Kamera taucht in der «3 an» nie auf – ein Eintrag dafür wäre
    // ein Knopf ohne Wirkung.
    expect(kachelAktionen({ verlauf: true }).map((e) => e.id)).toEqual(['verlauf']);
  });

  it('genügt allein für den langen Druck', () => {
    // Wer nicht umbenennen darf und ein Gerät ohne Verlauf hält, bekommt
    // trotzdem diese eine Handlung - und zwar sofort, ohne Liste.
    expect(kachelAktionen({ zaehlung: true }).map((e) => e.id)).toEqual(['zaehlung']);
  });
});

describe('Sperren', () => {
  it('steht gleich hinter dem Umbenennen', () => {
    // Vorne steht der Verlauf: Umbenannt und gesperrt wird ein Gerät
    // einmal, nachgesehen «wann ging das an?» immer wieder.
    expect(
      kachelAktionen({ umbenennen: true, sperren: true, verlauf: true }).map((e) => e.id)
    ).toEqual(['verlauf', 'umbenennen', 'sperren']);
  });

  it('sagt, was der Griff bewirkt', () => {
    expect(kachelAktionen({ sperren: true })[0].label).toBe('Sperren');
    expect(kachelAktionen({ sperren: true, gesperrt: true })[0].label).toBe(
      'Sperre aufheben'
    );
  });
});
