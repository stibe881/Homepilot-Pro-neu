import { SECTION_LABEL, type Section } from './bereiche';
import { SEITENHILFE, hilfeFuer, knopfWort } from './seitenhilfe';

describe('seitenhilfe', () => {
  it('kennt jede Seite, die einen eigenen Menüpunkt hat', () => {
    // Wer auf einer Seite steht und das Fragezeichen sucht, soll es
    // finden. Die Liste hier ist die Zusage: Kommt ein Bereich dazu,
    // fällt dieser Test um, bis er seine zwei Sätze hat.
    const erwartet: Section[] = [
      'start',
      'home',
      'settings',
      'devices',
      'alarm',
      'automations',
      'besuch',
      'personen',
      'users',
      'account',
      'connection',
      'system',
      'energy',
      'speakers',
      'activity',
      'widgets',
      'family',
    ];
    for (const bereich of erwartet) {
      expect(hilfeFuer(bereich)).not.toBeNull();
    }
  });

  it('führt nur zu Bereichen, die es gibt', () => {
    // Ein Ziel, das keinen Bereich trifft, ist ein Knopf, der nichts
    // tut - und zwar in dem Moment, in dem jemand nicht weiterweiss.
    for (const hilfe of Object.values(SEITENHILFE)) {
      for (const punkt of hilfe!.punkte) {
        if (!punkt.ziel) continue;
        expect(SECTION_LABEL[punkt.ziel]).toBeTruthy();
      }
    }
  });

  it('sagt in einem Satz, wofür die Seite da ist', () => {
    for (const [bereich, hilfe] of Object.entries(SEITENHILFE)) {
      expect(hilfe!.wofuer.length).toBeGreaterThan(20);
      // Ein Blatt ohne Punkte wäre eine Überschrift, keine Hilfe.
      expect(hilfe!.punkte.length).toBeGreaterThan(0);
      expect(bereich).toBeTruthy();
    }
  });

  it('beschriftet den Knopf mit dem Namen des Ziels', () => {
    expect(knopfWort({ text: 'x', ziel: 'devices' })).toBe('Zu Geräte');
    expect(knopfWort({ text: 'x', ziel: 'users', knopf: 'Zu den Benutzern' })).toBe(
      'Zu den Benutzern'
    );
    // Ohne Ziel gibt es keinen Knopf - und also auch keine Beschriftung.
    expect(knopfWort({ text: 'x' })).toBe('');
  });
});
