import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View, ViewStyle } from 'react-native';

import { helligkeitAus, istWischen, lohntSenden } from '../../lib/wischdimmen';

/**
 * Die Fläche der Lichtkachel, über die man dimmen kann.
 *
 * Der Regler gab es nur, solange Licht brennt. Eine ausgeschaltete Lampe
 * auf 30 % zu bringen kostete drei Griffe – und der erste blendet.
 *
 * Das Rechnen steht in lib/wischdimmen.ts, hier nur die Geste. Drei
 * Dinge, die sie verträglich machen:
 *
 * - **Sie nimmt erst zu, wenn sie sicher gemeint ist.** Beansprucht
 *   wird die Bewegung nicht beim Aufsetzen, sondern erst, wenn der
 *   Finger deutlich waagrecht gelaufen ist. Bis dahin gehört sie dem
 *   Tipp und der Liste – sonst klebte die Seite an der ersten
 *   Lichtkachel, sobald jemand leicht schräg scrollt.
 * - **Sie zeigt sofort, was sie tut.** Der Wert unter dem Finger steht
 *   auf der Kachel, bevor der Hub geantwortet hat; sonst zieht man ins
 *   Blinde.
 * - **Sie redet nicht dauernd.** Geschickt wird erst ab einem
 *   spürbaren Schritt – ein Befehl je Bild bringt jede Bridge aus dem
 *   Takt.
 */
export function Wischdimmer({
  wert,
  aktiv,
  onDimmen,
  onFertig,
  style,
  children,
}: {
  /** Helligkeit beim Aufsetzen des Fingers. */
  wert: number;
  /** Aus heisst: gar keine Geste – etwa bei Lampen ohne Dimmer. */
  aktiv: boolean;
  /** Während des Ziehens, schon gedrosselt. */
  onDimmen: (helligkeit: number) => void;
  /** Beim Loslassen – mit dem endgültigen Wert. */
  onFertig: (helligkeit: number) => void;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}) {
  const [breite, setBreite] = useState(0);
  // Refs statt Zustand: Der Responder wird einmal gebaut und sähe sonst
  // für immer die Werte vom ersten Rendern.
  const start = useRef(wert);
  const letzter = useRef<number | null>(null);
  // Der zuletzt gerechnete Wert - und nicht die Strecke beim Loslassen.
  // React Native Web meldet dort ein `dx` von 0, und die Lampe landete
  // damit auf dem Anfangswert statt dort, wo der Finger war. Im
  // Browser nachgemessen.
  const aktuell = useRef(wert);
  const messwerte = useRef({ wert, breite, aktiv });
  messwerte.current = { wert, breite, aktiv };
  // Auch die Rückrufe über eine Ref: Sonst baut `useMemo` den Responder
  // mitten in der Geste neu, sobald der Aufrufer eine frische Funktion
  // hineingibt - und die laufende Bewegung reisst ab. Im Browser
  // gemessen: Die Lampe blieb dann auf dem Wert des ersten Schrittes
  // stehen.
  const rufe = useRef({ onDimmen, onFertig });
  rufe.current = { onDimmen, onFertig };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Beim Aufsetzen nichts nehmen - der Tipp gehört dem Schalter
        // darunter.
        onStartShouldSetPanResponderCapture: () => false,
        // Beim Bewegen dagegen *vor* dem Kind fragen. Ohne die
        // Capture-Fassung käme die Frage nie an: Der Pressable darunter
        // hat die Geste schon beim Aufsetzen genommen, und wer sie hält,
        // gibt sie nicht von selbst zurück. Genommen wird sie nur, wenn
        // die Bewegung eindeutig waagrecht ist - ein Tipp und ein
        // senkrechtes Scrollen laufen weiter durch.
        onMoveShouldSetPanResponderCapture: (_e, geste) =>
          messwerte.current.aktiv &&
          messwerte.current.breite > 0 &&
          istWischen(geste.dx, geste.dy),
        onPanResponderGrant: () => {
          start.current = messwerte.current.wert;
          aktuell.current = messwerte.current.wert;
          letzter.current = null;
        },
        onPanResponderMove: (_e, geste) => {
          const ziel = helligkeitAus(start.current, geste.dx, messwerte.current.breite);
          aktuell.current = ziel;
          if (!lohntSenden(letzter.current, ziel)) return;
          letzter.current = ziel;
          rufe.current.onDimmen(ziel);
        },
        onPanResponderRelease: () => {
          letzter.current = null;
          rufe.current.onFertig(aktuell.current);
        },
        // Nimmt jemand anders die Geste weg (die Liste beim Ziehen einer
        // Kachel), bleibt die Lampe dort stehen, wo sie gerade ist -
        // besser als ein Sprung zurück auf den Anfangswert.
        onPanResponderTerminate: () => {
          letzter.current = null;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    []
  );

  return (
    <View
      style={style}
      onLayout={(event) => setBreite(event.nativeEvent.layout.width)}
      {...(aktiv ? responder.panHandlers : {})}
    >
      {children}
    </View>
  );
}
