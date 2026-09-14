import { istWarteSchritt, neueWarteId, wartezeitLabel } from './szenenwarten';

describe('istWarteSchritt', () => {
  it('erkennt nur das eine Kommando', () => {
    expect(istWarteSchritt({ command: 'wait' })).toBe(true);
    expect(istWarteSchritt({ command: 'turn_on' })).toBe(false);
  });
});

describe('neueWarteId', () => {
  it('liefert jedes Mal eine andere Kennung', () => {
    const a = neueWarteId();
    const b = neueWarteId();
    expect(a).not.toBe(b);
    expect(a.startsWith('__warten_')).toBe(true);
  });
});

describe('wartezeitLabel', () => {
  it('zählt unter einer Minute in Sekunden', () => {
    expect(wartezeitLabel(1)).toBe('1 Sekunde');
    expect(wartezeitLabel(30)).toBe('30 Sekunden');
  });

  it('zählt ab einer Minute in Minuten', () => {
    expect(wartezeitLabel(60)).toBe('1 Minute');
    expect(wartezeitLabel(300)).toBe('5 Minuten');
    // Gerundet statt abgeschnitten - 90 Sekunden sind näher bei 2 als bei 1.
    expect(wartezeitLabel(90)).toBe('2 Minuten');
  });
});
