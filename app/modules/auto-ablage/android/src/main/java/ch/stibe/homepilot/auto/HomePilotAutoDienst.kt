package ch.stibe.homepilot.auto

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * HomePilot auf dem Autobildschirm (Android Auto).
 *
 * Google lässt nur bestimmte Arten von Apps ins Auto; die passende
 * heisst «IoT» und ist genau für Haussteuerungen gedacht
 * (androidx.car.app.category.IOT). Erlaubt sind dort Vorlagen, keine
 * eigenen Oberflächen: Wir sagen, welche Kacheln es gibt, das Auto
 * zeichnet sie. Das ist keine Einschränkung, die man umgeht - es ist
 * der Grund, warum das Ganze während der Fahrt erlaubt ist.
 *
 * Gezeigt werden dieselben Knöpfe wie im Sperrbildschirm-Widget, aber
 * nur die, die selbst schalten (lib/auto.ts). Ein Knopf, der die App
 * öffnet, wäre hier eine Kachel, die nichts tut: Das Telefon bleibt
 * während der Fahrt dunkel.
 */
class HomePilotAutoDienst : CarAppService() {

  /** Nur die Hosts von Google und die eigenen Testwerkzeuge dürfen uns
   *  anzeigen - alles andere wäre eine fremde App, die unsere Knöpfe
   *  fernbedient. */
  override fun createHostValidator(): HostValidator =
    HostValidator.Builder(applicationContext)
      .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
      .build()

  override fun onCreateSession(): Session = object : Session() {
    override fun onCreateScreen(intent: Intent): Screen = KnopfWand(carContext)
  }
}

/** Ein Knopf, wie ihn die App hinterlegt hat. */
private data class Autoknopf(
  val key: String,
  val title: String,
  val symbol: String,
  val path: String,
  val body: String,
)

/**
 * Die Kachelwand: ein Tipp, ein Befehl an den Hub.
 *
 * Kein Zwischenschritt, keine Rückfrage - beides wäre im Auto ein
 * zweiter Blick auf den Bildschirm. Was gefährlich wäre (die Haustüre),
 * entscheidet man vorher in der App: Nur Knöpfe, die dort auf «direkt
 * schalten» stehen, kommen überhaupt hierher.
 */
private class KnopfWand(carContext: CarContext) : Screen(carContext) {

  private var meldung: String? = null

  override fun onGetTemplate(): Template {
    val knoepfe = lesen()
    if (knoepfe.isEmpty()) {
      // Eine leere Kachelwand wäre keine Auskunft. Der Satz sagt, wo es
      // fehlt - beantwortet wird die Frage aber in der App, nicht hier.
      return MessageTemplate.Builder(
        "Keine Knöpfe hinterlegt. In der App unter Widget die Knöpfe " +
          "zusammenstellen und «direkt schalten» einschalten."
      )
        .setTitle("HomePilot")
        .setHeaderAction(Action.APP_ICON)
        .build()
    }

    // Wie viele Kacheln dieses Auto zeigt, sagt das Auto - ein grosser
    // Bildschirm mehr als ein kleiner. Wer mehr schickt, bekommt eine
    // Ausnahme statt einer Kachel.
    val platz = carContext
      .getCarService(ConstraintManager::class.java)
      .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_GRID)

    val liste = ItemList.Builder()
    knoepfe.take(platz).forEach { knopf ->
      liste.addItem(
        GridItem.Builder()
          .setTitle(knopf.title)
          .setImage(CarIcon.Builder(IconCompat.createWithResource(carContext, symbolBild(knopf.symbol))).build())
          .setOnClickListener { schalten(knopf) }
          .build()
      )
    }

    return GridTemplate.Builder()
      .setTitle(meldung ?: "HomePilot")
      .setHeaderAction(Action.APP_ICON)
      .setSingleList(liste.build())
      .build()
  }

  /** Was die App hinterlegt hat - bei jedem Zeichnen frisch, denn
   *  zwischen zwei Fahrten kann sich alles geändert haben. */
  private fun lesen(): List<Autoknopf> {
    val ablage = carContext.getSharedPreferences(AutoAblageModule.ABLAGE, Context.MODE_PRIVATE)
    val roh = ablage.getString("knoepfe", null) ?: return emptyList()
    return try {
      val json = JSONArray(roh)
      (0 until json.length()).map { i ->
        val eintrag = json.getJSONObject(i)
        Autoknopf(
          key = eintrag.optString("key"),
          title = eintrag.optString("title"),
          symbol = eintrag.optString("symbol"),
          path = eintrag.optString("path"),
          body = eintrag.optString("body", "{}"),
        )
      }
    } catch (fehler: Exception) {
      emptyList()
    }
  }

  /**
   * Den Befehl an den Hub schicken.
   *
   * In einem eigenen Faden: Auf dem Hauptfaden wäre es im besten Fall
   * ein Ruckler, im schlechteren eine abgestürzte App - und das im
   * Auto. Was dabei herauskommt, steht danach als Titel über den
   * Kacheln; ein Toast wäre im Auto nicht erlaubt.
   */
  private fun schalten(knopf: Autoknopf) {
    val ablage = carContext.getSharedPreferences(AutoAblageModule.ABLAGE, Context.MODE_PRIVATE)
    val adresse = ablage.getString("hubUrl", null)
    val token = ablage.getString("hubToken", null)
    if (adresse.isNullOrBlank() || token.isNullOrBlank()) {
      zeigen("Nicht mit dem Hub verbunden")
      return
    }
    zeigen("${knopf.title} …")
    thread {
      val text = try {
        val verbindung = URL("$adresse${knopf.path}").openConnection() as HttpURLConnection
        verbindung.requestMethod = "POST"
        verbindung.setRequestProperty("Authorization", "Bearer $token")
        verbindung.setRequestProperty("Content-Type", "application/json")
        verbindung.doOutput = true
        verbindung.connectTimeout = 5000
        verbindung.readTimeout = 5000
        OutputStreamWriter(verbindung.outputStream).use { it.write(knopf.body) }
        val status = verbindung.responseCode
        verbindung.disconnect()
        if (status in 200..299) "${knopf.title} ✓" else "${knopf.title}: Hub antwortet mit $status"
      } catch (fehler: Exception) {
        // Der häufigste Fall im Auto: Man ist nicht im WLAN daheim.
        "${knopf.title}: kein Hub erreichbar"
      }
      // Über den Haupt-Looper und nicht über `mainExecutor`: Den gibt
      // es erst ab Android 9, und `invalidate()` will ohnehin den
      // Hauptfaden sehen.
      Handler(Looper.getMainLooper()).post { zeigen(text) }
    }
  }

  private fun zeigen(text: String) {
    meldung = text
    invalidate()
  }

  /** Symbolname aus der Ablage → Vektor im Auto. Unbekanntes bekommt
   *  den Punkt: Eine Kachel ohne Bild zeichnet Android gar nicht. */
  private fun symbolBild(symbol: String): Int = when (symbol) {
    "tuer" -> R.drawable.auto_tuer
    "aus" -> R.drawable.auto_aus
    "alarm" -> R.drawable.auto_alarm
    "licht" -> R.drawable.auto_licht
    "szene" -> R.drawable.auto_szene
    "store" -> R.drawable.auto_store
    "musik" -> R.drawable.auto_musik
    else -> R.drawable.auto_punkt
  }
}
