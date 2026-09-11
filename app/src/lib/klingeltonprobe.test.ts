import { klingeltonUrl } from './klingeltonprobe';

describe('klingeltonUrl', () => {
  it('hängt Schlüssel und Token an die Hub-Adresse', () => {
    expect(klingeltonUrl('http://hub:8123', 'geheim', 'dingdong')).toBe(
      'http://hub:8123/api/push/doorbell-sound/dingdong.wav?token=geheim'
    );
  });

  it('verschluckt einen Schrägstrich am Ende der Hub-Adresse', () => {
    // Sonst stünde «//api/...» in der Adresse - manche Hubs führen das
    // Token dann nicht mit, weil der Pfad nicht mehr passt.
    expect(klingeltonUrl('http://hub:8123/', 't', 'hupe')).toBe(
      'http://hub:8123/api/push/doorbell-sound/hupe.wav?token=t'
    );
  });

  it('kodiert Sonderzeichen in Token und Schlüssel', () => {
    const url = klingeltonUrl('http://hub:8123', 'a&b', 'ding dong');
    expect(url).toContain('ding%20dong.wav');
    expect(url).toContain('token=a%26b');
  });
});
