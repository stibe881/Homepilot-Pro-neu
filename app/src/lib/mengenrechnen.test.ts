/**
 * Mengen zusammenzählen.
 *
 * Der Fall: Im Wocheneinkauf brauchen zwei Rezepte Milch. Bisher kam nur
 * die erste auf die Liste – im Laden stand man mit 400 ml da, wo 600
 * gebraucht wurden.
 */
import { mengeLesen, mengenAddieren, mengenLesen } from './mengen';

describe('mengeLesen', () => {
  it('trennt Zahl und Einheit', () => {
    expect(mengeLesen('400 ml')).toMatchObject({ wert: 400, einheit: 'ml' });
    expect(mengeLesen('1,5 kg')).toMatchObject({ wert: 1.5, einheit: 'kg' });
    expect(mengeLesen('3')).toMatchObject({ wert: 3, einheit: '' });
  });

  it('lässt eine Angabe ohne Zahl unberührt', () => {
    expect(mengeLesen('etwas')).toMatchObject({ wert: null, roh: 'etwas' });
  });
});

describe('mengenLesen', () => {
  it('liest auch eine zusammengesetzte Angabe', () => {
    expect(mengenLesen('400 ml + 2 Stück').map((m) => m.einheit)).toEqual(['ml', 'Stück']);
  });
});

describe('mengenAddieren', () => {
  it('zählt gleiche Einheiten zusammen', () => {
    // Genau der Fall aus dem Wocheneinkauf.
    expect(mengenAddieren('400 ml', '200 ml')).toBe('600 ml');
  });

  it('behält die gemeinsame Einheit, statt in die kleinste zu wechseln', () => {
    // Schweizer Rezepte rechnen in dl – 5 dl sollen 5 dl bleiben.
    expect(mengenAddieren('2 dl', '3 dl')).toBe('5 dl');
  });

  it('rechnet verschiedene Einheiten derselben Familie um', () => {
    expect(mengenAddieren('400 ml', '1 l')).toBe('1,4 l');
    expect(mengenAddieren('2 dl', '300 ml')).toBe('500 ml');
  });

  it('steigt ab tausend auf die grosse Einheit', () => {
    // «1000 g» liest niemand.
    expect(mengenAddieren('500 g', '500 g')).toBe('1 kg');
    expect(mengenAddieren('800 g', '700 g')).toBe('1½ kg');
  });

  it('zählt Löffel und Stücke nur mit ihresgleichen', () => {
    expect(mengenAddieren('2 EL', '1 EL')).toBe('3 EL');
    expect(mengenAddieren('2 Stück', '3 Stück')).toBe('5 Stück');
  });

  it('lässt stehen, was nicht zusammenpasst', () => {
    // Eine erfundene Zahl wäre schlimmer als zwei ehrliche Angaben.
    expect(mengenAddieren('400 ml', '2 Stück')).toBe('400 ml + 2 Stück');
    expect(mengenAddieren('2 EL', '1 Prise')).toBe('2 EL + 1 Prise');
    expect(mengenAddieren('500 g', '200 ml')).toBe('500 g + 200 ml');
  });

  it('verrechnet Gramm und Milliliter nicht miteinander', () => {
    expect(mengenAddieren('100 g', '100 ml')).toBe('100 g + 100 ml');
  });

  it('lässt eine leere Angabe weg', () => {
    expect(mengenAddieren('', '1 Prise')).toBe('1 Prise');
    expect(mengenAddieren('400 ml', '')).toBe('400 ml');
    expect(mengenAddieren('', '')).toBe('');
  });

  it('zählt auch zu einer zusammengesetzten Angabe dazu', () => {
    // Drittes Rezept: Die Milliliter finden ihre Milliliter wieder.
    expect(mengenAddieren('400 ml + 2 Stück', '100 ml')).toBe('500 ml + 2 Stück');
  });

  it('macht aus zweimal «etwas» nicht «2 etwas»', () => {
    expect(mengenAddieren('etwas', 'etwas')).toBe('etwas');
    expect(mengenAddieren('etwas', 'nach Gefühl')).toBe('etwas + nach Gefühl');
  });
});
