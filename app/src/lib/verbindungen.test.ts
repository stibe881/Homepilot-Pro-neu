/** Die reinen Teile der Verbindungen-Seite. */

import {
  erinnerungsWort,
  geraetZeile,
  gueltigeKalenderId,
  gueltigerHost,
  kalenderName,
} from './verbindungen';

describe('kalenderName', () => {
  it('uebersetzt primary und den geburtstags-kalender', () => {
    expect(kalenderName('primary')).toBe('Hauptkalender');
    expect(kalenderName('addressbook#contacts@group.v.calendar.google.com')).toBe(
      'Geburtstage (Google-Kontakte)'
    );
  });

  it('laesst eine mail-adresse stehen - sie IST die auskunft', () => {
    expect(kalenderName(' stefan@gmail.com ')).toBe('stefan@gmail.com');
  });
});

describe('eingaben pruefen', () => {
  it('nimmt mail-adressen und google-kennungen', () => {
    expect(gueltigeKalenderId('stefan@gmail.com')).toBe(true);
    expect(gueltigeKalenderId('de.ch#holiday@group.v.calendar.google.com')).toBe(true);
    expect(gueltigeKalenderId('mit leerzeichen')).toBe(false);
    expect(gueltigeKalenderId('')).toBe(false);
  });

  it('nimmt nur harmlose geraeteadressen', () => {
    expect(gueltigerHost('192.168.1.35')).toBe(true);
    expect(gueltigerHost('chromecast.local')).toBe(true);
    expect(gueltigerHost('10.0.0.1; rm -rf')).toBe(false);
  });
});

describe('anzeige', () => {
  it('nennt den vorlauf beim wort', () => {
    expect(erinnerungsWort(0)).toBe('Aus');
    expect(erinnerungsWort(15)).toBe('15 Min');
  });

  it('zeigt den port nur, wenn er eine gruppe verraet', () => {
    expect(geraetZeile({ name: 'Küche', host: '10.0.0.5', port: 8009, erreichbar: true })).toBe(
      '10.0.0.5'
    );
    expect(
      geraetZeile({ name: 'Alle', host: '10.0.0.5', port: 32187, erreichbar: null })
    ).toBe('10.0.0.5 · Gruppe');
  });
});
