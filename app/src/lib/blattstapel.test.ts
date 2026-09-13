import { Blatt, dazu, haeltWach, oberstes, ohne } from './blattstapel';

describe('blattstapel', () => {
  const klingel: Blatt = { kennung: 1, haeltWach: true };
  const remote: Blatt = { kennung: 2, haeltWach: false };

  it('zeichnet das Band nur im zuletzt geöffneten Blatt', () => {
    // Der Fall aus Punkt 581: Über der Fernbedienung geht die Klingel
    // auf. Die Absage zum Türöffner gehört ins Klingelblatt, nicht in
    // die Fernbedienung darunter - und nicht in beide.
    let stapel = dazu([], remote);
    expect(oberstes(stapel)).toBe(2);
    stapel = dazu(stapel, klingel);
    expect(oberstes(stapel)).toBe(1);
    stapel = ohne(stapel, 1);
    expect(oberstes(stapel)).toBe(2);
  });

  it('gehört ohne offenes Blatt dem Wurzel-View', () => {
    expect(oberstes([])).toBeNull();
    expect(oberstes(ohne(dazu([], remote), 2))).toBeNull();
  });

  it('lässt ein Blatt, das sich noch einmal anmeldet, an seinem Platz', () => {
    // Der Kochmodus meldet sich mit «hält wach» an; ein zweites Anmelden
    // derselben Kennung darf ihn nicht über ein später geöffnetes Blatt
    // heben.
    const stapel = dazu(dazu([], klingel), remote);
    const neu = dazu(stapel, { kennung: 1, haeltWach: false });
    expect(neu.map((blatt) => blatt.kennung)).toEqual([1, 2]);
    expect(haeltWach(neu)).toBe(false);
  });

  it('meldet, ob ein offenes Blatt das Gerät wach hält', () => {
    // Die Drei-Minuten-Rückkehr am Wandpanel (Punkt 582) muss während
    // des Kochens und beim Klingeln aussetzen, bei der Fernbedienung
    // nicht.
    expect(haeltWach([])).toBe(false);
    expect(haeltWach([remote])).toBe(false);
    expect(haeltWach([remote, klingel])).toBe(true);
  });

  it('nimmt ein Abmelden ohne Anmelden gelassen hin', () => {
    expect(ohne([remote], 99)).toEqual([remote]);
  });
});
