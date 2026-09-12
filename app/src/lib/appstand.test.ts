import { gleicherStand, kurz, standSatz } from './appstand';

describe('kurz', () => {
  it('lässt den Platzhalter nicht als Stand durchgehen', () => {
    // In der app.json steht «unbekannt», bis rebuild-hub.sh den echten
    // Commit hineinschreibt. Wer von Hand baut, behält den Platzhalter.
    expect(kurz('unbekannt')).toBeNull();
    expect(kurz('?')).toBeNull();
    expect(kurz('  ')).toBeNull();
    expect(kurz('a1b2c3d')).toBe('a1b2c3d');
  });
});

describe('gleicherStand', () => {
  it('vergleicht über den kürzeren Anfang', () => {
    // Der Hub nennt ihn kurz, die App auch - aber eine Seite könnte
    // einmal den langen schicken, und dann wäre strikte Gleichheit
    // falsch.
    expect(gleicherStand('a1b2c3d', 'a1b2c3d4e5f6')).toBe(true);
    expect(gleicherStand('A1B2C3D', 'a1b2c3d')).toBe(true);
    expect(gleicherStand('a1b2c3d', 'ffffff0')).toBe(false);
  });

  it('sagt ohne Stand nein statt zu allem ja', () => {
    expect(gleicherStand(null, 'a1b2c3d')).toBe(false);
    expect(gleicherStand('unbekannt', 'unbekannt')).toBe(false);
  });
});

describe('standSatz', () => {
  it('schweigt, wo die App ihren Stand nicht kennt', () => {
    // Eine App, die vor Punkt 545 gebaut wurde. «unbekannt ≠ a1b2c3d»
    // wäre eine Warnung über nichts.
    expect(standSatz({ app: 'unbekannt', hub: 'a1b2c3d', nachgeladen: true })).toBeNull();
  });

  it('bestätigt den Gleichstand ohne Warnfarbe', () => {
    // Wer gerade ein Update gemacht hat, sucht die Bestätigung, dass er
    // nichts mehr tun muss.
    const satz = standSatz({ app: 'a1b2c3d', hub: 'a1b2c3d', nachgeladen: true });
    expect(satz?.warnt).toBe(false);
    expect(satz?.text).toContain('denselben Stand');
  });

  it('nennt beide Stände, wenn sie auseinandergehen', () => {
    // Der Fall, für den das Ganze da ist: «Fehlt eine Änderung, die im
    // Build drin sein müsste?» - jetzt steht die Antwort da.
    const satz = standSatz({ app: 'a1b2c3d', hub: 'ffffff0', nachgeladen: true });
    expect(satz?.warnt).toBe(true);
    expect(satz?.text).toContain('a1b2c3d');
    expect(satz?.text).toContain('ffffff0');
    expect(satz?.text).toContain('nachgeladene Fassung');
  });

  it('nennt den Build beim Namen, wenn nichts nachgeladen ist', () => {
    const satz = standSatz({ app: 'a1b2c3d', hub: 'ffffff0', nachgeladen: false });
    expect(satz?.text).toContain('App-Build');
  });

  it('rät keine Richtung', () => {
    // Aus zwei Commit-Kennungen lässt sich nicht ablesen, welche älter
    // ist - eine geratene Richtung wäre schlimmer als keine.
    const satz = standSatz({ app: 'a1b2c3d', hub: 'ffffff0', nachgeladen: true });
    expect(satz?.text).not.toMatch(/älter|neuer/);
  });

  it('kommt ohne den Stand des Hubs aus', () => {
    const satz = standSatz({ app: 'a1b2c3d', hub: null, nachgeladen: false });
    expect(satz?.warnt).toBe(false);
    expect(satz?.text).toBe('Die App führt Stand a1b2c3d aus.');
  });
});
