/**
 * Das Bild des Grills auf seiner Kachel (Punkt 559).
 *
 * Ein Foto, wo es eines gibt (Punkt 564: das Bild des Smokers aus dem
 * Haus, freigestellt), sonst eine Zeichnung je Bauart, wie beim Fenster
 * der Storenkachel (CoverVisual): der liegende Pelletgrill mit Trichter
 * und Kamin, der stehende Räucherschrank mit Glastüre. Die Zeichnung
 * zeigt, was das Foto nicht kann: Läuft der Grill, glüht der Feuerraum.
 */
import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

import { Grillbauart, bildName } from '../lib/grillbild';
import { useColors } from '../theme';

/** Die Fotos, die mitgeliefert werden (Punkt 564) - der Schlüssel kommt
 *  aus lib/grillbild.ts (grillFoto). `require` braucht feste Pfade,
 *  deshalb steht die Zuordnung hier und nicht in der reinen Funktion. */
const FOTOS: Record<string, number> = {
  // require, kein import - wie bei den Schriften in App.tsx: Nur so
  // nimmt Metro die Datei mit ins Bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pb1150ps2: require('../../assets/grills/pb1150ps2.png'),
};

interface Props {
  bauart: Grillbauart;
  /** Das Foto, wenn es eines gibt (grillFoto) - dann statt der Zeichnung. */
  foto?: string | null;
  /** Läuft er? Dann glüht der Feuerraum. */
  laeuft: boolean;
  width?: number;
  height?: number;
}

export function GrillVisual({ bauart, foto, laeuft, width = 96, height = 72 }: Props) {
  const colors = useColors();
  const blech = colors.ink;
  const glut = laeuft ? colors.warn : colors.track;
  const glas = laeuft ? 'rgba(245, 165, 36, 0.35)' : colors.track;
  const bild = foto ? FOTOS[foto] : undefined;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        bild ? bildName(bauart).replace('Bild: ', 'Foto: ') : bildName(bauart)
      }
      style={{ width, height }}
    >
      {bild ? (
        // Das echte Foto, freigestellt - so gewünscht im Haus. Es kann
        // nicht glühen; dafür sagt die Pille daneben, dass er läuft.
        <Image
          source={bild}
          resizeMode="contain"
          style={{ width, height }}
          accessibilityIgnoresInvertColors
        />
      ) : bauart === 'schrank' ? (
        <Svg width={width} height={height} viewBox="0 0 96 72">
          {/* Der Schrank: hoch, mit Glastüre und dem Trichter seitlich. */}
          <Rect x={28} y={6} width={40} height={56} rx={4} fill="none" stroke={blech} strokeWidth={3} />
          <Rect x={34} y={14} width={28} height={30} rx={2} fill={glas} stroke={blech} strokeWidth={2} />
          {/* Roste hinter dem Glas. */}
          <Line x1={36} y1={24} x2={60} y2={24} stroke={blech} strokeWidth={1.5} opacity={0.5} />
          <Line x1={36} y1={34} x2={60} y2={34} stroke={blech} strokeWidth={1.5} opacity={0.5} />
          {/* Der Griff. */}
          <Line x1={57} y1={48} x2={57} y2={56} stroke={blech} strokeWidth={3} strokeLinecap="round" />
          {/* Trichter für die Pellets. */}
          <Path d="M68 18 h16 v10 l-6 8 h-10 z" fill="none" stroke={blech} strokeWidth={2.5} strokeLinejoin="round" />
          {/* Kamin und Füsse. */}
          <Rect x={40} y={0} width={6} height={8} fill={blech} />
          <Line x1={32} y1={62} x2={32} y2={70} stroke={blech} strokeWidth={3} />
          <Line x1={64} y1={62} x2={64} y2={70} stroke={blech} strokeWidth={3} />
          {/* Die Glut. */}
          <Circle cx={48} cy={40} r={3} fill={glut} />
        </Svg>
      ) : (
        <Svg width={width} height={height} viewBox="0 0 96 72">
          {/* Das Fass: Deckel und Wanne, auf Beinen, mit Trichter rechts. */}
          <Path d="M10 36 a30 22 0 0 1 60 0 z" fill="none" stroke={blech} strokeWidth={3} strokeLinejoin="round" />
          <Path d="M10 36 h60 v10 a8 8 0 0 1 -8 8 h-44 a8 8 0 0 1 -8 -8 z" fill="none" stroke={blech} strokeWidth={3} strokeLinejoin="round" />
          {/* Griff auf dem Deckel. */}
          <Line x1={28} y1={22} x2={52} y2={22} stroke={blech} strokeWidth={3} strokeLinecap="round" />
          {/* Kamin links, Trichter rechts. */}
          <Rect x={14} y={8} width={6} height={12} fill={blech} />
          <Path d="M72 26 h16 v10 l-5 8 h-11 z" fill="none" stroke={blech} strokeWidth={2.5} strokeLinejoin="round" />
          {/* Beine und Räder. */}
          <Line x1={22} y1={54} x2={18} y2={68} stroke={blech} strokeWidth={3} strokeLinecap="round" />
          <Line x1={58} y1={54} x2={62} y2={68} stroke={blech} strokeWidth={3} strokeLinecap="round" />
          <Circle cx={17} cy={68} r={3} fill="none" stroke={blech} strokeWidth={2} />
          <Circle cx={63} cy={68} r={3} fill="none" stroke={blech} strokeWidth={2} />
          {/* Die Glut - ein Streifen im Spalt zwischen Deckel und Wanne. */}
          <Ellipse cx={40} cy={36} rx={26} ry={2.5} fill={glut} />
        </Svg>
      )}
    </View>
  );
}
