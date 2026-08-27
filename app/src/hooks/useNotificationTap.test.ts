/**
 * Was aus einer Mitteilung zurückkommt: ein Sprung oder ein Knopf.
 */
import { knopfAusResponse, tapFromResponse } from './useNotificationTap';

const antwort = (actionIdentifier: string, content: Record<string, unknown>) => ({
  actionIdentifier,
  notification: { request: { content } },
});

describe('knopfAusResponse', () => {
  it('erkennt «Später» samt dem, was in der Meldung stand', () => {
    expect(
      knopfAusResponse(
        antwort('spaeter30', {
          title: 'Fenster offen',
          body: 'seit 2 Std',
          data: { category: 'open' },
        })
      )
    ).toEqual({
      handlung: 'spaeter',
      title: 'Fenster offen',
      body: 'seit 2 Std',
      category: 'open',
      entityId: undefined,
    });
  });

  it('erkennt «Erledigt» samt betroffenem Gerät', () => {
    const druck = knopfAusResponse(
      antwort('erledigt', {
        title: 'Batterie schwach: Rauchmelder Flur',
        body: '',
        data: { entity_id: 'hm.rauchmelder', category: 'battery' },
      })
    );
    expect(druck?.handlung).toBe('erledigt');
    expect(druck?.entityId).toBe('hm.rauchmelder');
  });

  it('lässt das gewöhnliche Antippen dem Sprung', () => {
    // Sonst öffnete «auf die Meldung tippen» keine Kamera mehr.
    const roh = antwort('expo.modules.notifications.actions.DEFAULT', {
      title: 'Bewegung',
      data: { camera: 'ring.haustuere' },
    });
    expect(knopfAusResponse(roh)).toBeNull();
    expect(tapFromResponse(roh)?.camera).toBe('ring.haustuere');
  });

  it('kommt mit einer Meldung ohne Titel nicht durcheinander', () => {
    // Ohne Titel liesse sich nichts zurücklegen - der Titel ist der
    // Schlüssel der Warteschlange im Hub.
    expect(knopfAusResponse(antwort('spaeter30', { body: 'nur Text' }))).toBeNull();
    expect(knopfAusResponse(undefined)).toBeNull();
  });
});
