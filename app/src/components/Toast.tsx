import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { anzeigedauer, istLang } from '../lib/meldung';
import { Colors, radius, useColors } from '../theme';

/**
 * Kurze Einblendung für fehlgeschlagene Befehle.
 *
 * Verschwindet von selbst, lässt sich aber wegtippen – eine Fehlermeldung,
 * die man wegklicken muss, unterbricht beim Bedienen mehr als sie hilft.
 *
 * Bei den Meldungen, die wirklich weiterhelfen, war beides zu wenig: Der
 * Hub erklärt einen Funk-Timeout der CCU in vier Zeilen, und was zu
 * prüfen ist, steht am Ende. Drei Zeilen und fünf Sekunden schnitten
 * genau das ab - aus dem Haus kam ein Bild davon: «… Prüfen: St…».
 *
 * Jetzt wächst die Zeit mit dem Text (lib/meldung.ts), und eine lange
 * Meldung klappt beim ersten Tipp auf, statt zu verschwinden: Wer
 * hinschaut, will lesen, nicht wegräumen. Der zweite Tipp räumt weg.
 */
export function Toast({
  message,
  onDismiss,
  bottomInset = 0,
}: {
  message: string | null;
  onDismiss: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(false);
  const lang = istLang(message);

  // Eine neue Meldung fängt zugeklappt an - sonst stünde die nächste
  // kurze Absage in der Höhe der langen von vorhin.
  useEffect(() => setOffen(false), [message]);

  useEffect(() => {
    if (!message) return;
    // Aufgeklappt läuft keine Uhr: Wer aufgeklappt hat, liest gerade.
    if (offen) return;
    const timer = setTimeout(onDismiss, anzeigedauer(message));
    return () => clearTimeout(timer);
  }, [message, offen, onDismiss]);

  if (!message) return null;

  return (
    <Pressable
      onPress={() => (lang && !offen ? setOffen(true) : onDismiss())}
      accessibilityRole="alert"
      accessibilityLabel={
        lang && !offen ? `${message}. Antippen zum Aufklappen` : message
      }
      style={[styles.wrapper, { bottom: bottomInset + 20 }]}
    >
      <View style={styles.toast}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.text} numberOfLines={offen ? undefined : 3}>
            {message}
          </Text>
          {lang && !offen ? (
            <Text style={styles.mehr}>Antippen für den ganzen Text</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Die kurze Bestätigung, dass etwas geklappt hat.
 *
 * Bisher schloss sich das Fenster nach dem Speichern eines Ablaufs
 * einfach – und man wusste nur, dass es weg ist, nicht ob es angekommen
 * ist. Bei einem Ablauf, der erst in einer Woche das erste Mal feuert,
 * merkt man den Unterschied sonst nie.
 *
 * Der Text sagt, *was* passiert ist («Ablauf gespeichert», «Szene
 * gelöscht»), nicht bloss «Erledigt». Drei Sekunden reichen – wer sie
 * verpasst, hat die Liste dahinter ohnehin schon aktualisiert vor sich.
 */
export function Bestaetigung({
  text,
  onDismiss,
  bottomInset = 0,
}: {
  text: string | null;
  onDismiss: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [text, onDismiss]);

  if (!text) return null;

  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.wrapper, { bottom: bottomInset + 20 }]}
    >
      <View style={styles.toast}>
        <Ionicons name="checkmark-circle-outline" size={20} color={colors.on} />
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Das Angebot, die letzte Schaltung zurückzunehmen.
 *
 * Steht nur ein paar Sekunden: Ein «Rückgängig», das dauerhaft liegen
 * bleibt, nimmt später etwas zurück, an das sich niemand mehr erinnert.
 * Der Text sagt deshalb auch, *was* zurückgenommen würde.
 */
export function UndoToast({
  what,
  onUndo,
  onDismiss,
  bottomInset = 0,
}: {
  what: { name: string; label: string } | null;
  onUndo: () => void;
  onDismiss: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Die Beschreibung oben sagte «nur ein paar Sekunden», die Umsetzung
  // liess das Angebot stehen, bis etwas Neues kam. Bei einer Schaltung
  // fiel das nicht auf – da folgt schnell die nächste. Beim Abhaken im
  // Laden schon: Dort bliebe «Rückgängig» zwischen zwei Regalen liegen.
  useEffect(() => {
    if (!what) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [what, onDismiss]);

  if (!what) return null;

  return (
    <View style={[styles.wrapper, { bottom: bottomInset + 20 }]} pointerEvents="box-none">
      <View style={styles.toast}>
        <Ionicons name="checkmark-circle-outline" size={20} color={colors.on} />
        <Text style={styles.text} numberOfLines={2}>
          {what.name} {what.label}
        </Text>
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel={`${what.name} zurückschalten`}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionText}>Rückgängig</Text>
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityLabel="Ausblenden" hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.inkFaint} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#2A3444',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  text: {
    color: colors.ink,
    fontSize: 14,
    flexShrink: 1,
  },
  /** Der Hinweis, dass da noch mehr steht. Leise: Er ist die Ausnahme -
   *  die meisten Meldungen sind ein Satz. */
  mehr: { color: colors.inkFaint, fontSize: 12, marginTop: 3 },
  action: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  actionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
});
