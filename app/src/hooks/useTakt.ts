import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Ein Takt, der im Hintergrund schweigt.
 *
 * Sechzehn Stellen bauten sich ihren setInterval selbst – und keine
 * einzige hielt an, wenn die App in den Hintergrund ging. Das
 * Betriebssystem friert die App zwar irgendwann ein, aber bis dahin
 * fragen zwölf Abfragen weiter den Hub, für einen Bildschirm, den
 * niemand sieht; und nach dem Aufwachen zeigt die erste Sekunde den
 * Stand von vor einer Stunde.
 *
 * Dieser Takt macht beides richtig: Er hält an, sobald die App den
 * Bildschirm verliert, und beim Zurückkommen schlägt er sofort einmal –
 * die Anzeige ist damit frisch, bevor der reguläre Takt weiterläuft.
 *
 * Der Aufrufer behält seinen ersten Abruf beim Einhängen selbst in der
 * Hand (meist `useEffect(load, [load])`) – der Takt beginnt erst nach
 * dem ersten Intervall zu schlagen.
 *
 * ``ms: null`` heisst «gerade kein Takt» – für Zähler, die nur laufen,
 * solange etwas abläuft (Küchen-Timer, TV-Schlummer).
 */
export function useTakt(tick: () => void, ms: number | null): void {
  // Über ein Ref, damit ein neuer Callback (neue Abhängigkeiten im
  // useCallback des Aufrufers) den Takt nicht neu startet – sonst
  // beginnt das Intervall bei jeder Änderung wieder bei null.
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (ms === null) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) {
        timer = setInterval(() => tickRef.current(), ms);
      }
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    start();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        tickRef.current();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [ms]);
}
