/**
 * Die aufgeklappte Wetterkarte: heute Stunde für Stunde.
 *
 * Der Wunsch dahinter: Ein Tipp auf die Wetterkachel der Startseite soll
 * das heutige stündliche Wetter zeigen - nicht nur die Woche.
 */
import { stundenZeilen } from './stundenwetter';

describe('stundenZeilen', () => {
  it('macht aus der Hub-Liste Spalten mit Uhrzeit', () => {
    const zeilen = stundenZeilen([
      {
        time: '2026-09-05T14:00',
        temp: 26.6,
        text: 'Klar',
        icon: 'sunny-outline',
        rain: 0,
      },
      {
        time: '2026-09-05T15:00',
        temp: 25,
        text: 'Regenschauer',
        icon: 'rainy-outline',
        rain: 55,
      },
    ]);
    expect(zeilen).toEqual([
      { zeit: '14:00', temp: 27, text: 'Klar', icon: 'sunny-outline', rain: 0 },
      { zeit: '15:00', temp: 25, text: 'Regenschauer', icon: 'rainy-outline', rain: 55 },
    ]);
  });

  it('lässt Kaputtes weg statt es anzuzeigen', () => {
    // Ein Hub von gestern oder eine halbe Antwort: kein Zeitstempel,
    // keine Zeile - «undefined°» stünde sonst in der Reihe.
    expect(
      stundenZeilen([
        null,
        'text',
        { temp: 20 },
        { time: 'kaputt', temp: 20 },
        { time: '2026-09-05T16:00' },
      ])
    ).toEqual([{ zeit: '16:00', temp: null, text: '', icon: 'cloud-outline', rain: null }]);
  });

  it('kommt mit einem Hub ohne Stundenwerte aus', () => {
    expect(stundenZeilen(undefined)).toEqual([]);
    expect(stundenZeilen('nope')).toEqual([]);
  });
});
