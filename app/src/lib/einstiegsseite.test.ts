import { einstiegsSeite } from './einstellungsmenue';

describe('Womit die Einstellungen aufgehen', () => {
  const seiten = ['automations', 'alarm', 'system'] as const;

  it('nimmt die Seite von letztem Mal', () => {
    // Wer zwischen System und Abläufen hin- und herspringt, soll nicht
    // jedes Mal von vorne anfangen.
    expect(einstiegsSeite(seiten, 'system')).toBe('system');
  });

  it('nimmt beim ersten Mal die erste', () => {
    expect(einstiegsSeite(seiten, null)).toBe('automations');
  });

  it('nimmt die erste, wenn es die von letztem Mal nicht mehr gibt', () => {
    // Andere Rolle, weniger Rechte - die gemerkte Seite steht dann nicht
    // mehr offen.
    expect(einstiegsSeite(seiten, 'users' as never)).toBe('automations');
  });

  it('ergibt null, wenn es keine Seite gibt', () => {
    // Ein Gast sieht kaum etwas; ein leerer Bereich wäre schlimmer als
    // eine kurze Liste.
    expect(einstiegsSeite([], 'system')).toBeNull();
  });
});
