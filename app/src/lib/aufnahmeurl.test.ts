import { aufnahmeUrl } from './aufnahmeurl';

describe('aufnahmeUrl', () => {
  it('baut die Adresse mit Start, Ende und Token', () => {
    const url = aufnahmeUrl('http://hub:8123', 'geheim', 'cam.garten', {
      start: '2026-08-31T12:05:00.000Z',
      end: '2026-08-31T12:05:30.000Z',
    });
    expect(url).toBe(
      'http://hub:8123/api/entities/cam.garten/clip' +
        `?start=${Date.parse('2026-08-31T12:05:00.000Z')}` +
        `&end=${Date.parse('2026-08-31T12:05:30.000Z')}&token=geheim`
    );
  });

  it('lässt ein fehlendes Ende weg - der Hub wählt das Fenster', () => {
    const url = aufnahmeUrl('http://hub:8123', 't', 'cam', {
      start: '2026-08-31T12:05:00.000Z',
      end: null,
    });
    expect(url).toContain('?start=');
    expect(url).not.toContain('&end=');
  });

  it('gibt ohne lesbaren Anfang keine Adresse', () => {
    expect(aufnahmeUrl('http://hub:8123', 't', 'cam', { start: 'kaputt' })).toBeNull();
  });

  it('schützt Sonderzeichen in Kennung und Token', () => {
    const url = aufnahmeUrl('http://hub:8123', 'a&b', 'cam/1', {
      start: '2026-08-31T12:05:00.000Z',
    });
    expect(url).toContain('cam%2F1');
    expect(url).toContain('token=a%26b');
  });
});
