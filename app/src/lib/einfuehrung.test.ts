import {
  EINFUEHRUNG_STAND,
  aufzaehlung,
  fassungFuer,
  gastSatz,
  schritteFuer,
  zeigtEinfuehrung,
} from './einfuehrung';

describe('fassungFuer', () => {
  it('gibt Gästen die kurze Fassung', () => {
    expect(fassungFuer({ role: 'gast' })).toBe('gast');
  });

  it('gibt Bewohnern und Besitzern die volle Tour', () => {
    expect(fassungFuer({ role: 'bewohner' })).toBe('haushalt');
    expect(fassungFuer({ role: 'besitzer' })).toBe('haushalt');
  });

  it('gibt Kindern die eigene kurze Fassung', () => {
    // Kinder sehen die Kinder-Ansicht, nicht die Leiste mit den
    // Bereichen - die Haushalts-Tour beschriebe eine fremde App.
    expect(fassungFuer({ role: 'kind' })).toBe('kind');
  });

  it('behandelt einen noch unbekannten Benutzer wie den Haushalt', () => {
    // Am Wandpanel mit Config-Token gibt es keinen Benutzer - dort ist
    // die volle Fassung die richtige, nicht die beschnittene.
    expect(fassungFuer(null)).toBe('haushalt');
    expect(fassungFuer(undefined)).toBe('haushalt');
  });
});

describe('zeigtEinfuehrung', () => {
  it('wartet auf die geladenen Einstellungen, statt aufzublitzen', () => {
    expect(
      zeigtEinfuehrung({ geladen: false, gesehen: undefined, zurueckgestellt: false })
    ).toBe(false);
  });

  it('zeigt sich, wer sie noch nie gesehen hat', () => {
    expect(
      zeigtEinfuehrung({ geladen: true, gesehen: undefined, zurueckgestellt: false })
    ).toBe(true);
  });

  it('bleibt weg, sobald der aktuelle Stand weggeklickt ist', () => {
    expect(
      zeigtEinfuehrung({
        geladen: true,
        gesehen: EINFUEHRUNG_STAND,
        zurueckgestellt: false,
      })
    ).toBe(false);
  });

  it('kommt nach einer grundlegenden Überarbeitung noch einmal', () => {
    expect(
      zeigtEinfuehrung({
        geladen: true,
        gesehen: EINFUEHRUNG_STAND - 1,
        zurueckgestellt: false,
      })
    ).toBe(true);
  });

  it('bleibt für diesen Besuch weg, wenn sie weggetippt wurde', () => {
    expect(
      zeigtEinfuehrung({ geladen: true, gesehen: undefined, zurueckgestellt: true })
    ).toBe(false);
  });
});

describe('aufzaehlung', () => {
  it('setzt «und» vor das letzte Wort', () => {
    expect(aufzaehlung(['das Licht', 'die Storen', 'die Kameras'])).toBe(
      'das Licht, die Storen und die Kameras'
    );
    expect(aufzaehlung(['das Licht', 'die Storen'])).toBe('das Licht und die Storen');
  });

  it('lässt ein einzelnes Wort in Ruhe', () => {
    expect(aufzaehlung(['das Licht'])).toBe('das Licht');
    expect(aufzaehlung([])).toBe('');
  });
});

describe('gastSatz', () => {
  it('nennt nur die freigegebenen Bereiche', () => {
    const satz = gastSatz(['licht', 'storen']);
    expect(satz).toContain('das Licht');
    expect(satz).toContain('die Storen');
    expect(satz).not.toContain('Kameras');
  });

  it('lässt unbekannte Feature-Schlüssel still weg', () => {
    // Ein neuer Bereich im Hub soll die Einführung nicht mit seinem
    // internen Namen füllen.
    expect(gastSatz(['licht', 'zukunftsdings'])).toBe('Für dich freigegeben: das Licht.');
  });

  it('bleibt ohne Freigaben allgemein statt leer', () => {
    expect(gastSatz([])).toContain('freigegeben');
    expect(gastSatz(undefined)).toContain('freigegeben');
  });
});

describe('schritteFuer', () => {
  it('führt den Haushalt durch Leiste, «Alles aus», Suche und Einstellungen', () => {
    const alles = schritteFuer({ role: 'bewohner' })
      .map((schritt) => `${schritt.titel} ${schritt.text}`)
      .join(' ');
    expect(alles).toContain('Leiste');
    expect(alles).toContain('Alles aus');
    expect(alles).toContain('Suche');
    expect(alles).toContain('Einstellungen');
  });

  it('erklärt Kindern nur ihre Zimmer mit den grossen Knöpfen', () => {
    const schritte = schritteFuer({ role: 'kind' });
    expect(schritte).toHaveLength(1);
    expect(schritte[0].text).toContain('Zimmer');
    expect(schritte[0].text).not.toContain('Leiste');
  });

  it('gibt dem Babysitter einen einzigen kurzen Schritt mit seinen Bereichen', () => {
    const schritte = schritteFuer({ role: 'gast', features: ['licht', 'familie'] });
    expect(schritte).toHaveLength(1);
    expect(schritte[0].text).toContain('das Licht');
    expect(schritte[0].text).toContain('die Familienseite');
    // Keine Tour durch verschlossene Türen: Was der Gast nicht sieht,
    // wird auch nicht erwähnt.
    expect(schritte[0].text).not.toContain('Storen');
  });
});
