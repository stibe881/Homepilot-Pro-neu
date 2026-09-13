import React, { useEffect, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { useBlattKontext } from '../hooks/HubContext';
import { oberstes } from '../lib/blattstapel';
import { Meldungsband } from './Toast';

/**
 * Der Inhalt eines Modals, angemeldet bei der Startseite (Punkt 581 und
 * 582 der Werkbank).
 *
 * Ein natives Modal ist für die Startseite eine Wand: Die Meldungen im
 * Wurzel-View liegen dahinter, und Tipps darin erreichen ihren
 * `onTouchStart` nicht. Beides erledigt dieser eine Rahmen, direkt
 * unter dem `<Modal>`:
 *
 * - Er meldet sich beim Öffnen im Stapel an und beim Schliessen ab, und
 *   liegt er zuoberst, zeichnet er das Meldungsband - die Absage des
 *   Hubs zum Türöffner steht damit im Klingelblatt, wo man hinschaut.
 * - Jede Berührung geht als «beruehrt» an die Startseite, damit die
 *   Drei-Minuten-Rückkehr des Wandpanels sie zählt.
 * - `haeltWach` setzt diese Rückkehr ganz aus: Beim Kochen, beim
 *   Klingeln und am Grill soll das Panel nicht mittendrin auf die
 *   Startseite springen.
 *
 * Ohne Provider darüber (Kinder-Ansicht, Tests) ist er ein blosser
 * View - das Blatt geht auf wie bisher, zeigt nur keine Meldungen.
 */
/** Die laufende Nummer für das nächste Blatt. */
let zaehler = 0;

export function Blatt({
  haeltWach = false,
  style,
  children,
}: {
  haeltWach?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const kontext = useBlattKontext();
  // Die Kennung einmal je eingehängtem Blatt - ein Zähler statt einer
  // ID aus dem Inhalt, damit zwei gleichzeitig offene Fernbedienungen
  // (Raumkachel und Gerätekachel) nicht dieselbe tragen.
  const kennung = useRef(0);
  if (kennung.current === 0) kennung.current = ++zaehler;
  const anmelden = kontext?.anmelden;
  const abmelden = kontext?.abmelden;
  useEffect(() => {
    if (!anmelden || !abmelden) return undefined;
    const meine = kennung.current;
    anmelden({ kennung: meine, haeltWach });
    return () => abmelden(meine);
  }, [anmelden, abmelden, haeltWach]);
  const oben = !!kontext && oberstes(kontext.stapel) === kennung.current;
  return (
    <View style={[{ flex: 1 }, style]} onTouchStart={kontext?.beruehrt}>
      {children}
      {oben ? <Meldungsband /> : null}
    </View>
  );
}
