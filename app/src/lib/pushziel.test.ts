import { HOECHSTENS_KNOEPFE, knoepfeAus, zielAus } from './pushziel';

describe('Wohin ein Tipp auf eine Nachricht führt', () => {
  it('versteht einen Bereich', () => {
    expect(zielAus({ ziel: 'bereich:system' })).toEqual({
      art: 'bereich',
      bereich: 'system',
    });
  });

  it('lehnt einen Bereich ab, den es nicht gibt', () => {
    // Was der Hub schickt, kommt aus einer älteren Fassung, sobald
    // jemand ein Update aufschiebt.
    expect(zielAus({ ziel: 'bereich:raumschiff' })).toBeNull();
  });

  it('versteht Raum, Gerät und Kamera', () => {
    expect(zielAus({ ziel: 'raum:Küche' })).toEqual({ art: 'raum', raum: 'Küche' });
    expect(zielAus({ ziel: 'geraet:hue.a' })).toEqual({
      art: 'geraet',
      entityId: 'hue.a',
    });
    expect(zielAus({ ziel: 'kamera:protect.tuer' })).toEqual({
      art: 'kamera',
      entityId: 'protect.tuer',
    });
  });

  it('nimmt die Kennung aus den Daten, wenn im Ziel keine steht', () => {
    // Spart die Kennung zweimal in derselben Nachricht.
    expect(zielAus({ ziel: 'geraet', entityId: 'hue.a' })).toEqual({
      art: 'geraet',
      entityId: 'hue.a',
    });
  });

  it('versteht die Kacheln der Familie', () => {
    expect(zielAus({ ziel: 'familie:shopping' })).toEqual({
      art: 'familie',
      modul: 'shopping',
    });
    expect(zielAus({ ziel: 'familie:gibtsnicht' })).toBeNull();
  });

  it('versteht die Blätter ohne Wert', () => {
    expect(zielAus({ ziel: 'sorgen' })).toEqual({ art: 'sorgen' });
    expect(zielAus({ ziel: 'timer' })).toEqual({ art: 'timer' });
    expect(zielAus({ ziel: 'offen' })).toEqual({ art: 'offen' });
    expect(zielAus({ ziel: 'batterien' })).toEqual({ art: 'batterien' });
  });

  it('versteht die alten Felder weiter', () => {
    // Zwischen einem neuen Hub und einer alten App liegen regelmässig
    // ein paar Tage.
    expect(zielAus({ camera: 'protect.tuer' })).toEqual({
      art: 'kamera',
      entityId: 'protect.tuer',
    });
    expect(zielAus({ type: 'battery' })).toEqual({ art: 'batterien' });
    expect(zielAus({ type: 'alarm' })).toEqual({ art: 'bereich', bereich: 'alarm' });
    expect(zielAus({ type: 'doorbell', entityId: 'ring.tuer' })).toEqual({
      art: 'klingel',
      entityId: 'ring.tuer',
    });
  });

  it('lässt dem neuen Feld den Vortritt', () => {
    expect(zielAus({ ziel: 'familie:shopping', type: 'battery' })).toEqual({
      art: 'familie',
      modul: 'shopping',
    });
  });

  it('fällt auf das alte Feld zurück, wenn das neue Unsinn ist', () => {
    expect(zielAus({ ziel: 'quatsch', type: 'battery' })).toEqual({
      art: 'batterien',
    });
  });

  it('ergibt nichts, wenn nichts dabei ist', () => {
    expect(zielAus({})).toBeNull();
  });
});

describe('Knöpfe unter einer Nachricht', () => {
  it('liest Szene und Gerät', () => {
    expect(
      knoepfeAus({
        knoepfe: [
          { label: 'Kino', scene: 'kino' },
          { label: 'Trockner an', entity: 'tuya.trockner', command: 'turn_on' },
        ],
      })
    ).toEqual([
      { label: 'Kino', scene: 'kino' },
      { label: 'Trockner an', entity: 'tuya.trockner', command: 'turn_on' },
    ]);
  });

  it('wirft heraus, was kein Etikett oder kein Ziel hat', () => {
    // Die Liste kommt über einen fremden Dienst und aus einer
    // Konfiguration, die jemand von Hand geschrieben haben kann.
    expect(
      knoepfeAus({
        knoepfe: [
          { label: '', scene: 'kino' },
          { label: 'Ohne Ziel' },
          { label: 'Gerät ohne Befehl', entity: 'x' },
          'kaputt',
          null,
        ],
      })
    ).toEqual([]);
  });

  it('hört beim Höchstmass auf', () => {
    const viele = Array.from({ length: 8 }, (_, i) => ({
      label: `K${i}`,
      scene: 's',
    }));
    expect(knoepfeAus({ knoepfe: viele })).toHaveLength(HOECHSTENS_KNOEPFE);
  });

  it('kommt ohne Knöpfe aus', () => {
    expect(knoepfeAus({})).toEqual([]);
    expect(knoepfeAus({ knoepfe: 'nein' })).toEqual([]);
  });
});
