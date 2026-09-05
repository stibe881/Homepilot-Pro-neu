import { zugangAusFragment } from './zugangslink';

/** So baut der Hub das Fragment (api/routes/einladungen.py). */
function fragment(daten: unknown): string {
  return `#zugang=${encodeURIComponent(JSON.stringify(daten))}`;
}

describe('Zugang aus einem Einladungslink', () => {
  it('liest Adresse, Token und Namen aus dem Fragment', () => {
    const zugang = zugangAusFragment(
      fragment({ url: 'https://haus.example.ch', token: 't-gast', name: 'Ray' })
    );
    expect(zugang).toEqual({ url: 'https://haus.example.ch', token: 't-gast', name: 'Ray' });
  });

  it('kommt ohne Namen aus – und wirft den Schrägstrich am Ende weg', () => {
    const zugang = zugangAusFragment(
      fragment({ url: 'http://192.168.1.20:8123/', token: 't-gast' })
    );
    expect(zugang).toEqual({ url: 'http://192.168.1.20:8123', token: 't-gast' });
  });

  it('ein gewöhnliches Fragment ist kein Zugang', () => {
    // Der Alltag: kein Fragment, ein Anker, oder gar nichts.
    expect(zugangAusFragment('')).toBeNull();
    expect(zugangAusFragment(null)).toBeNull();
    expect(zugangAusFragment('#einstellungen')).toBeNull();
  });

  it('ein kaputtes Fragment ist ein gewöhnlicher Start, kein Absturz', () => {
    expect(zugangAusFragment('#zugang=kein-json')).toBeNull();
    expect(zugangAusFragment('#zugang=%7B%22url%22%3A')).toBeNull();
    expect(zugangAusFragment(fragment('nur ein Text'))).toBeNull();
  });

  it('ohne Token oder ohne echte Adresse gibt es nichts', () => {
    expect(zugangAusFragment(fragment({ url: 'https://haus.example.ch' }))).toBeNull();
    expect(zugangAusFragment(fragment({ url: '', token: 't' }))).toBeNull();
    // Eine Adresse, die keine ist, ergäbe eine App, die ins Leere ruft -
    // oder Schlimmeres, wenn jemand «javascript:» hineinschreibt.
    expect(zugangAusFragment(fragment({ url: 'javascript:alert(1)', token: 't' }))).toBeNull();
    expect(zugangAusFragment(fragment({ url: '/nur/pfad', token: 't' }))).toBeNull();
  });
});
