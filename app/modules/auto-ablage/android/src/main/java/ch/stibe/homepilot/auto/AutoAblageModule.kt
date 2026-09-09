package ch.stibe.homepilot.auto

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Der Topf, aus dem der Autobildschirm liest.
 *
 * Der Dienst fürs Auto (HomePilotAutoDienst) startet, wenn jemand das
 * Telefon einsteckt - oft ohne dass die App je offen war. Er kann
 * deshalb nichts erfragen: Adresse, Token und Knöpfe müssen schon
 * dastehen. Die App schreibt sie hier hinein (lib/autoablage.ts), der
 * Dienst liest sie im selben Prozess wieder heraus.
 *
 * SharedPreferences und keine Datenbank: Es sind drei Zeichenketten,
 * und sie müssen einen Kaltstart überleben - mehr nicht.
 */
class AutoAblageModule : Module() {
  private val ablage
    get() = appContext.reactContext!!.getSharedPreferences(ABLAGE, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("AutoAblage")

    Function("setzen") { schluessel: String, wert: String ->
      ablage.edit().putString(schluessel, wert).apply()
    }

    Function("lesen") { schluessel: String ->
      ablage.getString(schluessel, null)
    }

    Function("entfernen") { schluessel: String ->
      ablage.edit().remove(schluessel).apply()
    }
  }

  companion object {
    /** Derselbe Name steht in lib/autoablage.ts. Wer ihn hier ändert,
     *  muss ihn dort ändern - sonst schreiben zwei Seiten aneinander
     *  vorbei, und das Auto bleibt leer, ohne dass jemand einen Fehler
     *  sieht. */
    const val ABLAGE = "homepilot_auto"
  }
}
