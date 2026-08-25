/**
 * «Warum ist das an?»
 *
 * Die Frage stellt man nachts im Flur. Die Antwort stand im Verlauf,
 * einen Abruf und zwei Griffe entfernt.
 */
import { quellenWort, seitWann, ursacheSatz } from './ursache';

const JETZT = 1_700_000_000_000; // Millisekunden, wie Date.now()
const vorSekunden = (s: number) => JETZT / 1000 - s;

describe('quellenWort', () => {
  it('nennt Mensch, Ablauf und Szene beim Namen', () => {
    expect(quellenWort({ kind: 'user', label: 'Stefan' })).toBe('Stefan');
    expect(quellenWort({ kind: 'automation', label: 'Bewegung Flur' })).toBe(
      'Ablauf «Bewegung Flur»'
    );
    expect(quellenWort({ kind: 'scene', label: 'Kino' })).toBe('Szene «Kino»');
  });

  it('sagt bei allem anderen, dass es nicht über den Hub kam', () => {
    // Wandschalter, Hersteller-App, Zeitschaltung im Gerät selbst.
    expect(quellenWort({ kind: 'device', label: 'Gerät' })).toBe('am Gerät / von aussen');
    expect(quellenWort(null)).toBe('am Gerät / von aussen');
  });
});

describe('seitWann', () => {
  it('rundet, wie man es sagen würde', () => {
    expect(seitWann(30)).toBe('gerade eben');
    expect(seitWann(20 * 60)).toBe('seit 20 Min');
    expect(seitWann(3 * 3600)).toBe('seit 3 Std');
    expect(seitWann(26 * 3600)).toBe('seit gestern');
    expect(seitWann(3 * 24 * 3600)).toBe('seit 3 Tagen');
  });
});

describe('ursacheSatz', () => {
  it('beantwortet die Frage in einer Zeile', () => {
    expect(
      ursacheSatz(
        {
          last_change: vorSekunden(20 * 60),
          last_source: { kind: 'automation', label: 'Bewegung Flur' },
        },
        JETZT
      )
    ).toBe('seit 20 Min · Ablauf «Bewegung Flur»');
  });

  it('schweigt, solange der Hub nichts gesehen hat', () => {
    // Nach einem Neustart ist das Gedächtnis leer. «gerade eben, am
    // Gerät» wäre dann eine Behauptung über etwas, das er nicht
    // miterlebt hat.
    expect(ursacheSatz({}, JETZT)).toBeNull();
    expect(ursacheSatz({ last_change: null }, JETZT)).toBeNull();
  });

  it('rechnet eine Uhr, die nachgeht, nicht in die Zukunft', () => {
    expect(ursacheSatz({ last_change: vorSekunden(-30) }, JETZT)).toBe(
      'gerade eben · am Gerät / von aussen'
    );
  });
});
