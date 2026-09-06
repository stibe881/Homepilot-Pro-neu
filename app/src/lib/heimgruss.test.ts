import {
  HeimgrussStand,
  hinterlegtText,
  istOffen,
  restText,
  standZeile,
} from './heimgruss';

// Der Hub rechnet in Sekunden, die App in Millisekunden - die Tests
// rechnen bewusst beides aus denselben Zahlen, damit ein vergessener
// Faktor tausend hier auffällt und nicht erst im Blatt.
const JETZT_MS = 1_700_000_000_000;
const JETZT_S = JETZT_MS / 1000;

const stand = (bis: number, by = 'Stefan'): HeimgrussStand => ({
  by,
  at: JETZT_S - 60,
  until: bis,
  speakers: [],
});

describe('restText', () => {
  it('zählt über zwei Stunden in Stunden', () => {
    expect(restText(JETZT_S + 47 * 3600, JETZT_MS)).toBe('noch 47 Std.');
  });

  it('zählt darunter in Minuten - «noch 0 Std.» klänge nach weg', () => {
    expect(restText(JETZT_S + 90 * 60, JETZT_MS)).toBe('noch 90 Min.');
  });

  it('ist bei einer abgelaufenen Nachricht leer', () => {
    expect(restText(JETZT_S - 1, JETZT_MS)).toBe('');
  });
});

describe('istOffen', () => {
  it('kennt liegend, abgelaufen und gar nichts', () => {
    expect(istOffen(stand(JETZT_S + 3600), JETZT_MS)).toBe(true);
    // Der Hub räumt erst bei der nächsten Ankunft auf - die App darf
    // eine kalte Nachricht trotzdem nicht mehr anbieten.
    expect(istOffen(stand(JETZT_S - 1), JETZT_MS)).toBe(false);
    expect(istOffen(null, JETZT_MS)).toBe(false);
    expect(istOffen(undefined, JETZT_MS)).toBe(false);
  });
});

describe('standZeile', () => {
  it('sagt, von wem die Nachricht ist und wie lange sie noch liegt', () => {
    expect(standZeile(stand(JETZT_S + 2 * 3600), JETZT_MS)).toBe(
      'Nachricht von Stefan wartet aufs nächste Heimkommen · noch 2 Std.'
    );
  });

  it('kommt ohne Namen aus - ein alter Hub könnte keinen liefern', () => {
    expect(standZeile(stand(JETZT_S + 3600, ''), JETZT_MS)).toContain(
      'Eine Nachricht wartet'
    );
  });
});

describe('hinterlegtText', () => {
  it('nennt das Ziel - hinterlegt ist nicht abgespielt', () => {
    expect(hinterlegtText('Küche')).toBe(
      'Hinterlegt - wer als Nächstes heimkommt, hört deine Nachricht (Küche).'
    );
  });
});
