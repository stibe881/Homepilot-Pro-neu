import { letzterLaufSatz, vorWieLange } from './letzterlauf';

const JETZT = 1_700_000_000;

describe('vorWieLange', () => {
  it('sagt vergangen, nicht andauernd', () => {
    // «seit 5 Min.» las sich wie eine Dauer - hier ist es ein Zeitpunkt.
    expect(vorWieLange(30)).toBe('gerade eben');
    expect(vorWieLange(300)).toBe('vor 5 Min.');
    expect(vorWieLange(3600 * 3)).toBe('vor 3 Std.');
    expect(vorWieLange(3600 * 24 * 2)).toBe('vor 2 Tagen');
  });

  it('lässt sich von Unsinn nicht aus der Ruhe bringen', () => {
    expect(vorWieLange(-5)).toBe('gerade eben');
    expect(vorWieLange(NaN)).toBe('gerade eben');
  });
});

describe('letzterLaufSatz', () => {
  it('schweigt, wenn alles glatt lief', () => {
    // Die laufende Fassung steht ohnehin unter dem Knopf.
    expect(letzterLaufSatz({ state: 'ok', finished_at: JETZT - 60 }, JETZT)).toBeNull();
    expect(letzterLaufSatz(null, JETZT)).toBeNull();
    expect(letzterLaufSatz({}, JETZT)).toBeNull();
  });

  it('nennt Fehler samt Ursache', () => {
    // Genau das ging bisher verloren: Wer die App weglegte, sah den
    // gescheiterten Lauf nie.
    const satz = letzterLaufSatz(
      {
        state: 'error',
        message: 'Portainer hat den Container nicht gewechselt',
        detail: 'Re-pull image ist im Stack an. Ausschalten.',
        finished_at: JETZT - 600,
      },
      JETZT
    );
    expect(satz).not.toBeNull();
    expect(satz!.art).toBe('fehler');
    expect(satz!.text).toContain('vor 10 Min.');
    expect(satz!.text).toContain('Portainer hat den Container nicht gewechselt');
    expect(satz!.text).toContain('Re-pull image');
  });

  it('verschweigt Warnungen eines gelungenen Laufs nicht', () => {
    const satz = letzterLaufSatz(
      { state: 'ok', warnings: ['Der Web-Bau schlug fehl.'], finished_at: JETZT - 120 },
      JETZT
    );
    expect(satz).not.toBeNull();
    // Aber als Hinweis, nicht als Fehler: Der Lauf ist durchgelaufen,
    // der Hub ist neu. In Rot las sich das wie ein gescheitertes Update.
    expect(satz!.art).toBe('hinweis');
    expect(satz!.text).toContain('Der Web-Bau schlug fehl.');
  });

  it('erkennt einen Lauf, der nie zu Ende kam', () => {
    // Der Dienst schreibt seinen Ausgang am Ende. Steht danach noch
    // «running» da, wurde er mittendrin abgeräumt.
    const satz = letzterLaufSatz({ state: 'running', finished_at: JETZT - 30 }, JETZT);
    expect(satz!.art).toBe('fehler');
    expect(satz!.text).toContain('nicht zu Ende gekommen');
  });

  it('kommt ohne Zeitstempel aus', () => {
    const satz = letzterLaufSatz({ state: 'error', message: 'kaputt' }, JETZT);
    expect(satz!.text.startsWith('Letztes Update:')).toBe(true);
  });
});
