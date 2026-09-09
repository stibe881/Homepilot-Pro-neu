import { Kamerastand, bildschichten, kameraSatz } from './kamerabild';

const stand = (patch: Partial<Kamerastand> = {}): Kamerastand => ({
  online: true,
  standbildDa: true,
  liveMoeglich: true,
  liveLaeuft: false,
  ...patch,
});

describe('bildschichten', () => {
  it('zeigt das Standbild, solange der Strom erst anläuft', () => {
    // Der gemeldete Fall: «es geht zum Teil lange, bis das Bild kommt».
    // Vorher gewann der Strom, und bis er lief, war die Fläche schwarz.
    const schichten = bildschichten(stand());
    expect(schichten.standbild).toBe(true);
    // Eingehängt ist er trotzdem - sonst beginnt er gar nicht zu laden.
    expect(schichten.live).toBe(true);
    expect(schichten.liveSichtbar).toBe(false);
    expect(schichten.leer).toBeNull();
  });

  it('legt den laufenden Strom über das Standbild', () => {
    const schichten = bildschichten(stand({ liveLaeuft: true }));
    expect(schichten.liveSichtbar).toBe(true);
    // Und darunter braucht es dann kein Bild mehr - das spart den
    // Drei-Sekunden-Takt hinter einem laufenden Video.
    expect(schichten.standbild).toBe(false);
  });

  it('lässt die Fläche nie leer, wenn der Strom abbricht', () => {
    // Genau hier fehlte einmal beides: Der Strom war «gelaufen», also
    // hätte das Standbild darunter gefehlt - und der Strom selbst war
    // weg. Die Kachel setzt `liveLaeuft` beim Fehlschlag zurück.
    const schichten = bildschichten(stand({ liveMoeglich: false, liveLaeuft: false }));
    expect(schichten.standbild).toBe(true);
    expect(schichten.live).toBe(false);
    expect(schichten.leer).toBeNull();
  });

  it('nennt offline offline und «kein Bild» beim Namen', () => {
    expect(bildschichten(stand({ online: false })).leer).toBe('offline');
    expect(
      bildschichten(stand({ standbildDa: false, liveMoeglich: false })).leer
    ).toBe('kein-bild');
    // Ohne Standbild, aber mit Strom: kein Fehler, nur noch nicht da.
    expect(bildschichten(stand({ standbildDa: false })).leer).toBeNull();
  });
});

describe('kameraSatz', () => {
  it('sagt in der Wartezeit, dass der Strom noch startet', () => {
    // Ohne diesen Satz sieht ein Standbild, hinter dem ein Strom
    // anläuft, aus wie ein Strom, der nicht kommt.
    expect(kameraSatz(stand())).toBe('Standbild – Live-Bild startet …');
  });

  it('läuft er, steht da «Live»', () => {
    expect(kameraSatz(stand({ liveLaeuft: true }))).toBe('● Live');
  });

  it('nennt den Grund, wenn der Strom scheitert', () => {
    const satz = kameraSatz(stand({ liveMoeglich: false }), 'Zeitüberschreitung');
    expect(satz).toContain('Zeitüberschreitung');
    expect(satz).toContain('Standbild alle 3 Sekunden');
  });

  it('ohne Strom und ohne Fehler bleibt es beim Standbild', () => {
    expect(kameraSatz(stand({ liveMoeglich: false }))).toBe(
      'Standbild alle 3 Sekunden'
    );
  });

  it('hängt die Bewegung hinten an', () => {
    expect(kameraSatz(stand({ liveLaeuft: true }), null, true)).toBe(
      '● Live · Bewegung erkannt'
    );
  });
});
