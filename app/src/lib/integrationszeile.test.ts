import { integrationDetail } from './integrationszeile';

const laeuft = { ok: true, error: null, entities: 12, unavailable: 0 };

describe('integrationDetail', () => {
  it('zählt die Geräte, solange es welche gibt', () => {
    expect(integrationDetail(laeuft)).toBe('12 Geräte');
    expect(integrationDetail({ ...laeuft, entities: 1 })).toBe('1 Gerät');
    expect(integrationDetail({ ...laeuft, unavailable: 2 })).toBe(
      '12 Geräte, 2 nicht erreichbar'
    );
  });

  it('lässt der eigenen Auskunft den Vortritt, wenn es keine Geräte gibt', () => {
    // Der Fall Life360: Die Personen gehören dem Geofence, hier stand
    // deshalb «0 Geräte» - und darunter der Satz, der es wirklich sagt.
    expect(
      integrationDetail({
        ...laeuft,
        entities: 0,
        health: { ok: true, detail: '2 von 2 Personen gemeldet' },
      })
    ).toBeNull();
  });

  it('sagt ohne eigene Auskunft wenigstens keine Zahl', () => {
    expect(integrationDetail({ ...laeuft, entities: 0 })).toBe('Keine eigenen Geräte');
    expect(integrationDetail({ ...laeuft, entities: 0, health: { ok: true } })).toBe(
      'Keine eigenen Geräte'
    );
  });

  it('zeigt bei einer Störung deren Begründung', () => {
    expect(integrationDetail({ ok: false, error: 'Token abgelaufen', entities: 0 })).toBe(
      'Token abgelaufen'
    );
    // Ohne Begründung darf die Zeile nicht leer bleiben - sonst sieht die
    // gestörte Integration aus wie eine, die nichts zu sagen hat.
    expect(integrationDetail({ ok: false, error: null, entities: 0 })).toBe(
      'Gestört – ohne Begründung'
    );
  });
});
