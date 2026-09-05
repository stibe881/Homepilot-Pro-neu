/**
 * Wann das Zurückkommen aus dem Hintergrund als Öffnen zählt.
 *
 * Der Fall dahinter: «Was ist neu» kam nur auf der Raumübersicht. Wer die
 * App zuletzt unter «Licht» verlassen hatte, sah nach einem Update
 * nichts – und auf dem Telefon wird eine App fast nie beendet.
 */
import { NEU_GEOEFFNET_NACH, giltAlsNeuGeoeffnet, zeigtWasIstNeu } from './wiederkehr';

describe('giltAlsNeuGeoeffnet', () => {
  it('zählt das Telefon aus der Tasche', () => {
    expect(giltAlsNeuGeoeffnet(1_000_000, 1_000_000 + NEU_GEOEFFNET_NACH)).toBe(true);
    expect(giltAlsNeuGeoeffnet(1_000_000, 1_000_000 + 3_600_000)).toBe(true);
  });

  it('zählt den kurzen Blick in eine andere App nicht', () => {
    // Wer die Kamera-App für den QR-Code aufmacht, soll danach nicht
    // dasselbe Fenster nochmals wegklicken.
    expect(giltAlsNeuGeoeffnet(1_000_000, 1_000_000 + 5_000)).toBe(false);
  });

  it('bleibt ruhig, wenn die App gar nie weg war', () => {
    expect(giltAlsNeuGeoeffnet(null, 1_000_000)).toBe(false);
  });

  it('nimmt eine eigene Schwelle entgegen', () => {
    expect(giltAlsNeuGeoeffnet(0, 5_000, 1_000)).toBe(true);
    expect(giltAlsNeuGeoeffnet(0, 500, 1_000)).toBe(false);
  });
});

describe('zeigtWasIstNeu', () => {
  const stand = {
    geladen: true,
    commit: 'abc1234',
    changes: 3,
    seen: undefined as string | undefined,
    zurueckgestellt: false,
  };

  it('zeigt Ungelesenes, sobald alles beisammen ist', () => {
    expect(zeigtWasIstNeu(stand)).toBe(true);
    expect(zeigtWasIstNeu({ ...stand, seen: 'aelter00' })).toBe(true);
  });

  it('wartet auf die geladenen Einstellungen', () => {
    // Der gemeldete Fall: Beim Kaltstart kam die Änderungsliste vor den
    // persönlichen Einstellungen an. «seen fehlt noch» sah wie
    // «ungelesen» aus - das Fenster blitzte auf und verschwand wieder.
    expect(zeigtWasIstNeu({ ...stand, geladen: false })).toBe(false);
  });

  it('bleibt weg, wenn gelesen, zurückgestellt oder nichts da ist', () => {
    expect(zeigtWasIstNeu({ ...stand, seen: 'abc1234' })).toBe(false);
    expect(zeigtWasIstNeu({ ...stand, zurueckgestellt: true })).toBe(false);
    expect(zeigtWasIstNeu({ ...stand, changes: 0 })).toBe(false);
    expect(zeigtWasIstNeu({ ...stand, commit: null })).toBe(false);
    expect(zeigtWasIstNeu({ ...stand, commit: 'unbekannt' })).toBe(false);
  });
});
