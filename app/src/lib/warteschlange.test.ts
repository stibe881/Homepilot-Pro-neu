/**
 * Befehle, die im Funkloch getippt wurden.
 *
 * Geprüft wird die Entscheidung, nicht das Senden: Was bleibt in der
 * Schlange, was fällt weg, und was geht raus, wenn die Verbindung
 * wiederkommt.
 */
import { enqueue, stillFresh } from './warteschlange';

const T0 = 1_000_000;
const befehl = (entityId: string, command: string, at: number) => ({
  entityId,
  command,
  at,
});

describe('enqueue', () => {
  it('legt den ersten Befehl einfach ab', () => {
    expect(enqueue([], befehl('hue.a', 'turn_on', T0))).toHaveLength(1);
  });

  it('ersetzt denselben Befehl am selben Gerät', () => {
    // Fünfmal auf dasselbe Licht getippt heisst einmal Licht – nicht
    // fünf Schaltungen, die sich am Ende gegenseitig aufheben.
    let queue = enqueue([], befehl('hue.a', 'toggle', T0));
    queue = enqueue(queue, befehl('hue.a', 'toggle', T0 + 500));
    queue = enqueue(queue, befehl('hue.a', 'toggle', T0 + 900));
    expect(queue).toHaveLength(1);
    expect(queue[0].at).toBe(T0 + 900);
  });

  it('hält verschiedene Geräte auseinander', () => {
    let queue = enqueue([], befehl('hue.a', 'turn_on', T0));
    queue = enqueue(queue, befehl('hue.b', 'turn_on', T0 + 10));
    expect(queue).toHaveLength(2);
  });

  it('lässt zwei verschiedene Befehle am selben Gerät stehen', () => {
    let queue = enqueue([], befehl('cover.a', 'open', T0));
    queue = enqueue(queue, befehl('cover.a', 'stop', T0 + 10));
    expect(queue.map((e) => e.command)).toEqual(['open', 'stop']);
  });

  it('wirft Altes beim Einreihen gleich weg', () => {
    const alt = enqueue([], befehl('hue.a', 'turn_on', T0));
    const neu = enqueue(alt, befehl('hue.b', 'turn_on', T0 + 200_000));
    expect(neu.map((e) => e.entityId)).toEqual(['hue.b']);
  });

  it('läuft nicht über', () => {
    let queue: ReturnType<typeof befehl>[] = [];
    for (let i = 0; i < 50; i += 1) {
      queue = enqueue(queue, befehl(`hue.${i}`, 'turn_on', T0 + i));
    }
    expect(queue).toHaveLength(20);
    // Die jüngsten bleiben – die ältesten sind die, an die sich niemand
    // mehr erinnert.
    expect(queue[queue.length - 1].entityId).toBe('hue.49');
  });
});

describe('stillFresh', () => {
  it('lässt Frisches durch und Altes liegen', () => {
    const queue = [befehl('hue.a', 'turn_on', T0), befehl('hue.b', 'turn_on', T0 + 119_000)];
    // Zwei Minuten und eine Sekunde nach dem ersten Tipp: Der erste ist
    // durch, der zweite hat noch fast zwei Minuten.
    const raus = stillFresh(queue, T0 + 121_000);
    expect(raus.map((e) => e.entityId)).toEqual(['hue.b']);
  });
});
