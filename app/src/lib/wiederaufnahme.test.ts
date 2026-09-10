import { FRIST_MINUTEN, merkbar, zurueckZu } from './wiederaufnahme';

const JETZT = 1_700_000_000_000;
const gerade = { section: 'automations', at: JETZT - 60_000 };

describe('zurueckZu', () => {
  it('bringt einen zurück, wo man gerade war', () => {
    // Der Fall: Man steht in den Abläufen, das Telefon sperrt sich, man
    // entsperrt es – und ist auf der Startseite.
    expect(zurueckZu(gerade, JETZT)).toBe('automations');
  });

  it('vergisst es nach der Frist', () => {
    // Die Frage von gestern ist beantwortet.
    const gestern = { section: 'automations', at: JETZT - (FRIST_MINUTEN + 1) * 60_000 };
    expect(zurueckZu(gestern, JETZT)).toBeNull();
  });

  it('macht am Wandtablet immer die Startseite auf', () => {
    // Dort ist die Startseite kein Standardwert, sondern der Zweck: Es
    // hängt im Flur und soll zeigen, wie es im Haus steht.
    expect(zurueckZu(gerade, JETZT, { tablet: true })).toBeNull();
  });

  it('kehrt nicht zur Alarmanlage zurück', () => {
    // Sie sieht nach «etwas ist passiert» aus, auch wenn nichts war.
    expect(zurueckZu({ section: 'alarm', at: JETZT }, JETZT)).toBeNull();
  });

  it('kehrt nicht zur Benutzerverwaltung zurück', () => {
    // Wer das Telefon jemandem in die Hand gibt, will nicht, dass es
    // dort aufmacht.
    expect(zurueckZu({ section: 'users', at: JETZT }, JETZT)).toBeNull();
  });

  it('macht aus einer kaputten Zeile keine Ausnahme, sondern die Startseite', () => {
    expect(zurueckZu(null, JETZT)).toBeNull();
    expect(zurueckZu('unfug', JETZT)).toBeNull();
    expect(zurueckZu({ section: 'automations' }, JETZT)).toBeNull();
    expect(zurueckZu({ at: JETZT }, JETZT)).toBeNull();
  });
});

describe('merkbar', () => {
  it('merkt sich die Startseite nicht', () => {
    // Sie ist ohnehin das Ziel – ein Eintrag dafür wäre ein Eintrag,
    // der nie etwas ändert.
    expect(merkbar('start')).toBe(false);
  });

  it('merkt sich gewöhnliche Seiten schon', () => {
    expect(merkbar('automations')).toBe(true);
    expect(merkbar('family')).toBe(true);
  });
});
