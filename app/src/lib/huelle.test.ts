import { ablageDiagnose, bauZeitIso, huelleZeile } from './huelle';

describe('bauZeitIso', () => {
  test('eine Minuten-Nummer wird zum Bau-Zeitpunkt', () => {
    // 29811236 Minuten seit 1970 – der Build vom 6. September 2026.
    expect(bauZeitIso('29811236')).toBe('2026-09-06T05:56:00.000Z');
  });

  test('alte Zaehlweisen ergeben kein Datum', () => {
    // Commit-Anzahl (928) und Handvergabe (2) sind keine Minuten –
    // «gebaut am 1. Januar 1970» waere schlimmer als gar keine Angabe.
    expect(bauZeitIso('928')).toBeNull();
    expect(bauZeitIso('2')).toBeNull();
  });

  test('unlesbares ergibt kein Datum', () => {
    expect(bauZeitIso('1.4.20')).toBeNull();
    expect(bauZeitIso('')).toBeNull();
    expect(bauZeitIso(null)).toBeNull();
    expect(bauZeitIso(undefined)).toBeNull();
  });
});

describe('huelleZeile', () => {
  test('nennt Build samt Bau-Zeitpunkt und Laufzeit', () => {
    const zeile = huelleZeile('29811236', '5');
    expect(zeile).toContain('Build 29811236');
    expect(zeile).toContain('gebaut');
    expect(zeile).toContain('Laufzeit 5');
  });

  test('eine alte Build-Nummer steht ohne Zeitpunkt da', () => {
    expect(huelleZeile('928', '4')).toBe('Diese Hülle: Build 928 · Laufzeit 4');
  });

  test('ohne Angaben bleibt die Zeile leer', () => {
    // Im Browser gibt es weder Build-Nummer noch Laufzeit – dort soll
    // kein leeres «Diese Hülle:» herumstehen.
    expect(huelleZeile(null, null)).toBe('');
    expect(huelleZeile(undefined, undefined)).toBe('');
  });

  test('eine Angabe allein genuegt', () => {
    expect(huelleZeile(null, '5')).toBe('Diese Hülle: Laufzeit 5');
  });
});

describe('ablageDiagnose', () => {
  test('gefunden heisst nichts zu diagnostizieren', () => {
    expect(ablageDiagnose(true, ['ExtensionStorage'], true)).toBe('');
  });

  test('fehlendes expo-Objekt wird beim Namen genannt', () => {
    expect(ablageDiagnose(false, [], false)).toBe(
      'Innenansicht: Das expo-Objekt fehlt im JavaScript ganz.'
    );
  });

  test('leere Modulliste heisst: die Liste ist das Problem', () => {
    expect(ablageDiagnose(true, [], false)).toBe(
      'Innenansicht: Die Hülle meldet gar keine nativen Module.'
    );
  });

  test('verwandte Namen werden aufgezaehlt', () => {
    // Heisst das Modul in der Hülle anders als erwartet, ist genau das
    // die gesuchte Antwort - sie soll auf dem Foto stehen.
    const zeile = ablageDiagnose(
      true,
      ['ExpoFont', 'ExtensionStorageModule', 'WidgetKitBruecke'],
      false
    );
    expect(zeile).toContain('3 native Module');
    expect(zeile).toContain('«ExtensionStorageModule»');
    expect(zeile).toContain('«WidgetKitBruecke»');
  });

  test('ohne verwandte Namen bleibt es bei der Zaehlung', () => {
    expect(ablageDiagnose(true, ['ExpoFont', 'ExpoVideo'], false)).toBe(
      'Innenansicht: 2 native Module gemeldet, keines heisst «ExtensionStorage».'
    );
  });
});
