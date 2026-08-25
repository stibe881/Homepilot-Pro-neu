import { kachelAktionen } from './kachelmenue';

describe('kachelAktionen', () => {
  it('stellt das Umbenennen voran', () => {
    // Es ist der Grund, aus dem es dieses Menü gibt; der Verlauf hat
    // unter «Geräte» ohnehin seinen eigenen Weg.
    expect(kachelAktionen({ umbenennen: true, verlauf: true }).map((e) => e.id)).toEqual([
      'umbenennen',
      'verlauf',
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
