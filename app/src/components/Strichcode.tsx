import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { strichbild } from '../lib/strichcode';

/**
 * Die Gutscheinnummer als Strichcode - für die Kasse.
 *
 * Gezeichnet und nicht geladen: Ein Strichcode ist Arithmetik
 * (lib/strichcode.ts), und ein natives Modul dafür hiesse
 * `runtimeVersion` hochzählen und einen TestFlight-Build hinterher.
 *
 * Immer auf Weiss und immer schwarz, auch im dunklen Thema: Ein Scanner
 * misst den Unterschied zwischen hell und dunkel, und ein hellgrauer
 * Code auf dunkelgrauem Grund ist für ihn kein Code. Deshalb steht hier
 * kein `useColors()` - das ist keine Nachlässigkeit, sondern der Punkt.
 *
 * Die Ruhezone links und rechts gehört dazu: Ohne sie liest mancher
 * Scanner den ersten Balken nicht.
 */
export function Strichcode({
  nummer,
  hoehe = 90,
  breite,
}: {
  nummer: string | null | undefined;
  hoehe?: number;
  /** Wie breit gezeichnet wird. Ohne Angabe füllt der Code seine Zeile. */
  breite?: number;
}) {
  const bild = useMemo(() => strichbild(nummer), [nummer]);
  if (!bild) return null;

  // Zehn Module Ruhezone je Seite - so steht es in beiden Normen.
  const RUHE = 10;
  const gesamt = bild.module + RUHE * 2;
  let x = RUHE;
  const rechtecke = bild.balken.map((balken, index) => {
    const links = x;
    x += balken.breit;
    return balken.an ? (
      <Rect
        key={index}
        x={links}
        y={0}
        width={balken.breit}
        height={100}
        fill="#000000"
      />
    ) : null;
  });

  return (
    <View
      accessibilityLabel={`Strichcode ${bild.text}`}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
        gap: 6,
        ...(breite ? { width: breite } : { alignSelf: 'stretch' }),
      }}
    >
      <Svg
        width="100%"
        height={hoehe}
        viewBox={`0 0 ${gesamt} 100`}
        preserveAspectRatio="none"
      >
        {rechtecke}
      </Svg>
      {/* Die Ziffern darunter: Wenn der Scanner streikt, tippt die
          Kassiererin sie ab - und dann sollen sie dastehen, wo sie es
          auf jeder Karte auch tun. */}
      <Text
        style={{
          color: '#000000',
          fontSize: 13,
          letterSpacing: 2,
          fontVariant: ['tabular-nums'],
        }}
      >
        {bild.text}
      </Text>
    </View>
  );
}
