import {
  sicherungsArt,
  sicherungsArtLabel,
  sicherungsNameProblem,
  sicherungsZeile,
} from './sicherung';

describe('sicherungsNameProblem', () => {
  it('lässt beide Formen durch - das Archiv und die alte Einzeldatei', () => {
    expect(sicherungsNameProblem('homepilot-data-2026-09-13_030000.tar.gz')).toBeNull();
    expect(sicherungsNameProblem('homepilot-data-2026-09-01_030000.json')).toBeNull();
    expect(sicherungsNameProblem(' homepilot-data-1.json ')).toBeNull();
  });

  it('weist ab, was keine Sicherung ist, bevor etwas hochgeladen wird', () => {
    expect(sicherungsNameProblem('')).toMatch(/keinen Namen/);
    expect(sicherungsNameProblem(undefined)).toMatch(/keinen Namen/);
    expect(sicherungsNameProblem('ferien.jpg')).toMatch(/keine HomePilot-Sicherung/);
    expect(sicherungsNameProblem('homepilot-export.json')).toMatch(/homepilot-data-/);
    // Pfad-Spielereien: Der Hub prüft das auch, die App schon vorher.
    expect(sicherungsNameProblem('../homepilot-data-1.json')).not.toBeNull();
  });
});

describe('sicherungsZeile', () => {
  it('sagt, ob Bilder und Token dabei sind - «nur Daten» bei der alten Form', () => {
    expect(sicherungsArt('homepilot-data-1.tar.gz')).toBe('archiv');
    expect(sicherungsArtLabel('homepilot-data-1.json')).toBe('nur Daten');
    expect(
      sicherungsZeile({ name: 'homepilot-data-1.tar.gz', size: 3 * 1024 * 1024 }, '13.09.2026 03:00')
    ).toBe('13.09.2026 03:00 · 3.0 MB · Archiv');
    expect(sicherungsZeile({ name: 'homepilot-data-1.json', size: 900 }, 'heute')).toBe(
      'heute · 1 kB · nur Daten'
    );
  });
});
