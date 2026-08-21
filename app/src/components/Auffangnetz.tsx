/**
 * Fängt einen Fehler ab, statt den Bildschirm weiss zu lassen.
 *
 * Der Fall, um den es geht: Eine Kachel bekommt vom Hub einen Wert, mit
 * dem sie nicht rechnet – ein `null`, wo eine Zahl erwartet wird –, wirft
 * beim Zeichnen, und React räumt daraufhin den ganzen Baum ab. Auf dem
 * Telefon startet man die App neu und ärgert sich. Auf dem Wandpanel
 * bleibt die Wand weiss, bis jemand hingeht.
 *
 * Deshalb liegt das Netz nicht nur ganz aussen, sondern um jeden Bereich
 * einzeln: Reisst die Kameraansicht, sollen Licht und Storen weiter
 * bedienbar bleiben. Ein Haus, das zu drei Vierteln funktioniert, ist
 * deutlich mehr wert als eines, das gar nicht mehr reagiert.
 *
 * Eine Klassenkomponente, weil `componentDidCatch` in React nur so zu
 * haben ist – die einzige Stelle in dieser App.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Was hier drin steckt – steht in der Meldung: «Kameras liessen sich
   *  nicht anzeigen». Ohne Namen weiss niemand, was fehlt. */
  bereich?: string;
  /** Statt der Standardmeldung etwas Eigenes zeigen. */
  fallback?: React.ReactNode;
}

interface State {
  fehler: Error | null;
}

export class Auffangnetz extends React.Component<Props, State> {
  state: State = { fehler: null };

  static getDerivedStateFromError(fehler: Error): State {
    return { fehler };
  }

  componentDidCatch(fehler: Error, info: React.ErrorInfo) {
    // In die Konsole, nicht zum Hub: Ein Zeichenfehler in der App ist
    // nichts, was der Hub beheben könnte, und ein Fehlerbericht, der bei
    // jedem Bildaufbau erneut abgeht, wäre schlimmer als der Fehler.
    console.error(`Fehler in «${this.props.bereich ?? 'der Ansicht'}»:`, fehler, info);
  }

  private nochmal = () => this.setState({ fehler: null });

  render() {
    if (!this.state.fehler) return this.props.children;
    if (this.props.fallback) return <>{this.props.fallback}</>;

    return (
      <View style={styles.kasten}>
        <Ionicons name="warning-outline" size={20} color="#F5A524" />
        <View style={{ flex: 1 }}>
          <Text style={styles.titel}>
            {this.props.bereich
              ? `«${this.props.bereich}» lässt sich gerade nicht anzeigen`
              : 'Dieser Teil lässt sich gerade nicht anzeigen'}
          </Text>
          <Text style={styles.text} numberOfLines={3}>
            {this.state.fehler.message || 'Unbekannter Fehler beim Zeichnen.'}
          </Text>
        </View>
        <Pressable
          onPress={this.nochmal}
          accessibilityRole="button"
          accessibilityLabel="Noch einmal versuchen"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.knopfText}>Nochmal</Text>
        </Pressable>
      </View>
    );
  }
}

// Bewusst feste Farben statt der Themenwerte: Diese Komponente läuft
// gerade dann, wenn etwas kaputt ist – dann soll sie nicht selbst noch
// von einem Kontext abhängen, der vielleicht der Grund war.
const styles = StyleSheet.create({
  kasten: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    margin: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,165,36,0.45)',
    backgroundColor: 'rgba(245,165,36,0.10)',
  },
  titel: { color: '#E9EDF4', fontSize: 14, fontWeight: '600' },
  text: { color: '#97A2B6', fontSize: 12, marginTop: 2 },
  knopf: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  knopfText: { color: '#E9EDF4', fontSize: 13, fontWeight: '600' },
});
