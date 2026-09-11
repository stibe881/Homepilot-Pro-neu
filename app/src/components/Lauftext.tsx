import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';

import { HALT_ENDE, HALT_START, laufPlan } from '../lib/lauftext';

/**
 * Eine Zeile, die durchwandert, wenn sie nicht ganz hineinpasst.
 *
 * Warum überhaupt (und warum nicht umbrechen), steht in lib/lauftext.ts.
 * Hier stehen die zwei Kunstgriffe, die man dem Ergebnis nicht ansieht:
 *
 * **Zwei Ausfertigungen desselben Textes.** Der Platzhalter ist die
 * gewöhnliche Zeile mit `numberOfLines={1}`; er bestimmt, wie breit und
 * wie hoch die Zeile ist, und er ist es auch, den die Vorlesefunktion
 * liest – ganz, nicht bis zu den Pünktchen. Darüber liegt die wandernde
 * Ausfertigung; sie liegt absolut und rührt am Aufbau der Seite nichts
 * an. Wäre es nur eine, müsste man zwischen «misst sich selbst» und
 * «passt sich ein» wählen: Ein Text mit `numberOfLines={1}` in einem
 * schmalen Kasten meldet die Breite des Kastens und nicht seine eigene –
 * gemessen würde also genau das, was man wissen will, nicht.
 *
 * **Der Kasten von 4000 Punkten** um die wandernde Ausfertigung ist
 * derselbe Grund von der anderen Seite: Erst wo Platz im Überfluss ist,
 * misst sich der Text so breit, wie er wirklich wäre. Geschnitten wird
 * er dann vom Fenster darum (`overflow: hidden`). Sobald gemessen ist,
 * schrumpft der Kasten auf die gemessene Breite – ein 4000 Punkte
 * breiter Kasten, der dauerhaft in der Seite steht, taucht sonst in
 * jeder Überlauf-Suche als Verdächtiger auf, ohne je einer zu sein
 * (scripts/probe.mjs). Ändert sich der Text, wird zuerst wieder
 * gemessen; sonst würde der neue am alten Kasten abgeschnitten und
 * bekäme dessen Breite.
 *
 * Das Sinnbild bleibt stehen, wo es ist. Es ist die Beschriftung der
 * Zeile – Kalender, Geschenk, Warndreieck –, und eine Zeile, die
 * mittendrin nicht mehr sagt, wovon sie handelt, wäre schlechter zu
 * lesen als eine abgeschnittene.
 */

/** Breiter als jede Zeile je wird – siehe oben. */
const MESSBREITE = 4000;

export function Lauftext({
  children,
  style,
  icon,
  iconFarbe,
  iconGroesse = 12,
}: {
  /** Nur Text: Er ist zugleich das Merkmal, an dem eine Änderung
   *  auffällt (siehe unten, Neu-Messen). */
  children: string;
  style?: StyleProp<TextStyle>;
  icon?: keyof typeof Ionicons.glyphMap;
  iconFarbe?: string;
  iconGroesse?: number;
}) {
  const [kasten, setKasten] = useState(0);
  const [inhalt, setInhalt] = useState(0);
  const [ruhig, setRuhig] = useState(false);
  const versatz = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setRuhig)
      // Nicht abfragbar heisst: normal animieren.
      .catch(() => {});
  }, []);

  // Neuer Text, neue Messung: Sonst schnitte ihn der Kasten der alten
  // Messung ab, und er meldete deren Breite als seine eigene.
  useEffect(() => setInhalt(0), [children]);

  const plan = useMemo(() => laufPlan(inhalt, kasten), [inhalt, kasten]);
  // Wer «Bewegung reduzieren» eingeschaltet hat, bekommt die Zeile wie
  // bisher: abgeschnitten mit Pünktchen. Das ist kein guter Zustand,
  // aber ein ehrlicher - und die Einstellung heisst nicht umsonst so.
  const laeuft = plan.noetig && !ruhig;

  useEffect(() => {
    versatz.setValue(0);
    if (!laeuft) return;
    const runde = Animated.loop(
      Animated.sequence([
        Animated.delay(HALT_START),
        Animated.timing(versatz, {
          toValue: -plan.weite,
          duration: plan.wanderMs,
          // Gleichmässig: Ein weiches Anfahren und Abbremsen liest sich
          // wie ein Effekt. Hier soll man lesen, nicht zusehen.
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(HALT_ENDE),
        // Zurück auf Anfang, ohne Rückfahrt: Ein Text, der nach rechts
        // zieht, liest sich rückwärts.
        Animated.timing(versatz, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    runde.start();
    return () => {
      runde.stop();
      versatz.setValue(0);
    };
  }, [laeuft, plan.weite, plan.wanderMs, versatz]);

  // Messung und Anzeige sind getrennt (Punkt 530, Werkbank 353): Der
  // Messkasten bleibt immer 4000 Punkte breit und unsichtbar, damit der
  // Text darin seine eigene Breite meldet - bei jedem Layout-Durchgang,
  // nicht nur beim ersten. Vorher schrumpfte derselbe Kasten nach der
  // Messung auf die gemessene Breite; ein weiterer Aufbau liess
  // `onLayout` erneut feuern, der Text mass sich dann am geschrumpften
  // Kasten, aus «muss wandern» wurde «passt», und die Zeile blieb mit
  // Pünktchen stehen. Der animierte Kasten daneben misst gar nichts.
  const zeile = (
    <View
      style={styles.fenster}
      onLayout={(ereignis) => setKasten(ereignis.nativeEvent.layout.width)}
    >
      <Text style={[style, laeuft && styles.weg]} numberOfLines={1}>
        {children}
      </Text>
      <View
        style={styles.messkasten}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={[style, styles.eigenbreit]}
          numberOfLines={1}
          onLayout={(ereignis) => setInhalt(ereignis.nativeEvent.layout.width)}
        >
          {children}
        </Text>
      </View>
      {laeuft ? (
        <View
          style={styles.ueber}
          pointerEvents="none"
          // Zweimal derselbe Satz wäre für die Vorlesefunktion zweimal
          // dasselbe zu hören; gelesen wird der Platzhalter, der ihn ganz
          // enthält.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View style={[{ width: inhalt }, { transform: [{ translateX: versatz }] }]}>
            <Text style={[style, styles.eigenbreit]} numberOfLines={1}>
              {children}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );

  if (!icon) return zeile;
  return (
    <View style={styles.reihe}>
      <Ionicons name={icon} size={iconGroesse} color={iconFarbe} />
      {zeile}
    </View>
  );
}

const styles = StyleSheet.create({
  reihe: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  fenster: { overflow: 'hidden', flexShrink: 1 },
  ueber: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  // Der Messkasten: fest 4000 breit, nie sichtbar, nie animiert. Im
  // Fenster (overflow hidden) abgeschnitten, damit er die Seite nicht
  // seitlich aufzieht - die Browser-Probe misst genau das.
  messkasten: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: MESSBREITE,
    opacity: 0,
    flexDirection: 'row',
  },
  // Nicht `display: none`: Was nicht gezeichnet wird, misst sich auch
  // nicht - und dann wüsste niemand mehr, ob gewandert werden muss.
  weg: { opacity: 0 },
  eigenbreit: { alignSelf: 'flex-start' },
});
