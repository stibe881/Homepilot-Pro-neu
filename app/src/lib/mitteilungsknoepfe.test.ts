import {
  KNOPF_ERLEDIGT,
  KNOPF_ICHMACHS,
  KNOPF_PASST,
  KNOPF_SPAETER,
  knopfHandlung,
} from './mitteilungsknoepfe';

describe('knopfHandlung', () => {
  it('erkennt die Griffe', () => {
    expect(knopfHandlung(KNOPF_SPAETER)).toBe('spaeter');
    expect(knopfHandlung(KNOPF_ERLEDIGT)).toBe('erledigt');
  });

  it('lässt das blosse Antippen der Mitteilung in Ruhe', () => {
    // Der Standardknopf öffnet die App - das ist keiner unserer Griffe,
    // sondern der Sprung, den useNotificationTap schon kennt.
    expect(knopfHandlung('expo.modules.notifications.actions.DEFAULT')).toBeNull();
    expect(knopfHandlung(undefined)).toBeNull();
    expect(knopfHandlung('')).toBeNull();
  });
});

describe('«Ich mach’s»', () => {
  it('kommt als eigene Handlung zurück', () => {
    expect(knopfHandlung(KNOPF_ICHMACHS)).toBe('ichmachs');
  });
});

describe('«Passt so»', () => {
  it('kommt als eigene Handlung zurück', () => {
    // Der Knopf unter «steht offen»: Die Türe steht absichtlich offen -
    // für diese Öffnung ist Ruhe, samt zurückgelegter Erinnerungen.
    expect(knopfHandlung(KNOPF_PASST)).toBe('passt');
  });
});
