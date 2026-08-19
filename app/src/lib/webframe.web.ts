/**
 * Den Rahmen der Web-Fassung festnageln.
 *
 * Als Web-App auf dem iPhone-Homescreen scrollt sonst die *Seite* mit,
 * nicht nur der Inhalt: Die obere Zeile («3 Lichter an») und die untere
 * Leiste wandern dabei aus dem Bild, und man zoomt heraus, um beides zu
 * sehen. Die App bringt ihr eigenes Scrollen mit – die Seite darunter
 * soll stillhalten.
 *
 * Bewusst hier im Code und nicht in einer HTML-Vorlage: Die index.html
 * erzeugt Expo beim Export selbst. Was wir dort hineinschreiben, wäre
 * beim nächsten Fassungswechsel weg; das hier bleibt.
 */

const STYLE_ID = 'homepilot-frame';

export function fixWebFrame(): void {
  if (typeof document === 'undefined') return;

  // 1. Sichtfeld. viewport-fit=cover ist die Bedingung dafür, dass iOS
  //    die Masse von Kerbe und Home-Anzeige überhaupt herausgibt - ohne
  //    sie meldet es überall 0, und die App polstert an der falschen
  //    Stelle. maximum-scale bewusst NICHT gesetzt: Wer schlecht sieht,
  //    soll zoomen dürfen.
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.setAttribute('name', 'viewport');
    document.head.appendChild(viewport);
  }
  viewport.setAttribute(
    'content',
    'width=device-width, initial-scale=1, viewport-fit=cover'
  );

  // 2. Als Web-App ohne Browser-Leisten laufen und die Statusleiste
  //    durchscheinen lassen - sonst steht über der App ein weisser
  //    Balken, der nicht zum dunklen Hintergrund passt.
  for (const [name, content] of [
    ['apple-mobile-web-app-capable', 'yes'],
    ['mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
  ]) {
    if (!document.querySelector(`meta[name="${name}"]`)) {
      const tag = document.createElement('meta');
      tag.setAttribute('name', name);
      tag.setAttribute('content', content);
      document.head.appendChild(tag);
    }
  }

  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* 100dvh statt 100vh: Auf iOS meint vh die Höhe MIT eingeblendeten
       Leisten, dvh die tatsächlich sichtbare. Mit vh ragt der untere
       Rand der App unter die Home-Anzeige. */
    html, body, #root {
      height: 100%;
      height: 100dvh;
      margin: 0;
      /* Der Kern: Die Seite selbst scrollt nicht. Gescrollt wird
         ausschliesslich innerhalb der App, und obere Zeile wie untere
         Leiste bleiben stehen, wo sie hingehören. */
      overflow: hidden;
      /* Kein Gummiband-Effekt am Rand, kein Ziehen-zum-Neuladen mitten
         im Wischen über eine Kachelreihe. */
      overscroll-behavior: none;
    }
    body {
      /* iOS vergrössert sonst eigenmächtig Schrift in schmalen Spalten. */
      -webkit-text-size-adjust: 100%;
    }
    /* Ein Doppeltipp auf eine Kachel soll schalten, nicht zoomen. */
    #root { touch-action: manipulation; }
  `;
  document.head.appendChild(style);
}
