/**
 * Die Reihenfolge der Schnellaktionen.
 *
 * Sie war fest: erst die Szenen, dann die Storen. Wer die Storen zuerst
 * braucht, konnte nichts tun.
 */
import { STOREN_AUF, STOREN_ZU, schnellposten } from './schnellordnung';

const szenen = [
  { id: 'scene.kino', name: 'Kino' },
  { id: 'scene.schlafen', name: 'Schlafen' },
];

describe('schnellposten', () => {
  it('lässt ohne eigene Reihenfolge alles, wie es war', () => {
    // Eine neue Einstellung darf nichts verschieben, solange sie
    // niemand benutzt hat.
    expect(schnellposten(szenen).map((p) => p.id)).toEqual([
      'scene.kino',
      'scene.schlafen',
      STOREN_AUF,
      STOREN_ZU,
    ]);
  });

  it('stellt die Storen nach vorn, wenn man sie dorthin zieht', () => {
    const reihe = schnellposten(szenen, [STOREN_AUF, STOREN_ZU, 'scene.schlafen']);
    expect(reihe.map((p) => p.id)).toEqual([
      STOREN_AUF,
      STOREN_ZU,
      'scene.schlafen',
      'scene.kino',
    ]);
  });

  it('hängt eine neu angelegte Szene hinten an', () => {
    // Sonst brächte jede neue Szene die gewachsene Ordnung
    // durcheinander.
    const reihe = schnellposten(
      [...szenen, { id: 'scene.neu', name: 'Neu' }],
      [STOREN_AUF, 'scene.kino']
    );
    expect(reihe.map((p) => p.id)).toEqual([
      STOREN_AUF,
      'scene.kino',
      'scene.schlafen',
      'scene.neu',
      STOREN_ZU,
    ]);
  });

  it('sagt bei jedem Knopf, was er tut', () => {
    const [erste] = schnellposten(szenen);
    expect(erste.sceneId).toBe('scene.kino');
    const storen = schnellposten(szenen).find((p) => p.id === STOREN_ZU);
    expect(storen?.storen).toBe('zu');
    expect(storen?.name).toBe('Storen runter');
  });

  it('verträgt eine Kennung, zu der es nichts mehr gibt', () => {
    // Eine gelöschte Szene soll keine Lücke lassen.
    const reihe = schnellposten(szenen, ['scene.weg', STOREN_ZU]);
    expect(reihe[0].id).toBe(STOREN_ZU);
    expect(reihe).toHaveLength(4);
  });
});
