/**
 * Was aus einer angetippten Push-Nachricht ausgepackt wird.
 *
 * Der Weg ist kurz, aber niemand sieht ihn: Der Hub legt der Nachricht
 * etwas bei, das Telefon reicht es durch, und erst am anderen Ende
 * entscheidet sich, ob die App zur Kamera springt oder zu den Batterien.
 * Geht dabei ein Feld verloren, öffnet sich schlicht die Startseite –
 * und niemand weiss, warum.
 */
import { tapFromResponse } from './useNotificationTap';

const antwort = (data: unknown) => ({
  notification: { request: { content: { data } } },
});

describe('tapFromResponse', () => {
  it('packt die Batteriewarnung aus', () => {
    expect(
      tapFromResponse(antwort({ type: 'battery', entity_id: 'hm.rauchmelder' }))
    ).toEqual({ camera: undefined, entityId: 'hm.rauchmelder', type: 'battery' });
  });

  it('packt die Kamera einer Alarmmeldung aus', () => {
    expect(tapFromResponse(antwort({ camera: 'unifi.flur', type: 'alarm' }))).toEqual({
      camera: 'unifi.flur',
      entityId: undefined,
      type: 'alarm',
    });
  });

  it('gibt nichts zurück, wo nichts beiliegt', () => {
    // Dann öffnet sich die App auf der Startseite – das ist richtig so,
    // solange es nichts Besseres zu tun gibt.
    expect(tapFromResponse(antwort({}))).toBeNull();
    expect(tapFromResponse(antwort(undefined))).toBeNull();
    expect(tapFromResponse(antwort('kein Wörterbuch'))).toBeNull();
    expect(tapFromResponse(undefined)).toBeNull();
  });

  it('lässt sich von falschen Feldtypen nicht aus der Ruhe bringen', () => {
    expect(tapFromResponse(antwort({ camera: 42, entity_id: null, type: 7 }))).toBeNull();
  });
});
