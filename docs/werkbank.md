# Die Werkbank

Die durchnummerierte Liste der Verbesserungen – aus dem Code gelesen,
Punkt für Punkt abgearbeitet. Kommentare im Code verweisen mit
«Punkt NNN der Werkbank» auf genau diese Nummern; deshalb wird hier
**nie umnummeriert**, auch nicht bei erledigten oder gestrichenen
Punkten. Neue Punkte bekommen die nächste freie Nummer.

Bisher lag die Liste nur als Werkbank-Seiten ausserhalb des Repos –
wer im Code auf «Punkt 155» stiess, konnte nicht nachschlagen. Jetzt
steht sie hier, in vier Teilen entstanden:

| Punkte | Entstanden als | Blick |
| --- | --- | --- |
| 1–100 | Werkbank (erste Durchsicht des ganzen Repos) | Technik, Betrieb, Auslieferung |
| 101–135 | Durchsicht (Abläufe, Szenen, Räume, Widgets, Rezepte) | Funktionslücken |
| 136–164 | Küche & Abläufe | Rezeptbuch und Ablauf-Editor |
| 165–221 | Familie & Haushalt | Familienlisten, Kontakte, Ortung |

Stand beim Einchecken: **alle 221 Punkte erledigt**, bis auf Punkt 94
(bewusst gestrichen). Die Häkchen tragen die Commit-Kürzel von den
Werkbank-Seiten; ganz alte können hinter der flachen Klon-Grenze
liegen. Die Begründungen («warum») bleiben absichtlich stehen – sie
beschreiben den Fehlerfall, gegen den der Code heute geschützt ist,
und sind damit die Vorgeschichte zu den «warum»-Kommentaren im Code.

# Teil I: Werkbank (1–100)

## Damit sich der heutige Abend nicht wiederholt (1–3)

### 1. Eine CLAUDE.md, die die Spielregeln festhält ✓ erledigt (6d3e4fb)

*tut weh · Aufwand: klein · Repo*

Heute haben zwei Sitzungen unabhängig dieselben drei Dinge gebaut — Nachlauf, Fernseher-Filter, Bewegungslicht-Vorlage — und das Zusammenführen kostete mehr als jede einzelne Änderung. Eine Datei im Wurzelverzeichnis mit Branch-Regel, Testbefehlen und Sprachkonventionen hätte das verhindert. Es gibt sie nicht.

Stellen: `CLAUDE.md`, `fehlt`

### 2. Der Deploy-Branch ist im Skript festgenagelt ✓ erledigt (6d3e4fb)

*tut weh · Aufwand: klein · Auslieferung*

Der Update-Knopf holt einen Branchnamen, der im Skript steht. Läuft die Arbeit anderswo, baut er beharrlich den falschen Stand — und von aussen sieht das aus, als käme die Änderung nicht an. Genau das ist heute vier Commits lang passiert. Besser auf einen festen Zweig zeigen und Ausnahmen über `HOMEPILOT_BRANCH` setzen.

Stellen: `deploy/rebuild-hub.sh:65`

### 3. Kein Bauknecht, der bei jedem Push nachschaut ✓ erledigt (6d3e4fb)

*tut weh · Aufwand: mittel · Repo*

Es gibt kein `.github/workflows`. `pytest`, `tsc --noEmit` und ein `expo export` bei jedem Push würden Fehler finden, solange sie noch billig sind. Heute merkt man einen erst, wenn abends das Licht nicht angeht.

Stellen: `.github/workflows/`, `fehlt`


## Was behauptet wird, aber niemand prüft (4–7)

### 4. 47 Funktionen versprechen „rein, testbar" — keine wird getestet ✓ erledigt (9fa310c)

*tut weh · Aufwand: mittel · App*

Quer durch die App tragen exportierte Funktionen diesen Kommentar: die Gang-Sortierung, die Vorschlagsliste, die Player-Auswahl, die Batterie-Übersicht. Sie sind eigens dafür herausgelöst worden. Nur gibt es in `app/` gar keinen Test-Runner, also läuft keine einzige. Das ist die grösste Lücke im ganzen Vorhaben — und die am billigsten zu schliessende, weil die Arbeit schon getan ist.

Stellen: `app/package.json`, `kein jest/vitest`, `47× „rein, testbar"`

### 5. `presence_sim` ist die einzige Integration ohne Test ✓ erledigt (5444ed1)

*Feinschliff · Aufwand: klein · Hub*

30 von 31 Integrationen werden in `hub/tests/` erwähnt. Diese eine nicht — und sie tut ausgerechnet so, als wäre jemand zuhause. Ein Fehler darin fällt niemandem auf, weil das ihr Zweck ist.

Stellen: `hub/homepilot/integrations/presence_sim.py`

### 6. Die Sicherung wird geschrieben, aber nie zurückgeholt ✓ erledigt (5999ab3)

*lohnt sich · Aufwand: klein · Betrieb*

Die Tagessicherung wandert zu Supabase. Ob sich daraus wirklich ein Haushalt wiederherstellen lässt — Benutzer, Abläufe, Szenen, Zähler —, hat noch nie jemand ausprobiert. Eine Sicherung, die nie zurückgespielt wurde, ist eine Vermutung. Einmal im Jahr auf einem leeren Hub durchspielen.

Stellen: `hub/homepilot/core/offsite.py`

### 7. Kein `HEALTHCHECK` im Abbild ✓ erledigt (6d3e4fb)

*lohnt sich · Aufwand: klein · Betrieb*

Docker weiss nicht, ob der Hub noch antwortet — nur, ob der Prozess noch läuft. Ein hängender Hub sieht für den Neustart-Mechanismus gesund aus. Drei Zeilen im Dockerfile gegen `/api/system`.

Stellen: `hub/Dockerfile`


## Das iPad (8–11)

### 8. Der rechte Rand schneidet ab ✓ erledigt (bc4b476)

*tut weh · Aufwand: mittel · App*

Auf deinem Screenshot laufen die Szenen-Zeile, „Alarmanlage" und „Geschirrspüler" aus dem Bild. Kein Sprungmarken-Effekt, sondern echtes Überlaufen: Der Inhalt ist breiter als das Fenster. Untersucht ist es noch nicht — ich habe auf deinen Wunsch die Finger davon gelassen.

Stellen: `DashboardScreen.tsx`, `styles.frame / .split / .main`

### 9. Die Sprungmarken kennen kein iPad ✓ erledigt (bc4b476)

*lohnt sich · Aufwand: klein · App*

760 und 1000 Punkte. Ein iPad im Hochformat misst 768–834 und bekommt damit die Navigationsleiste, aber nie die rechte Spalte; ein iPad mini mit 744 bekommt beides nicht und sieht aus wie ein grosses Telefon. Die Zahlen stammen aus der Browser-Welt, nicht aus deiner Wohnung.

Stellen: `app/src/theme.tsx:98`

### 10. Geteilte Ansicht ist nie geprüft worden ✓ erledigt (bc4b476)

*Feinschliff · Aufwand: klein · App*

Ein iPad in Split View oder Slide Over ist 320–500 Punkte breit. Dort greift die Handy-Darstellung — was richtig ist, aber niemand hat je nachgesehen, ob sie dort auch wirklich hält.

Stellen: `manuelle Prüfung`

### 11. Kein `KeyboardAvoidingView` in der ganzen App ✓ erledigt (2cddf53)

*lohnt sich · Aufwand: klein · App*

Kein einziges Vorkommen. Auf dem Telefon schiebt sich die Tastatur über Eingabefelder in Fenstern — auch über das Feld der Einkaufsliste, das ich gerade eingebaut habe. Auf dem iPad fällt es kaum auf, auf dem iPhone sofort.

Stellen: `app/src/**`, `0 Treffer`


## Auslieferung (12–15)

### 12. Die App-Version steht seit jeher auf 0.1.0 ✓ erledigt (5999ab3)

*tut weh · Aufwand: klein · Auslieferung*

Weil `runtimeVersion` an der Version hängt, passt formal jede je veröffentlichte Fassung auf jeden neuen Build. Eine alte nachgeladene Version kann damit einen frischen TestFlight-Build überschreiben — und das sieht aus, als wäre der Bau schuld. Die Version bei jeder Auslieferung hochzählen.

Stellen: `app/app.json`, `version · runtimeVersion.policy`

### 13. Den OTA-Kanal einmal ausmisten ✓ erledigt (5999ab3)

*lohnt sich · Aufwand: klein · Auslieferung*

Was auf `production` älter ist als der laufende Build, kann nur noch Schaden anrichten. `eas update:list --branch production` zeigt, was dort liegt. Die neue Zeile unter System sagt dir, ob deine App gerade eine solche Fassung ausführt.

Stellen: `eas update:list`

### 14. 731 Zeilen Shell tragen die ganze Auslieferung ✓ erledigt (5999ab3)

*lohnt sich · Aufwand: gross · Auslieferung*

Docker-Bau, Web-Fassung, EAS, Portainer, Selbst-Auffrischung des eigenen Skripts — alles in einer Datei, die niemand testen kann und bei der ein Tippfehler die Auslieferung stilllegt. In Schritte zerlegen, die sich einzeln aufrufen und einzeln prüfen lassen.

Stellen: `deploy/rebuild-hub.sh`, `731 Zeilen`

### 15. Zwei Compose-Dateien, die zueinander passen müssen ✓ erledigt (5999ab3)

*Feinschliff · Aufwand: klein · Betrieb*

176 und 206 Zeilen, dieselben Dienste, dieselben Variablen. Wer eine ändert und die andere vergisst, merkt es erst bei der nächsten Einrichtung. Ein gemeinsamer Kern plus eine kleine Portainer-Ergänzung wäre eine Datei weniger zum Vergessen.

Stellen: `docker-compose.yml`, `docker-compose.portainer.yml`


## Der Hub innen (16–20)

### 16. `server.py` ist auf 3533 Zeilen gewachsen ✓ erledigt (08f74ad)

*lohnt sich · Aufwand: gross · Hub*

Geräte, Familie, Abläufe, Benutzer, System, Kameras, Energie — alles in einer Funktion `create_app`. Jede neue Route macht sie länger, und beim Zusammenführen von zwei Zweigen trifft man sich zwangsläufig darin. Ein `APIRouter` je Bereich wäre dieselbe Anwendung in acht lesbaren Dateien.

Stellen: `hub/homepilot/api/server.py`

### 17. 131 mal `except Exception` ✓ erledigt (9421c2d)

*lohnt sich · Aufwand: mittel · Hub*

Viele davon sind richtig — eine Integration darf den Hub nicht mitreissen. Andere verschlucken vermutlich echte Fehler, und niemand erfährt davon. Einmal durchgehen und dort, wo eine konkrete Ausnahme gemeint ist, sie auch hinschreiben.

Stellen: `hub/homepilot/**`, `131 Treffer`

### 18. Familienlisten über den WebSocket statt im Minutentakt ✓ erledigt (5b44cd9)

*lohnt sich · Aufwand: mittel · Hub + App*

Der WebSocket trägt nur Geräte-Ereignisse. Einkaufsliste, Aufgaben und Läden werden jede Minute neu abgefragt. Trägt Livia etwas ein, steht es bis zu sechzig Sekunden später bei dir — und dazwischen läuft die Abfrage auch dann, wenn sich nichts ändert.

Stellen: `api/server.py`, `DashboardScreen.tsx:257`

### 19. Jede Änderung schreibt die ganze Haushaltsdatei neu ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · Hub*

Ein einzelner Einkaufsartikel löst ein vollständiges `json.dump` samt `fsync` aus — sauber gegen Stromausfall, aber es wächst mit allem, was der Haushalt je gesammelt hat. Auf einem Raspberry Pi mit SD-Karte ist das irgendwann spürbar, und die Karte dankt es auch nicht.

Stellen: `hub/homepilot/core/persistence.py:116`

### 20. Ein Totmannschalter für den Hub selbst ✓ erledigt (5999ab3)

*lohnt sich · Aufwand: mittel · Betrieb*

Der Wächter überwacht die Integrationen — aber wenn der Hub steht, meldet das niemand, denn der Melder ist mit weg. Ein Dienst ausserhalb des Hauses, der ein regelmässiges Lebenszeichen erwartet und dich anschreibt, wenn es ausbleibt.

Stellen: `hub/homepilot/core/watchdog.py`


## Die App innen (21–24)

### 21. Zwei Bildschirme mit je über 3500 Zeilen ✓ erledigt (a74a798)

*lohnt sich · Aufwand: gross · App*

`AutomationsScreen` hat 3970, `FamilyScreen` 3513. In beiden stecken mehrere eigenständige Ansichten samt Editoren und Vorlagen. Beim Merge heute hat Git in genau dieser Datei stillschweigend jede `mode`-Zeile verdoppelt — in einer kleineren Datei wäre es aufgefallen.

Stellen: `AutomationsScreen.tsx`, `FamilyScreen.tsx`

### 22. 46 leere `catch`-Blöcke ✓ erledigt (0d9dbbe)

*tut weh · Aufwand: mittel · App*

Schlägt ein Aufruf fehl, passiert nichts — die App zeigt weiter den alten Stand, und man hält ihn für den aktuellen. Genau diese Sorte Fehler hat heute die Einkaufsliste leer aussehen lassen, obwohl der Server „Methode nicht erlaubt" sagte. Ein stiller Fehlschlag sieht aus wie ein leerer Einkaufszettel.

Stellen: `app/src/**`, `46 Treffer`

### 23. 90 handgebaute `fetch`-Aufrufe ✓ erledigt (0d9dbbe)

*lohnt sich · Aufwand: mittel · App*

Jeder setzt seinen Authorization-Header selbst zusammen, jeder behandelt Fehler anders, keiner hat ein Zeitlimit. Ein Client an einer Stelle — mit Zeitlimit, einheitlicher Fehlerbehandlung und einer Wiederholung — nimmt 89 Gelegenheiten weg, es unterschiedlich zu machen. Das ist auch die Voraussetzung für Nummer 22.

Stellen: `app/src/**`, `90× fetch(`${settings.url}…`)`

### 24. Zwölf Zeitgeber laufen neben dem WebSocket ✓ erledigt (0d9dbbe)

*Feinschliff · Aufwand: mittel · App*

Uhrzeit, Einkaufsliste, Türpässe, Alarm, Kacheln — jeder mit eigenem `setInterval`. Auf einem Wandpanel läuft das rund um die Uhr und hält den Bildschirm beschäftigt. Ein gemeinsamer Takt und Pausieren im Hintergrund wären genug.

Stellen: `12× setInterval`


## Bedienung im Alltag (25–30)

### 25. Über zwölf Komponenten ohne ein einziges Vorlesezeichen ✓ erledigt (75b997f)

*lohnt sich · Aufwand: mittel · App*

Kameraansicht, Türliste, Klimaübersicht, Storenbild und weitere haben kein `accessibilityLabel`. VoiceOver liest dort Symbolnamen vor. Für ein Wandpanel egal, für jemanden, der die App mit Sprachausgabe bedient, unbrauchbar.

Stellen: `components/CameraLive.tsx`, `OpenDoors`, `ClimateOverview`, `u. a.`

### 26. Schweizerdeutsch ist 36 mal fest verdrahtet ✓ erledigt (0d9dbbe)

*Feinschliff · Aufwand: gross · App*

`de-CH` steht als Zeichenkette im Code, alle Texte ebenso. Ein Gast, dessen Telefon auf Französisch steht, bekommt trotzdem Deutsch — und ein Datum im Schweizer Format. Lohnt sich erst, wenn wirklich jemand anderes die App benutzt; dann aber als Ganzes.

Stellen: `36× "de-CH"`

### 27. Einkaufsliste: Mengen und Wegnehmen fehlen ✓ erledigt (db6d53f)

*lohnt sich · Aufwand: klein · App*

Eintragen und abhaken geht seit heute. „2× Milch" muss man ausschreiben, und ein versehentlich Eingetragenes bekommt man im Fenster nicht mehr weg — dafür muss man weiterhin unter Familie. Ein Wisch nach links wäre die naheliegende Antwort.

Stellen: `components/TopStrip.tsx`

### 28. Rückgängig nach dem Abhaken ✓ erledigt (db6d53f)

*lohnt sich · Aufwand: klein · App*

Im Laden tippt man daneben, und der Posten ist weg. Rückgängig zu machen ist er nur unter Familie — also genau dann nicht, wenn man vor dem Regal steht. Eine kurze Meldung mit „doch nicht" nach dem Abhaken kostet wenig und rettet den Einkauf.

Stellen: `components/Toast.tsx`, `DashboardScreen.tsx`

### 29. Befehle puffern, solange der Hub weg ist ✓ erledigt (37f95dc)

*lohnt sich · Aufwand: mittel · App*

Die App zeigt bei Verbindungsverlust den letzten bekannten Stand — richtig so. Tippt man dann aber auf einen Schalter, läuft der Befehl ins Leere, und nichts sagt es. Eine kleine Warteschlange mit sichtbarem „wird gesendet, sobald wieder da" wäre ehrlicher als ein Knopf, der nichts tut.

Stellen: `hooks/useHub.ts`, `DashboardScreen.tsx`

### 30. Homematic: den Sendespeicher sichtbar machen ✓ erledigt (c1055c0)

*Feinschliff · Aufwand: klein · Hub*

Der Duty Cycle taucht heute nur in einer Fehlermeldung auf — also erst, wenn schon nichts mehr schaltet. Die CCU meldet ihn laufend; als Messwert neben den anderen sähe man das Volllaufen kommen, statt vor einer stummen Funkstrecke zu stehen.

Stellen: `integrations/homematic.py:262`


## Geheimnisse und Zugriff (31–35)

### 31. `homepilot-data.json` liegt im Repository ✓ erledigt (6d3e4fb)

*tut weh · Aufwand: klein · Sicherheit*

Und es ist genau der Pfad, den der Hub standardmässig beschreibt (`core/config.py:282`). Im Betrieb stehen dort `users` samt Tokens, `sessions`, `push_devices`, `audit` und `emails`. Im Repository ist die Datei heute leer — ein `git add -A` auf dem Hub-Rechner schiebt den echten Inhalt hinein. In die `.gitignore` damit, und die leere Fassung als `homepilot-data.example.json` danebenlegen.

Stellen: `hub/homepilot-data.json`, `ist eingecheckt`

### 32. Die Token-Dateien der Integrationen sind ebenfalls nicht ausgenommen ✓ erledigt (6d3e4fb)

*tut weh · Aufwand: klein · Sicherheit*

Ring, der Google-Kalender, Overkiz und Roborock legen ihre Anmeldung je als eigene Datei neben die Haushaltsdatei. Die `.gitignore` kennt nur `config.yaml`, `secrets.env` und `matter/` — die Token-Dateien nicht.

Stellen: `ring-token.json`, `google-token.json`, `.gitignore`

### 33. Zwei Regeln für dieselbe Art Geheimnis ✓ erledigt (9421c2d)

*lohnt sich · Aufwand: mittel · Sicherheit*

Sitzungsschlüssel werden gehasht abgelegt (`sessions.py:35`), Benutzer-Tokens im Klartext gehalten und verglichen (`users.py:253`). Der Vergleich ist immerhin zeitkonstant — aber wer die Datei liest, hat alle Tokens.

Stellen: `core/sessions.py:35`, `core/users.py:253`

### 34. CORS lässt Methoden und Kopfzeilen offen ✓ erledigt (6d3e4fb)

*lohnt sich · Aufwand: klein · Sicherheit*

Die erlaubte Herkunft steht in der Konfiguration, `allow_methods` und `allow_headers` stehen auf `*`. Solange der Hub nur im WLAN steht, ist das egal; sobald er von aussen erreichbar ist, ist es unnötig weit.

Stellen: `api/server.py:449`

### 35. Kein beschriebener Weg, ein Token zu wechseln ✓ erledigt (6d3e4fb)

*Feinschliff · Aufwand: klein · Sicherheit*

Geht ein Telefon verloren, will man dessen Zugang sperren, ohne die Familie auszusperren. Benutzer haben ein `expires`-Feld — wie man es benutzt, steht nirgends.

Stellen: `core/users.py:152`, `docs/`


## Werkzeuge, die fehlen (36–41)

### 36. Kein Linter im Hub ✓ erledigt (6d3e4fb)

*lohnt sich · Aufwand: klein · Repo*

`pyproject.toml` kennt nur pytest. Ruff findet unbenutzte Importe, tote Zweige und Stilbrüche in Sekunden — bei 20 000 Zeilen Python lohnt sich das ab dem ersten Lauf.

Stellen: `hub/pyproject.toml`

### 37. Keine Typprüfung im Hub ✓ erledigt (6d3e4fb)

*lohnt sich · Aufwand: mittel · Repo*

Kein mypy. Die Zustandswörterbücher der Entitäten sind `dict[str, Any]` — genau dort, wo ein Tippfehler im Schlüsselnamen still danebengreift, schaut niemand hin.

Stellen: `hub/pyproject.toml`

### 38. Kein ESLint in der App ✓ erledigt (6d3e4fb)

*lohnt sich · Aufwand: klein · Repo*

`tsc` prüft Typen, aber nicht fehlende Hook-Abhängigkeiten. In einer App mit dutzenden `useEffect` und `useCallback` ist genau das die häufigste Fehlerquelle — und `eslint-plugin-react-hooks` findet sie automatisch.

Stellen: `app/package.json`

### 39. Kein Prettier ✓ erledigt (6d3e4fb)

*Feinschliff · Aufwand: klein · Repo*

Die Formatierung ist heute erstaunlich einheitlich — weil eine Person sie hält. Sobald zwei Sitzungen parallel schreiben, wie heute Abend, wird daraus Diff-Rauschen.

Stellen: `app/package.json`

### 40. Niemand misst, was die Tests berühren ✓ erledigt (6d3e4fb)

*lohnt sich · Aufwand: klein · Repo*

619 Tests klingen nach viel. Welche Zeilen sie nie ausführen, weiss keiner — `pytest-cov` beantwortet das in einem Lauf und zeigt, wo die 619 in Wahrheit dünn sind.

Stellen: `hub/pyproject.toml`

### 41. 190 mal `: any` ✓ erledigt (296acdc)

*lohnt sich · Aufwand: gross · App*

Der Zustand jeder Entität ist `Record<string, any>`, und von dort breitet sich das aus. Typen je Geräteart — was hat ein Licht, was ein Melder — würden die Hälfte der Zugriffe prüfbar machen.

Stellen: `app/src/**`, `190 Treffer`


## Im Hub zu gross geworden (42–47)

### 42. `alarm.py`: 820 Zeilen, und die einzige sicherheitsrelevante ✓ erledigt (9421c2d)

*lohnt sich · Aufwand: gross · Hub*

Die zweitgrösste Integration nach Homematic — und die eine, bei der ein Fehler nicht bloss ärgert. Scharfschalten, Verzögerungen, Ausnahmen, Melder: das sind vier Themen in einer Datei.

Stellen: `integrations/alarm.py`

### 43. `tuya.py` ist mit 858 Zeilen frisch dazugekommen ✓ erledigt (9421c2d)

*lohnt sich · Aufwand: mittel · Hub*

Der grösste Neuzugang im Repository, und noch kaum eingelaufen. Jetzt hineinzuschauen kostet weniger als in einem halben Jahr, wenn drei Geräte daran hängen.

Stellen: `integrations/tuya.py`, `hub/tests/test_tuya.py`

### 44. Fünf Integrationen über 500 Zeilen machen dasselbe dreifach ✓ erledigt (9421c2d)

*lohnt sich · Aufwand: gross · Hub*

Roborock, Matter, Spotify, Ring und Google Cast bauen jede für sich Verbinden, Wiederverbinden, Zustand-Abbilden und Fehlerbehandlung. Ein gemeinsamer Unterbau nähme in allen fünf denselben Teil weg.

Stellen: `integrations/roborock.py`, `matter.py`, `spotify.py`, `ring.py`, `google_cast.py`

### 45. Der Wächter ist selbst das komplexeste Stück im Kern ✓ erledigt (9421c2d)

*Feinschliff · Aufwand: mittel · Hub*

640 Zeilen für die Überwachung. Fällt er aus, fällt die Ausfallmeldung mit aus — und niemand merkt es. Ein knapper Kern plus Regeln daneben wäre nachvollziehbarer.

Stellen: `core/watchdog.py`

### 46. Die Startreihenfolge steht nirgends ✓ erledigt (37f95dc)

*Feinschliff · Aufwand: klein · Hub*

`hub.py` lädt, verdrahtet und startet alles in einer bestimmten Reihenfolge — welche und warum, muss man aus 465 Zeilen erschliessen. Zwanzig Zeilen Kommentar oben sparen jedem Späteren eine Stunde.

Stellen: `core/hub.py`

### 47. Kein Zeitlimit für den Start einer Integration ✓ erledigt (2cddf53)

*lohnt sich · Aufwand: klein · Hub*

HTTP-Aufrufe haben eines (20 Sekunden, `integration.py:82`), `setup()` selbst nicht. Hängt eine Integration beim Verbinden, wartet der ganze Hub auf sie.

Stellen: `core/integration.py:82`


## Integrationen (48–57)

### 48. Acht verschiedene Abfrage-Intervalle, jedes einzeln im Code ✓ erledigt (37f95dc)

*Feinschliff · Aufwand: klein · Hub*

300, 300, 300, 30, 900, 60, 300, 60 Sekunden — je Integration hart hineingeschrieben. Eine gemeinsame Vorgabe und eine Stelle, an der man sie alle sieht, macht aus acht Entscheidungen eine.

Stellen: `integrations/*.py`, `scan_interval`

### 49. MQTT ohne erkennbare Verschlüsselung ✓ erledigt (c1055c0)

*lohnt sich · Aufwand: klein · Hub*

Benutzername und Passwort werden gesetzt, eine TLS-Option ist nicht zu sehen. Im eigenen WLAN vertretbar — aber dann sollte es dort auch so stehen.

Stellen: `integrations/mqtt.py:126`

### 50. Homematic: 1027 Zeilen, davon ein gutes Drittel Kanal-Logik ✓ erledigt (9421c2d)

*lohnt sich · Aufwand: mittel · Hub*

Schaltkanal finden, Messkanal zuordnen, Wartungskanal lesen, Kanalliste gruppieren — das ist ein eigenes Thema neben der XML-RPC-Anbindung und liesse sich als reines, testbares Modul herauslösen.

Stellen: `integrations/homematic.py`

### 51. Jede Integration entscheidet selbst, wann ein Gerät „weg" ist ✓ erledigt (37f95dc)

*Feinschliff · Aufwand: mittel · Hub*

`available` wird an dreissig Stellen unterschiedlich gesetzt. Was die App als „nicht erreichbar" zeigt, heisst je nach Gerät etwas anderes.

Stellen: `core/entity.py`, `integrations/*.py`

### 52. Vier eigene Token-Dateien für dieselbe Aufgabe ✓ erledigt (9421c2d)

*Feinschliff · Aufwand: mittel · Hub*

Ring, Google-Kalender, Overkiz und Roborock legen jede ihr eigenes Format neben die Haushaltsdatei. Ein gemeinsamer kleiner Tresor wäre eine Datei, ein Format und eine Stelle fürs Backup.

Stellen: `integrations/ring.py:18`, `google_calendar.py:295`, `overkiz.py:396`

### 53. Ist die Matter-Fabrik in der Sicherung? ✓ erledigt (5999ab3)

*lohnt sich · Aufwand: klein · Betrieb*

`hub/matter/` trägt Schlüssel und Zertifikate aller gekoppelten Geräte und steht zu Recht in der `.gitignore`. Geht sie verloren, muss jedes Matter-Gerät neu gekoppelt werden — nachsehen, ob die Off-Site-Sicherung sie mitnimmt.

Stellen: `.gitignore`, `core/offsite.py`

### 54. Eine Integration einzeln neu laden ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · Hub*

Nach einer Änderung an der `config.yaml` gibt es den Weg über die App — ob eine einzelne Integration ohne Neustart des ganzen Hubs neu anlaufen kann, wäre zu prüfen. Beim Einrichten eines neuen Geräts ist das der Unterschied zwischen zwei Sekunden und zwei Minuten.

Stellen: `core/hub.py`, `api/server.py`

### 55. Sieben Integrationen ohne eigene Seite ✓ erledigt (10227b9)

*Feinschliff · Aufwand: klein · Doku*

`demo`, `google_calendar`, `hue_sync`, `shading`, `spotify_webplayer`, `twinkly` und `vzug` stehen nur in der `config.example.yaml`. Bei `shading` mit 307 Zeilen Beschattungslogik ist das zu wenig.

Stellen: `docs/`, `hub/docs/`

### 56. Durchsagen brauchen Internet ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · Hub*

Die Sprachausgabe läuft über gTTS. Fällt die Leitung aus, fällt genau dann auch die Durchsage aus, wenn man sie am ehesten bräuchte. Ein lokaler Rückfall (vorgefertigte Ansagen, piper) wäre ein kleines Netz.

Stellen: `core/say.py`, `pyproject.toml: speech`

### 57. Ein störrisches Testgerät neben der Demo-Integration ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · Tests*

Fast alle Tests laufen gegen `demo` — ein Gerät, das immer sofort und richtig antwortet. Ein zweites, das langsam ist, zwischendurch ausfällt und Unsinn zurückgibt, fände eine ganz andere Klasse von Fehlern.

Stellen: `integrations/demo.py`, `hub/tests/conftest.py`


## Die App: Struktur und Typen (58–64)

### 58. Kein Auffangnetz für Fehler in der Oberfläche ✓ erledigt (2cddf53)

*tut weh · Aufwand: klein · App*

Keine einzige Error Boundary in der ganzen App. Wirft eine Kachel beim Zeichnen, geht der ganze Bildschirm weiss — auf einem Wandpanel bleibt das so, bis jemand die App neu startet. Eine Grenze je Bereich fängt das auf einen Platzhalter.

Stellen: `app/src/**`, `0 Treffer`

### 59. `EntityCard.tsx`: 2345 Zeilen für jede Geräteart ✓ erledigt (a74a798)

*lohnt sich · Aufwand: gross · App*

Licht, Store, Schloss, Sauger, Fernseher, Melder, Grill — jede Kachel in derselben Datei. Eine Datei je Art mit gemeinsamem Rahmen wäre dieselbe Anzeige, aber änderbar, ohne die anderen zu berühren.

Stellen: `components/EntityCard.tsx`

### 60. Typen je Geräteart statt `Record<string, any>` ✓ erledigt (296acdc)

*lohnt sich · Aufwand: gross · App*

Ein Licht hat `brightness`, ein Melder `illumination`, eine Store `position`. Heute ist all das derselbe untypisierte Sack, und ein Tippfehler im Schlüsselnamen fällt erst im Haus auf.

Stellen: `app/src/api/types.ts`

### 61. Einstellungen und Entitäten werden durch jede Ebene gereicht ✓ erledigt (0d9dbbe)

*Feinschliff · Aufwand: mittel · App*

Kein gemeinsamer Zustand — `settings` und `entities` wandern als Eigenschaften durch alle Bildschirme. Das ist überschaubar geblieben, aber es ist auch der Grund, warum die Bildschirme so gross sind.

Stellen: `App.tsx`, `screens/*.tsx`

### 62. Kein einheitlicher Ladezustand ✓ erledigt (75b997f)

*Feinschliff · Aufwand: klein · App*

Jeder Bildschirm löst „noch nichts da" anders — mal leer, mal ein Text, mal gar nichts. Ein Muster dafür macht die App an zwanzig Stellen ruhiger.

Stellen: `screens/*.tsx`

### 63. Kein Ort, der die Plattformunterschiede festhält ✓ erledigt (75b997f)

*Feinschliff · Aufwand: klein · App*

Nur `CameraLive` hat eine eigene Web-Fassung; alles andere teilt sich den Code. Welche Stellen sich auf iOS anders verhalten (Widgets, Face ID, Push), steht verstreut in siebzehn `Platform.OS`-Abfragen.

Stellen: `17× Platform.OS`

### 64. Die reine Logik steckt in den Bildschirmen, nicht in `lib/` ✓ erledigt (9fa310c)

*lohnt sich · Aufwand: mittel · App*

47 Funktionen sind als „rein, testbar" markiert, aber die meisten wohnen mitten in einer 3000-Zeilen-Datei. Nach `lib/` gezogen wären sie auffindbar — und Nummer 4 wäre in einem Nachmittag erledigt.

Stellen: `app/src/lib/`, `screens/*.tsx`


## Oberfläche und Barrierefreiheit (65–74)

### 65. Im Browser schliesst kein Fenster mit Escape ✓ erledigt (2cddf53)

*lohnt sich · Aufwand: klein · App*

Null Tastatur-Behandlung in der ganzen App. Am Rechner ist die Web-Fassung damit nur mit der Maus bedienbar — Escape, Tab-Reihenfolge und Enter im Formular fehlen alle.

Stellen: `app/src/**`, `0× keydown`

### 66. Sehr grosse Systemschrift bricht das Layout ✓ erledigt (fcac401)

*Feinschliff · Aufwand: klein · App*

Berichtigt: Dieser Punkt stand hier zuerst falsch. `allowFontScaling` ist in React Native standardmässig an – die App folgt der Systemschrift also längst, und «0 Treffer» hiess das Gegenteil von dem, was ich daraus gelesen hatte. Was bleibt: Niemand hat je nachgesehen, ob das Layout bei 200 % noch hält, und nirgends steht ein `maxFontSizeMultiplier` für die engen Stellen.

Stellen: `manuelle Prüfung bei 200 %`

### 67. Haptik nur an zwei Stellen ✓ erledigt (75b997f)

*Feinschliff · Aufwand: klein · App*

`lib/haptics.ts` ist da und wird in zwei Dateien benutzt. Beim Schalten eines Lichts, beim Abhaken, beim Öffnen der Tür wäre die kurze Rückmeldung genau das, was das Gefühl von „hat funktioniert" ausmacht.

Stellen: `lib/haptics.ts`, `2 Dateien`

### 68. Kacheln zeigen nicht, dass ein Befehl unterwegs ist ✓ erledigt (75b997f)

*lohnt sich · Aufwand: klein · App*

Man tippt, und bis die Antwort kommt, sieht alles aus wie vorher. Auf einer langsamen Funkstrecke tippt man deshalb zweimal.

Stellen: `components/EntityCard.tsx`

### 69. Nachts blendet das Wandpanel ✓ erledigt (bc4b476)

*Feinschliff · Aufwand: klein · App*

Der Panel-Modus hält den Bildschirm an und kehrt zur Startseite zurück — eine Absenkung der Helligkeit nach Sonnenuntergang fehlt. Der Hub kennt den Sonnenstand ohnehin schon.

Stellen: `DashboardScreen.tsx`, `core/astro.py`

### 70. Kontraste sind nie geprüft worden ✓ erledigt (0d9dbbe)

*Feinschliff · Aufwand: mittel · App*

Das dunkle Thema arbeitet viel mit `inkFaint` auf dunklem Grund. Ob das die 4,5:1 erreicht, hat nie jemand gemessen — auf einem Tablet an der Wand, aus zwei Metern, zählt das mehr als am Telefon.

Stellen: `app/src/theme.tsx`

### 71. Die Symbole tragen die Bedeutung allein ✓ erledigt (75b997f)

*Feinschliff · Aufwand: klein · App*

Zustände werden vielfach nur über Farbe und Symbol gezeigt. Wer Rot und Grün nicht unterscheidet, sieht bei „Tür offen" dasselbe wie bei „Tür zu".

Stellen: `components/EntityCard.tsx`, `OpenDoors.tsx`

### 72. Keine Rückmeldung nach dem Speichern ✓ erledigt (75b997f)

*Feinschliff · Aufwand: klein · App*

`Toast.tsx` gibt es. Nach dem Speichern eines Ablaufs oder einer Szene schliesst sich das Fenster still — richtig wäre eine kurze Bestätigung, die auch sagt, was passiert ist.

Stellen: `components/Toast.tsx`

### 73. Kein Weg zurück nach einem Fehlgriff ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · App*

Gelöschte Szenen landen im Papierkorb (`core/trash.py`) — geänderte Abläufe nicht. Wer einen Ablauf überschreibt, hat die alte Fassung verloren.

Stellen: `core/trash.py`, `core/confighistory.py`

### 74. Die Startseite lässt sich nicht drucken oder teilen ✓ erledigt (bc4b476)

*Feinschliff · Aufwand: klein · App*

Für die Ferienvertretung wäre „so bedient man das Haus" auf einem Blatt Gold wert. Heute gibt es nur die App selbst.

Stellen: `screens/DashboardScreen.tsx`


## Abläufe und Automation (75–81)

### 75. Abläufe kennen nur an und aus, nicht „bis morgen" ✓ erledigt (a8139c0)

*lohnt sich · Aufwand: klein · Hub*

`enabled` ist ein Ja/Nein. Wer über die Festtage das Bewegungslicht ruhen lassen will, schaltet es ab — und schaltet es im Januar nicht wieder ein. Ein Ablaufdatum wie beim Pausieren wäre dieselbe Mechanik.

Stellen: `core/automation.py:108`

### 76. Der Verlauf zeigt Läufe, nicht ausgebliebene Auslöser ✓ erledigt (cd41186)

*lohnt sich · Aufwand: mittel · Hub*

Wenn ein Ablauf schweigt, sind zwei Dinge möglich: Die Bedingung war falsch — das steht im Protokoll — oder der Auslöser kam nie an. Genau der zweite Fall ist unsichtbar, und es ist der häufigere.

Stellen: `core/automation.py`, `runs`

### 77. `mode` fehlt die dritte Möglichkeit ✓ erledigt (a8139c0)

*Feinschliff · Aufwand: mittel · Hub*

`single` verwirft, `restart` beginnt von vorn. Was fehlt, ist „der Reihe nach": Zweimal klingeln soll zwei Nachrichten geben, nicht eine verworfene.

Stellen: `core/automation.py:127`

### 78. Ein Ablauf kann keinen anderen starten ✓ erledigt (a8139c0)

*lohnt sich · Aufwand: mittel · Hub*

Die Aktionen kennen Befehl, Warten, Szene, Nachricht und Durchsage — aber nicht „führe Ablauf X aus". Wiederkehrende Teile muss man deshalb kopieren, und beim Ändern beide anfassen.

Stellen: `core/automation.py`, `_execute_action`

### 79. Bedingungen kennen „und" oder „oder", nie beides ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · Hub*

`match` gilt für den ganzen Satz. „Wenn es dunkel ist UND (jemand da ist ODER die Alarmanlage aus ist)" lässt sich damit nicht ausdrücken.

Stellen: `core/automation.py:113`

### 80. Der Trockenlauf kennt keine Zeit ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: klein · App*

Er zeigt, was jetzt geschähe. Bei einem Ablauf mit Wartezeit ist die interessante Frage aber, was in fünf Minuten geschieht — und ob das Licht dann wirklich ausgeht.

Stellen: `AutomationsScreen.tsx`, `api/automations/dry-run`

### 81. Abläufe aus der Datei lassen sich nicht übernehmen ✓ erledigt (c1055c0)

*Feinschliff · Aufwand: klein · App*

Was in der `config.yaml` steht, ist in der App bewusst nur lesbar. Ein Knopf „als Kopie in die App übernehmen" wäre der fehlende Weg von der Datei zur Bedienbarkeit.

Stellen: `api/server.py`, `update_automation`


## Daten und Zahlen (82–87)

### 82. Energie nur als Tagespaare ✓ erledigt (5b44cd9)

*Feinschliff · Aufwand: mittel · Hub*

Ein Zahlenpaar je Tag reicht für „mehr als letzten Monat?", nicht für „was zieht nachts Strom?". Eine Stundenauflösung kostet in derselben Datei kaum mehr und beantwortet die interessantere Frage.

Stellen: `core/energy.py`

### 83. Verwaiste Gerätedaten sammeln sich an ✓ erledigt (fcac401)

*Feinschliff · Aufwand: klein · Hub*

Berichtigt: Grenzen gibt es fast überall – `audit` 1000, `automation_runs` 100, `appliance_cycles` ein eigenes Limit, `trash` eine purge-Funktion. Was bleibt: `entity_meta` behält Einträge zu Geräten, die es längst nicht mehr gibt. Das wächst nur mit der Zahl der Geräte, ist also kein Leck – aber sauber ist es nicht.

Stellen: `core/hub.py:346`

### 84. Kein Export der eigenen Daten ✓ erledigt (db6d53f)

*Feinschliff · Aufwand: klein · Hub*

Abläufe, Szenen, Energieverlauf und Familienlisten liegen in einer JSON-Datei, an die man nur über den Rechner kommt. Ein Knopf „alles als Datei" wäre auch die einfachste Sicherung, die jeder versteht.

Stellen: `api/server.py`

### 85. Was hängt an Supabase und was nicht? ✓ erledigt (10227b9)

*Feinschliff · Aufwand: klein · Doku*

Der Hub läuft absichtlich auch ohne Datenbank — welche Fähigkeiten dann fehlen (Anmeldung per E-Mail, Off-Site-Sicherung, Verlauf), steht an keiner Stelle zusammengefasst.

Stellen: `core/supabase.py`, `core/offsite.py`, `README.md`

### 86. Der Verlauf je Gerät sagt nicht, wie weit er reicht ✓ erledigt (db6d53f)

*Feinschliff · Aufwand: klein · App*

`EntityHistory` zeichnet eine Kurve. Ob die zwei Stunden oder zwei Wochen umfasst und was davor war, sieht man ihr nicht an.

Stellen: `components/EntityHistory.tsx`

### 87. Zeitumstellung ist nirgends festgehalten ✓ erledigt (5444ed1)

*lohnt sich · Aufwand: klein · Hub*

Zeit-Auslöser rechnen mit lokaler Zeit. Was in der Nacht der Umstellung passiert — ein Ablauf um 02:30 im März, zweimal 02:30 im Oktober — ist weder beschrieben noch getestet.

Stellen: `core/automation.py`, `_time_loop`


## Betrieb und Beobachtbarkeit (88–94)

### 88. Laufende Wartezeiten überleben keinen Neustart ✓ erledigt (2cddf53)

*lohnt sich · Aufwand: klein · Betrieb*

Ein Ablauf mitten im `delay` ist nach einem Hub-Neustart weg — das Licht, das in vier Minuten ausgehen sollte, bleibt an. Nach einem Update passiert genau das, und niemand sagt es.

Stellen: `core/automation.py`, `_run`

### 89. Das Protokoll überlebt den Neustart auch nicht ✓ erledigt (5999ab3)

*Feinschliff · Aufwand: klein · Betrieb*

`logbuffer.py` hält die Zeilen im Arbeitsspeicher. Wenn man nach einem Absturz nachsehen will, warum er passiert ist, ist genau das weg. Rückfrage: Im Kopf von `logbuffer.py` steht ausdrücklich, warum das Protokoll nur im Speicher liegt – der Container schreibt es ohnehin, und der Ring soll keinen vollen Datenträger mitverursachen. Das ist eine begründete Entscheidung, die ich nicht ohne dich umdrehe.

Stellen: `core/logbuffer.py`

### 90. Keine strukturierten Protokollzeilen ✓ erledigt (5999ab3)

*Feinschliff · Aufwand: mittel · Betrieb*

Alles ist Fliesstext. „Zeig mir alle Fehler der Homematic-Integration der letzten Stunde" heisst heute grep. Als JSON-Zeilen wäre es eine Abfrage.

Stellen: `hub/homepilot/**`, `logging`

### 91. Keine Messwerte über den Hub selbst ✓ erledigt (5444ed1)

*Feinschliff · Aufwand: mittel · Betrieb*

Wie viele Befehle je Stunde, wie lange braucht die CCU, wie oft fällt eine Integration aus — der Hub weiss das alles und behält es für sich. Ein schlichter Zähler-Endpunkt genügte.

Stellen: `api/server.py`, `/api/system`

### 92. Speicher- und Prozessorverbrauch werden nicht mitgeschrieben ✓ erledigt (5444ed1)

*Feinschliff · Aufwand: klein · Betrieb*

Der Plattenplatz wird überwacht (`disk` in `/api/system`), der Rest nicht. Ein langsam wachsender Speicherverbrauch fällt so erst auf, wenn der Pi steht.

Stellen: `api/server.py`, `SystemStatus`

### 93. „Was ist neu" gibt es nur direkt nach dem Update ✓ erledigt (10227b9)

*Feinschliff · Aufwand: klein · Betrieb*

`changes.txt` wird beim Bau geschrieben und einmal angezeigt. Wer zwei Wochen später wissen will, was sich geändert hat, hat keinen Weg dorthin.

Stellen: `deploy/rebuild-hub.sh:263`, `components/WhatsNew.tsx`

### 94. Ein zweiter Hub zum Ausprobieren — gestrichen

*lohnt sich · Aufwand: klein · Betrieb*

Jede Änderung geht direkt aufs Haus. Ein zweiter Hub mit der Demo-Integration auf demselben Rechner, unter anderem Port, wäre der Ort, an dem man einen Ablauf testet, ohne nachts das Licht anzumachen.

Gestrichen, weil der Probe-Hub aus der CLAUDE.md («Die App im Browser
ansehen, ohne das Haus anzufassen») genau das ist: Demo-Integration,
eigener Port, bei Bedarf gestartet statt dauerhaft mitlaufend.

Stellen: `docker-compose.yml`, `integrations/demo.py`


## Dokumentation (95–100)

### 95. Kein Bild vom Ganzen ✓ erledigt (10227b9)

*lohnt sich · Aufwand: klein · Doku*

Sechzehn Doku-Seiten erklären je ein Thema. Wie Hub, App, Integrationen, Supabase und die Auslieferung zusammenhängen, muss man sich aus allen zusammensuchen. Ein Diagramm auf einer Seite.

Stellen: `README.md`, `docs/`

### 96. `config.example.yaml` ist 695 Zeilen lang ✓ erledigt (10227b9)

*lohnt sich · Aufwand: klein · Doku*

Sie ist Referenz und Anleitung in einem und darin sehr gut. Was fehlt, ist die kurze Fassung: zwanzig Zeilen, mit denen ein neuer Hub das erste Licht schaltet.

Stellen: `hub/config.example.yaml`

### 97. Kein CHANGELOG ✓ erledigt (6d3e4fb)

*Feinschliff · Aufwand: klein · Doku*

Die Commit-Betreffzeilen sind ausführlich und gut — aber sie beantworten nicht „was kann die Anlage heute, was sie im Frühling nicht konnte".

Stellen: `CHANGELOG.md`, `fehlt`

### 98. Ein Leitfaden für die App-Seite fehlt ✓ erledigt (10227b9)

*Feinschliff · Aufwand: klein · Doku*

`hub/docs/neue-integration.md` erklärt vorbildlich, wie eine Integration entsteht. Das Gegenstück — wie ein neues Gerät in der App eine Kachel bekommt — gibt es nicht.

Stellen: `hub/docs/neue-integration.md`

### 99. Die erste Stunde ist nicht beschrieben ✓ erledigt (10227b9)

*Feinschliff · Aufwand: klein · Doku*

Das README erklärt den Betrieb, `deploy/` die Installation. Der Weg vom leeren Raspberry Pi bis zum ersten geschalteten Licht — in Schritten, mit dem, was dabei schiefgeht — steht nirgends.

Stellen: `README.md`, `deploy/README.md`

### 100. Wo die Entscheidungen begründet stehen ✓ erledigt (10227b9)

*Feinschliff · Aufwand: klein · Doku*

Der Code ist voll ausgezeichneter Begründungen — sie stehen aber je in der Datei, um die es geht. Warum kein Home Assistant, warum eine JSON-Datei statt einer Datenbank, warum Expo: das sind die Fragen, die ein Späterer zuerst stellt.

Stellen: `docs/`, `ADR`



# Teil II: Durchsicht (101–135)

## Abläufe (101–106)

### 101. Die Alarmanlage lässt sich in keinem Ablauf schalten ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

Sie ist eine Entität mit den Befehlen `arm_night`, `arm_away`, `arm_vacation`, `disarm` – der Hub könnte das sofort. In der App fällt sie durch zwei Siebe: isSceneDevice verlangt `turn_on`, eine Store, ein Schloss, einen Player oder `start`, und baseCommandOptions hat keinen Zweig für `kind: 'alarm'`. Sie erscheint deshalb in keiner Geräteauswahl – weder in einer Szene noch in einem Ablauf. «Beim Weggehen scharf» und «Gute Nacht → Nachtmodus» sind genau die zwei Automatisierungen, die man will, und beide gehen nur über die config.yaml. Der Gute-Nacht-Knopf kann es, weil er einen eigenen Weg hat – das macht es eher schlimmer: Es sieht aus, als ginge es.

Stellen: `AutomationsScreen.tsx:1769`, `AutomationsScreen.tsx:1800`, `integrations/alarm.py:301`

### 102. Kein Auslöser «das Gerät meldet sich nicht mehr» ✓ erledigt (04884c3)

*Vorschlag · Aufwand: mittel · Hub + App*

Der Wächter schickt eine Push-Nachricht, wenn ein Melder verstummt – aber ein Ablauf kann darauf nicht reagieren. Der Grund liegt tiefer als in der App: `available` ist ein Feld der Entität, nicht Teil von `new_state`, und _state_trigger_matches sieht nur den Zustand. Ein Auslöser `{type: availability, to: false}` wäre die Grundlage für das, was man dann wirklich will: «Wenn der Rauchmelder im Keller drei Tage stumm ist, sag es mir laut» – statt einer Push-Nachricht, die man nachts wegwischt.

Stellen: `core/automation.py:788`, `core/registry.py:124`

### 103. Kein Mindestabstand zwischen zwei Läufen ✓ erledigt (04884c3)

*Vorschlag · Aufwand: klein · Hub + App*

Es gibt `mode: single` (zweiten Auslöser verwerfen) und `restart` (von vorn) – beide wirken nur, solange der Ablauf noch läuft. Ein Ablauf ohne Wartezeit hat keinen Schutz: Ein zuckender Bewegungsmelder im Wind macht aus einer Durchsage zwanzig. Ein Feld «frühestens wieder nach …» wäre drei Zeilen im Motor und würde die Sorte Ärger verhindern, bei der man am Ende den ganzen Ablauf abschaltet.

Stellen: `core/automation.py`, `mode / quiet_until`

### 104. Vom Gerät führt kein Weg zu seinen Abläufen ✓ erledigt (44e0e53)

*Vorschlag · Aufwand: klein · App*

Man steht vor einer Lampe, die abends von selbst angeht, und muss alle Abläufe durchlesen, um herauszufinden welcher es ist. Die Kreuzverweise gibt es längst: Gerät ersetzen hängt Szenen, Abläufe, Favoriten und Gruppen in einem Zug um – der Hub weiss also genau, wer auf wen zeigt. Auf der Gerätekachel fehlt nur die Zeile «kommt in 3 Abläufen und 2 Szenen vor», antippbar.

Stellen: `components/DeviceTools.tsx`, `components/EntityCard.tsx`

### 105. Der Editor sagt nie, was zusammen dabei herauskommt ✓ erledigt (04884c3)

*Vorschlag · Aufwand: klein · App*

Oben steht «Ein Ablauf ist ein Satz: Wenn … passiert, dann … tun» – und dann folgen sieben Felder über zwei Bildschirmhöhen, die diesen Satz nie zeigen. In der Liste steht er (describe), im Editor nicht. Eine mitlaufende Zeile unter dem Namen – «Wenn Bewegung Flur, dann Licht Flur an, 4 Min warten, aus» – ist die billigste Fehlerprüfung, die es gibt: Wer «und» meinte und «oder» gebaut hat, sieht es sofort.

Stellen: `AutomationsScreen.tsx:2281`, `describe()`

### 106. Ein Schritt lässt sich verschieben und löschen, aber nicht kopieren ✓ erledigt (04884c3)

*Vorschlag · Aufwand: klein · App*

Wer «Licht an, 4 Min warten, Licht aus» für den zweiten Flur nochmal braucht, tippt alles neu. Ein Ablauf lässt sich duplizieren, ein einzelner Schritt nicht – dabei ist es dieselbe Zeile Code wie move direkt daneben. Nebenan dasselbe: Die Schrittliste im Sonst-Zweig kann nichts aus dem Dann-Zweig übernehmen.

Stellen: `AutomationsScreen.tsx:3005`


## Szenen (107–110)

### 107. «Aktuellen Zustand übernehmen» verliert Helligkeit und Farbe ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

Der Hub kann Szenen mit Werten – im Kopf von `core/scenes.py` steht das Beispiel wörtlich: `{command: set_brightness, data: {brightness: 15}}`. Die App schickt so etwas nie. snapshotCommand macht aus jedem Licht `turn_on` oder `turn_off`, und saveScene reicht nur `rooms` und `position` als Daten weiter. Die Szene «Kino» – gedimmt auf 15 %, warm – lässt sich in der App gar nicht bauen, obwohl sie das Beispiel im Quelltext ist. Was man baut, sieht aus wie die Szene und macht dann volle Deckenbeleuchtung.

Stellen: `AutomationsScreen.tsx:1842`, `AutomationsScreen.tsx:1085`, `core/scenes.py:7`

### 108. Eine Szene lässt sich nicht ausprobieren ✓ erledigt (04884c3)

*Vorschlag · Aufwand: mittel · App*

Abläufe haben «Jetzt testen» und einen Trockenlauf. Szenen haben nichts davon: Man speichert, geht ins Zimmer, schaut, kommt zurück, ändert. Dabei wäre gerade hier der Rückweg leicht – der Zustand vor dem Auslösen ist bekannt, es gibt ihn als `undoCommand` längst für einzelne Geräte. «Ausprobieren» plus sechs Sekunden «Doch nicht» würde das Bauen einer Szene von fünf Gängen auf einen bringen.

Stellen: `lib/rueckgaengig.ts`, `AutomationsScreen.tsx:2075`

### 109. Eine Szene gehört zu genau einem Raum ✓ erledigt (04884c3)

*Vorschlag · Aufwand: klein · App + Hub*

`room` ist ein einzelnes Feld, und es entscheidet, in welchem Zimmer die Szene auftaucht. «Feierabend» betrifft Wohnzimmer, Küche und Storen – sie erscheint in höchstens einem davon, meist in keinem. Eine Szene könnte ihre Räume einfach aus den Geräten ableiten, die sie schaltet: Dann steht sie in jedem Zimmer, das sie anfasst, und niemand muss etwas wählen.

Stellen: `core/scenes.py:39`, `DashboardScreen.tsx:832`

### 110. Der Übergang gilt für die ganze Szene ✓ erledigt (04884c3)

*Vorschlag · Aufwand: mittel · Hub + App*

Beim Lichtwecker will man, dass das Licht über zwanzig Minuten kommt – aber die Store jetzt aufgeht, nicht in Millimeterschritten. Heute ist `transition` eine Zahl für alles; der Motor fährt zwar nur Helligkeiten an, aber die Wahl «5 / 15 / 30 Minuten» gilt trotzdem pauschal für jede Lampe der Szene. Je Gerät wäre ehrlicher – und wäre dieselbe Rampe, nur an einem anderen Ort.

Stellen: `core/scenes.py:70 ramp()`, `AutomationsScreen.tsx:2185`


## Alarmanlage (111–113)

### 111. Kein Probealarm ✓ erledigt (e58baef)

*Vorschlag · Aufwand: klein · Hub + App*

Ob die Sirene angeht, ob die Push-Nachricht kommt, ob die Kamera aufzeichnet – das erfährt man beim ersten echten Einbruch. Die Aktionslisten (`trigger`, `clear`, `arm`) sind da und einzeln auslösbar; ein Knopf «Ablauf einmal durchspielen» mit Sirene für zwei Sekunden und einer Nachricht «Test» wäre ein Nachmittag Arbeit und die einzige Möglichkeit nachzusehen, ob die Anlage überhaupt etwas tut.

Stellen: `integrations/alarm.py:113`, `AlarmScreen.tsx:808`

### 112. Die offenen Fenster in der Warnung sind nur Text ✓ erledigt (e58baef)

*Vorschlag · Aufwand: klein · App*

Beim Scharfschalten sagt die Anlage «Fenster Küche, Fenster Bad» und bietet «Trotzdem scharf schalten». Beides ist richtig – aber die Namen sind tote Buchstaben. Man steht mit dem Telefon in der Hand und weiss nicht, ob das Fenster im Bad das gekippte ist oder das offene, und ob es eine Store hat, die man von hier schliessen könnte. Die Namen antippbar zu machen (Kachel öffnen, bei Storen direkt schliessen) ist ein Handgriff und spart den Gang.

Stellen: `AlarmScreen.tsx:444`, `integrations/alarm.py:400`

### 113. Der Verlauf ist eine Sackgasse ✓ erledigt (e58baef)

*Vorschlag · Aufwand: klein · App*

Der Hub hebt fünfzig Einträge auf, die App zeigt zwölf – ohne «mehr anzeigen», ohne Filter, ohne Weg nach draussen. Für die Frage «wann war die Anlage im letzten Monat unscharf, während niemand da war?» ist das zu wenig, und genau diese Frage stellt man nach einem Einbruch. Alles zeigen, nach Art filtern, und den Verlauf ins Hausblatt oder in den Export mitnehmen.

Stellen: `AlarmScreen.tsx:605`, `integrations/alarm.py:744`


## Geräte-Seite (114–117)

### 114. Die Suche kennt die Geräteart nicht – die in den Abläufen schon ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

Unter Geräte sucht das Feld über Name, Raum, Gruppe und Integration. In der Geräteauswahl der Abläufe sucht dasselbe Feld zusätzlich über die Art – dort steht sogar der Grund als Kommentar: «Saugroboter findet ihn, ohne dass man wissen muss, dass er Rosa heisst.» Zwei Suchfelder, die gleich aussehen und verschieden können, sind schlimmer als eines, das wenig kann. Es fehlt ein Aufruf von `deviceKindLabel`.

Stellen: `DashboardScreen.tsx:767`, `AutomationsScreen.tsx:3548`, `lib/geraeteart.ts`

### 115. Keine Filter für die Fragen, die man wirklich hat ✓ erledigt (44e0e53)

*Vorschlag · Aufwand: klein · App*

Man kommt auf diese Seite mit einer von vier Fragen: Was ist gerade nicht erreichbar? Wo ist die Batterie leer? Was hat keinen Raum? Was habe ich ausgeblendet? Alle vier beantwortet der Hub schon – `available`, `low_battery`, `room`, die Ausblendliste –, und für keine gibt es einen Knopf. Vier Chips über der Liste, und die Geräteseite hört auf, eine Bleiwüste zu sein.

Stellen: `DashboardScreen.tsx:1295`, `components/DeviceHealth.tsx`

### 116. Die Geräte-Gesundheit liegt woanders ✓ erledigt (44e0e53)

*Vorschlag · Aufwand: klein · App*

DeviceHealth beantwortet «welche Batterien sind schwach, was ist offline» – und steht unter System, zwischen Speicherplatz und Integrationen. Das ist der Bildschirm für den Hub, nicht für die Geräte. Wer nach einem Gerät sucht, ist auf der Geräteseite; dort gehört die Zusammenfassung hin, und unter System bliebe ein Verweis.

Stellen: `SystemScreen.tsx`, `components/DeviceHealth.tsx`

### 117. Keine Sortierung – nur die selbst gezogene Reihenfolge ✓ erledigt (44e0e53)

*Vorschlag · Aufwand: klein · App*

Ziehen ist richtig für zwölf Kacheln auf der Startseite. Für hundert Geräte unter Geräte ist es das falsche Werkzeug: Dort will man «nach Raum», «nach Art» oder «zuletzt gesehen» und nicht hundertmal ziehen. Die Vergleichsfunktionen stehen alle schon in der Datei, sie sind nur nicht wählbar.

Stellen: `DashboardScreen.tsx:755`


## Räume-Seite (118–121)

### 118. «Alles aus» gibt es als Bauteil, aber nirgends als Knopf ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

`components/AllOff.tsx` ist fertig: Es sammelt, was an ist, fragt nach, und lässt beim Nachfragen die Waschmaschine ausgeklammert, damit man sie nicht mitten im Programm abschaltet. Es wird an keiner Stelle der App gerendert. Der Widget-Knopf «Alles aus» führt derweil auf die Raumübersicht und schaltet nichts – man tippt ihn, es passiert nichts, und man tippt nochmal.

Stellen: `components/AllOff.tsx:42`, `DashboardScreen.tsx:596`, `lib/widgetButtons.ts:50`

### 119. Der Raumkachel fehlt der Zustand des Raums ✓ erledigt (f645e04)

*Vorschlag · Aufwand: klein · App*

Sie zählt «2 an · 7 Geräte» – die Zahl, die am wenigsten aussagt. Was man beim Blick auf ein Zimmer wissen will, ist: wie warm ist es, steht ein Fenster offen, läuft Musik. Alle drei liegen im selben `items`-Feld, das die Kachel ohnehin bekommt; es braucht keine neue Abfrage, nur eine zweite Zeile.

Stellen: `components/RoomTile.tsx:101`, `components/ClimateOverview.tsx`

### 120. Bei sechs Geräten bricht die Kachel ab – ohne zu sagen, welche fehlen ✓ erledigt (f645e04)

*Vorschlag · Aufwand: klein · App*

`MAX_ROWS = 6`, dann «+ 4 weitere …». Welche vier, entscheidet die Reihenfolge, in der die Integration sie gemeldet hat – nicht, wie wichtig sie sind. Im Schlafzimmer kann so der Nachttisch wegfallen und der Fensterkontakt bleiben. Favoriten und was gerade an ist zuerst, dann der Rest: dieselben sechs Zeilen, aber die richtigen.

Stellen: `components/RoomTile.tsx:82`

### 121. Räume haben kein Gesicht ✓ erledigt (f645e04)

*Vorschlag · Aufwand: mittel · App + Hub*

Kein Symbol, keine Reihenfolge, die man in der App ändern kann – die Reihenfolge kommt aus der config.yaml, und wer sie ändern will, braucht den Rechner. Ein Raum ist der Begriff, an dem in dieser App alles hängt: Er verdient ein Symbol (Küche, Bad, Schlafzimmer sind auf einen Blick unterscheidbar) und eine Reihenfolge, die dem Weg durch die Wohnung folgt statt dem Alphabet.

Stellen: `components/RoomTabs.tsx`, `core/hub.py:306 known_rooms`


## Der einzelne Raum (122–125)

### 122. Drei Kategorien sind fest verdrahtet, der Rest heisst «Weitere» ✓ erledigt (f645e04)

*Vorschlag · Aufwand: klein · App*

Beleuchtung, Store, Medien – und dann fallen Thermostat, Schloss, Saugroboter, Kamera, Waschmaschine und jeder Fühler in einen Topf namens «Weitere». In einem Bad mit Heizkörperthermostat, Feuchtefühler und Handtuchtrockner ist «Weitere» die einzige Überschrift, die man sieht. Die Namen gibt es längst und an einer Stelle: `deviceKindLabel` – die Liste könnte sich daraus selbst bauen.

Stellen: `DashboardScreen.tsx:837`, `lib/geraeteart.ts`

### 123. Kein Raumkopf ✓ erledigt (f645e04)

*Vorschlag · Aufwand: klein · App*

Man öffnet «Bad» und sieht sofort Kacheln. Kein Satz darüber, wie warm es ist, ob das Fenster offen steht, wann zuletzt jemand drin war. Dieselben drei Angaben wie bei der Raumkachel (119), hier nur grösser – und hier wären sie sogar nützlicher, weil man schon im Zimmer denkt.

Stellen: `DashboardScreen.tsx:829`

### 124. Keine Aktionen für den ganzen Raum ✓ erledigt (f645e04)

*Vorschlag · Aufwand: klein · App*

«Hier alles aus», «alle Storen runter», «alle Lichter auf 30 %» – die drei Handgriffe, die man in einem Zimmer wirklich macht, gibt es nicht. Man tippt stattdessen fünf Kacheln einzeln an. Mit 118 (dem vorhandenen «Alles aus») ist der erste davon fast geschenkt: dieselbe Komponente, nur auf die Geräte des Raums eingegrenzt.

Stellen: `components/AllOff.tsx`, `DashboardScreen.tsx:1467`

### 125. Messwerte stehen als volle Kacheln zwischen dem Bedienbaren ✓ erledigt (f645e04)

*Vorschlag · Aufwand: klein · App*

Eine Temperatur ist nichts, was man antippt – sie belegt trotzdem genauso viel Fläche wie ein Licht. In einem Zimmer mit vier Fühlern schiebt das alles Bedienbare unter den Bildschirmrand. Eine Zeile mit Werten oben (wie in der Klima-Übersicht, die es schon gibt) statt vier Kacheln unten.

Stellen: `components/ClimateOverview.tsx`, `DashboardScreen.tsx:835`


## Widgets (126–129)

### 126. «Alles zu» ist eine Behauptung – gezählt werden nur Schlösser ✓ erledigt (794117a)

*belegt · Aufwand: klein · Hub*

`/api/glance` füllt `doors_open` ausschliesslich aus Entitäten der Art `lock`. Die App hat für dieselbe Frage eine ganz andere, sorgfältig gebaute Antwort: openContacts zählt Kontaktsensoren und den Türsensor im Schloss, mit Geräteklassen und einem Namensmuster als Rückfall – und im Kopf steht ausdrücklich, warum es nur eine Fassung geben darf. Das Widget sagt «Alles zu, kein Licht», während das Küchenfenster offen steht. Bei einer Anzeige, die man im Vorbeigehen liest und nicht nachprüft, ist das die schlimmste Sorte Fehler.

Stellen: `api/server.py:3259`, `components/OpenDoors.tsx:40`, `widget/index.swift:121`

### 127. Der Alarmzustand kommt im Widget an und wird weggeworfen ✓ erledigt (794117a)

*belegt · Aufwand: klein · iOS-Widget*

`/api/glance` liefert `alarm` mit – das Widget liest die drei anderen Felder und dieses nicht. Dabei ist es die Angabe, für die man ein Sperrbildschirm-Widget überhaupt anlegt: Habe ich scharf geschaltet? Genau das fragt man sich im Auto, und genau dafür will man nicht die App öffnen.

Stellen: `api/server.py:3287`, `widget/index.swift:121`

### 128. Eine Viertelstunde ist lang, wenn etwas passiert ✓ erledigt (794117a)

*Vorschlag · Aufwand: klein · iOS-Widget*

Das Widget frischt sich alle 15 Minuten auf – für «steht die Türe offen» beim Blick im Vorbeigehen ist das richtig, und der Kommentar sagt das auch. Es gibt aber schon einen Kanal, der sofort ankommt: Push. Die Benachrichtigungs-Erweiterung liegt neben dem Widget im selben Ordner; ein `WidgetCenter.reloadAllTimelines()` dort macht aus «in den nächsten fünfzehn Minuten» ein «jetzt» – ohne einen einzigen zusätzlichen Abruf.

Stellen: `widget/index.swift:144`, `notification-image/NotificationService.swift`

### 129. Vier Knöpfe, und alle vier tun dasselbe: die App öffnen ✓ erledigt (8c1bb6b)

*Vorschlag · Aufwand: mittel · iOS-Widget*

Beim Türöffner ist das die richtige Entscheidung und steht auch so begründet da. Bei «Alles aus» und «Licht Küche» ist es keine Sicherheitsfrage mehr, sondern nur noch ein Umweg: App öffnet, springt irgendwohin, man tippt nochmal. Seit iOS 17 kann ein Widget-Knopf selbst schalten. Je Knopf entscheiden statt für alle – Schlösser und Alarm behalten den Umweg, Licht und Szene schalten direkt.

Stellen: `lib/widgetButtons.ts:16`, `widget/index.swift:223`


## Rezepte (130–135)

### 130. Beim Kochen schläft der Bildschirm ein ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

Man hat Teig an den Händen, das Telefon liegt neben dem Brett, und nach dreissig Sekunden ist es schwarz. `expo-keep-awake` ist installiert und wird im Wandpanel-Modus schon benutzt – im Kochmodus, dem einen Ort, an dem man den Bildschirm nachweislich nicht anfassen kann, steht kein einziger Aufruf. Zwei Zeilen.

Stellen: `RecipeBook.tsx:488 CookMode`, `DashboardScreen.tsx:1890`

### 131. Die Einkaufsliste bekommt die Menge für die falsche Portionenzahl ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

Man stellt im Rezept «8 statt 4 Portionen» ein, die Zutatenliste rechnet sauber mit, und dann tippt man «Auf die Einkaufsliste» – und bekommt die Mengen für vier. Der Faktor steht als `factor` in derselben Komponente, zwei Bildschirme weiter oben; der Aufruf gibt ihn nur nicht weiter. Man merkt es im Laden nicht, sondern beim Kochen.

Stellen: `RecipeBook.tsx:852`, `RecipeBook.tsx:624`, `lib/einkauf.ts`

### 132. Der Essensplaner findet das Rezept über seinen Namen ✓ erledigt (794117a)

*belegt · Aufwand: klein · App*

Beim Eintragen sucht der Planer das Rezept per `String(item.text) === text` – über die Beschriftung also, obwohl die Kennung am Aufrufort direkt danebenliegt. Zwei Rezepte «Lasagne», oder eines, das später umbenannt wird, und der Wocheneinkauf findet die Zutaten nicht mehr. Der Kommentar daneben erklärt sogar, warum die Kennung mitgeschrieben wird – sie wird nur falsch beschafft.

Stellen: `FamilyScreen.tsx:2944`, `RecipeBook.tsx:886`

### 133. «20 Minuten backen» und die Küchenuhr wissen nichts voneinander ✓ erledigt (8c1bb6b)

*Vorschlag · Aufwand: klein · App*

Der Hub hat Küchenuhren mit Durchsage über die Lautsprecher (`core/timers.py`). Der Kochmodus zeigt derweil einen Schritt an, in dem «20 Minuten» steht, und tut so, als ginge ihn das nichts an. Eine Zahl mit «Minuten» dahinter zu erkennen ist ein Einzeiler; daraus einen Knopf «Uhr stellen» zu machen verbindet zwei Teile des Hauses, die zufällig beide schon da sind – und ruft einen dann im Wohnzimmer.

Stellen: `core/timers.py`, `components/KitchenTimer.tsx`, `RecipeBook.tsx:567`

### 134. Die Zutaten verschwinden, sobald man loskocht ✓ erledigt (8c1bb6b)

*Vorschlag · Aufwand: klein · App*

Mise en Place zeigt alles, dann tippt man «Loskochen» – und sieht bis zum Ende nur noch Schritte. «Wieviel Rahm war das nochmal?» beantwortet man mit teigigen Fingern über zwei Rückwärtsschritte. Eine ausklappbare Zeile am unteren Rand mit den Zutaten des aktuellen Schrittes (oder ersatzweise allen) löst das, ohne den grossen Schritttext anzutasten.

Stellen: `RecipeBook.tsx:534`

### 135. Ein Rezept hat keine Herkunft und keine Notiz danach ✓ erledigt (8c1bb6b)

*Vorschlag · Aufwand: klein · App*

Woher es stammt (Buch, Seite, Link, «von Mama»), wann man es zuletzt gekocht hat, und was beim letzten Mal war – «zu salzig», «bei 180° statt 200°» – nichts davon hat ein Feld. Gerade das ist der Unterschied zwischen einer Rezeptsammlung und einem Familienkochbuch: Ein Rezept, das dreimal gekocht und zweimal korrigiert wurde, ist mehr wert als eines aus dem Netz. Drei Felder, kein neues Konzept.

Stellen: `RecipeBook.tsx:287 RecipeForm`



# Teil III: Küche & Abläufe (136–164)

## Rezepte erfassen, ohne zu tippen (136–138)

### 136. Rezept aus einem Link übernehmen ✓ erledigt (11afa9a)

*tut weh · Aufwand: mittel · Hub + App*

Die grösste Hürde des Rezeptbuchs ist das Abtippen: Zutaten Zeile für Zeile, Schritte Zeile für Zeile. Dabei tragen praktisch alle Rezeptseiten (Betty Bossi, Fooby, Chefkoch …) ihr Rezept maschinenlesbar als `schema.org/Recipe` im Seitenkopf. Ein Feld «Link einfügen» im Formular, der Hub holt die Seite, ein reiner Parser (testbar mit gespeicherten Beispielseiten) macht daraus Titel, Zutaten, Schritte, Zeiten, Portionen und Bild – und das Formular öffnet sich vorbefüllt zum Nachbessern. Die Quelle steht dann gleich im Feld «Woher?».

Stellen: `hub: neue Route /api/recipes/import`, `app/src/screens/RecipeBook.tsx (RecipeForm)`

### 137. Kategorie aus den vorhandenen wählen statt frei tippen ✓ erledigt (449ee7d)

*lohnt sich · Aufwand: klein · App*

Die Kategorie ist heute ein Freitextfeld. Einmal «Dessert», einmal «Desserts», einmal «dessert» – und die Filterleiste zeigt drei Chips für dieselbe Sache. Im Formular die bestehenden Kategorien als antippbare Chips anbieten (plus «Neue…» für echte neue), so wie es der Ablauf-Editor bei den Zuständen vormacht.

Stellen: `RecipeBook.tsx:447 (RecipeForm, Feld Kategorie)`

### 138. Fotos verkleinern – und die Kamera zulassen ✓ erledigt (449ee7d)

*lohnt sich · Aufwand: klein · App*

Rezeptfotos werden als Base64 im Familien-Speicher abgelegt – in Originalauflösung eines iPhone-Fotos sind das schnell mehrere MB, und `/api/family` liefert bei jedem Öffnen alle Fotos mit. Vor dem Speichern auf ~1200 px verkleinern (expo-image-manipulator liegt dem SDK bei), das genügt für Kachel und Detail. Und neben der Galerie auch `launchCameraAsync` anbieten: Das fertige Gericht fotografiert man in dem Moment, in dem es auf dem Tisch steht.

Stellen: `RecipeBook.tsx:347 (pickImage)`


## Kochen (139–144)

### 139. «Was koche ich heute?» – ein Vorschlagsknopf ✓ erledigt (11afa9a)

*lohnt sich · Aufwand: mittel · App*

Das Rezeptbuch weiss, was Favorit ist und wann jedes Gericht zuletzt gekocht wurde (`last_cooked`) – aber die Antwort auf die tägliche Frage muss man sich selbst zusammensuchen. Ein Knopf im Rezeptbuch und im Essensplaner: Eine reine, testbare Gewichtung (lange nicht gekocht + Favorit + passt zur Kategorie des Wochentags) zieht drei Vorschläge; «nochmal würfeln» tauscht sie aus, Antippen öffnet das Rezept.

Stellen: `RecipeBook.tsx`, `neu: src/lib/vorschlag.ts (rein, testbar)`

### 140. Gekocht-Zähler und «lange nicht gekocht» ✓ erledigt (449ee7d)

*Feinschliff · Aufwand: klein · App*

Der Kochmodus setzt beim «Fertig ✓» schon das Datum – ein Zähler daneben (`cooked_count`) kostet eine Zeile. Damit gibt es zwei neue Sortierungen in der Filterleiste: «Klassiker» (am häufigsten gekocht) und «Lange nicht gekocht» – genau die zwei Listen, aus denen man abends wirklich auswählt.

Stellen: `RecipeBook.tsx:1174 (onCooked)`, `RecipeBook.tsx:1196 (filters)`

### 141. Zutaten im Mise en Place abhaken ✓ erledigt (449ee7d)

*lohnt sich · Aufwand: klein · App*

Die Bereitleg-Seite des Kochmodus ist eine blosse Liste. Mit einem Haken je Zutat sieht man, was schon auf der Arbeitsfläche steht – und merkt vor dem «Loskochen», dass der Rahm fehlt, nicht mitten in Schritt vier. Der Haken lebt nur im Kochmodus, gespeichert wird nichts.

Stellen: `RecipeBook.tsx:599 (CookMode, Mise en Place)`

### 142. Die Zutaten des aktuellen Schritts zeigen, nicht alle ✓ erledigt (11afa9a)

*Feinschliff · Aufwand: mittel · App*

Das Aufklapp-Panel «Zutaten» im Kochmodus zeigt immer die ganze Liste. Meist will man aber nur wissen, wieviel von dem, was dieser Schritt verlangt. Eine reine Funktion, die Zutatennamen im Schrittext wiederfindet (Wortstamm-Vergleich reicht), blendet die Treffer direkt unter dem Schritt ein – das Panel mit allen bleibt als Rückfall.

Stellen: `RecipeBook.tsx:677 (Zutaten-Panel)`, `neu in src/lib/ (rein, testbar)`

### 143. Mehrere Zeiten im Schritt → mehrere Uhr-Knöpfe ✓ erledigt (449ee7d)

*Feinschliff · Aufwand: klein · App*

«10 Minuten köcheln, dann 20 Minuten ziehen lassen» – der Uhr-Knopf erkennt heute eine Zeit pro Schritt. `minutenImText` auf «alle Funde» erweitern und je Fund einen Knopf zeigen, beschriftet mit dem Textstück davor. Die Küchenuhren des Hubs können längst mehrere gleichzeitig.

Stellen: `app/src/lib/kochzeit.ts`, `RecipeBook.tsx:658 (Uhr-Knopf)`

### 144. Schritt auf die Küchenbox durchsagen ✓ erledigt (11afa9a)

*Feinschliff · Aufwand: klein · Hub + App*

Mit Teig an den Händen liest man schlecht. Der Hub kann bereits offline sprechen (`core/say.py`, mit Vorratsspeicher) – ein Lautsprecher-Knopf neben dem Schritt sagt ihn auf einer wählbaren Box an, dieselbe Mechanik wie die Durchsage-Aktion der Abläufe. Die Boxenwahl merkt sich die App.

Stellen: `hub/homepilot/core/say.py`, `RecipeBook.tsx:653 (cookBody)`


## Planen und einkaufen (145–147)

### 145. Portionen wandern mit in den Essensplan ✓ erledigt (11afa9a)

*lohnt sich · Aufwand: mittel · App*

«Planen» merkt sich Tag und Rezept, aber nicht die eingestellten Portionen. Kommt am Samstag Besuch, rechnet der Wocheneinkauf trotzdem mit den Portionen aus dem Rezept. Die gewählte Portionenzahl beim Planen mitspeichern (`servings` am Essensplan-Eintrag) und beim Sammel-Einkauf als Faktor verwenden – die Detailansicht kann es pro Rezept ja schon.

Stellen: `RecipeBook.tsx:1047 (planSheet)`, `FamilyScreen.tsx:531 (Essensplaner)`

### 146. Der Essensplaner zeigt das Gericht, nicht nur den Namen ✓ erledigt (11afa9a)

*lohnt sich · Aufwand: mittel · App · Darstellung*

Der Planer ist heute sieben Textzeilen. Für Einträge mit `recipe_id` liegt alles bereit: Foto, Gesamtzeit, «zuletzt gekocht». Eine kleine Rezeptkachel je Tag (Bild, Titel, Zeit), Antippen öffnet das Rezept, der heutige Tag ist hervorgehoben – dann beantwortet ein Blick aufs iPad am Kühlschrank die Frage «was gibts heute, und wie lange brauche ich?».

Stellen: `FamilyScreen.tsx:575 (Essensplaner-Ansicht)`

### 147. Brüche und Küchenrundung bei skalierten Mengen ✓ erledigt (449ee7d)

*Feinschliff · Aufwand: klein · App*

Wer von 4 auf 3 Portionen stellt, liest heute «0,75 TL» und «187,5 g». In der Küche heisst das «¾ TL» und «190 g». `scaledAmount` um gängige Brüche (½, ⅓, ¼, ¾) und eine grössenabhängige Rundung erweitern – eine reine Funktion, die sich in fünf Zeilen Test beschreiben lässt.

Stellen: `RecipeBook.tsx:113 (scaledAmount)`


## Rezepte: Darstellung und Weitergabe (148–151)

### 148. Rezept als Variante duplizieren ✓ erledigt (449ee7d)

*Feinschliff · Aufwand: klein · App*

«Lasagne, aber vegetarisch» beginnt heute mit dem Neu-Erfassen des ganzen Rezepts. Ein «Als Variante kopieren» in der Detailansicht legt eine Kopie mit Zusatz im Titel an und öffnet sie im Formular – dieselbe Überlegung, aus der bei den Abläufen der Kopie-Knopf entstanden ist («sechs fast gleiche Taster-Abläufe tippt niemand»).

Stellen: `RecipeBook.tsx:828 (Detail-Kopfknöpfe)`

### 149. Rezept teilen – als sauber formatierter Text ✓ erledigt (449ee7d)

*Feinschliff · Aufwand: klein · App*

«Schickst du mir das Rezept?» endet heute in Screenshots. Ein Teilen-Knopf, der Titel, Zutaten (in den aktuell eingestellten Portionen!) und Schritte als Text ins Teilen-Blatt des Systems gibt – WhatsApp, Mail, Notizen. Die Textform ist eine reine Funktion und damit testbar.

Stellen: `RecipeBook.tsx (RecipeDetail)`, `React Native Share API`

### 150. Kachel-Raster: Spaltenzahl nach Breite statt fix zwei ✓ erledigt (449ee7d)

*lohnt sich · Aufwand: klein · App · Darstellung*

Das Raster steht fest auf zwei Spalten – auf dem iPad quer werden die Kacheln damit handtellergross und acht Rezepte füllen den Schirm. Die Spaltenzahl aus der gemessenen Breite ableiten (~240 Punkte je Kachel: iPhone 2, iPad hoch 3, iPad quer 4). Die Breitenmessung existiert schon, es ändert sich eine Zeile Arithmetik.

Stellen: `RecipeBook.tsx:1194 (columns = 2)`

### 151. Kochmodus im Querformat: Zutaten links, Schritt rechts ✓ erledigt (11afa9a)

*Feinschliff · Aufwand: mittel · App · Darstellung*

Auf dem iPad in der Küche – dem wahrscheinlichsten Kochgerät – nutzt der Kochmodus quer nur die Mitte des Bildschirms. Zweispaltig wird er besser: links die Zutatenliste dauerhaft sichtbar (mit den Haken aus Punkt 141), rechts der grosse Schritt mit Uhr-Knopf. Hochkant bleibt alles wie es ist.

Stellen: `RecipeBook.tsx:534 (CookMode)`


## Abläufe: was der Editor noch nicht kann (152–159)

### 152. Und/Oder-Gruppen im Editor bauen können ✓ erledigt (0ef613f)

*lohnt sich · Aufwand: gross · App*

Der Hub versteht geschachtelte Bedingungsgruppen, und der Editor bewahrt sie beim Öffnen brav auf (`extraConditions`) – bauen kann er sie aber nicht. «Nur wenn dunkel und (jemand zuhause oder Gast-Modus)» erfordert heute die config.yaml. Eine Schachtelungsebene im Editor genügt für praktisch alle Fälle: eine Gruppe mit eigenem alle/eine-Schalter unter den normalen Bedingungen.

Stellen: `automations/entwurf.ts:445 (extraConditions)`, `hub: core/automation.py (group)`

### 153. Kalender-Auslöser: «wenn ein Termin ‹…› beginnt» ✓ erledigt (0ef613f)

*lohnt sich · Aufwand: mittel · Hub + App*

Der Kalender ist angebunden, aber Abläufe können ihn nicht hören. Ein Auslöser «Termin beginnt/endet, dessen Titel ein Wort enthält» macht daraus: Grünabfuhr-Erinnerung am Vorabend, «Ferien»-Termin schaltet die Anwesenheitssimulation scharf, «Besuch» heizt das Gästezimmer. Der Hub pollt den Kalender ohnehin schon.

Stellen: `hub/homepilot/integrations/google_calendar.py`, `core/automation.py (Trigger)`

### 154. Bedingung «kein Feiertag» ✓ erledigt (643b74f)

*Feinschliff · Aufwand: klein · Hub + App*

Die Wochentags-Bedingung kennt Montag bis Sonntag, aber nicht Auffahrt. «Morgens saugen, werktags» läuft darum auch am 1. August. Die Luzerner Feiertage sind offline berechenbar (Ostern-Formel plus feste Tage) – eine reine, testbare Funktion und ein Häkchen «ausser an Feiertagen» neben den Wochentagen.

Stellen: `core/automation.py (Zeit-Bedingung, weekdays)`, `neu: core/feiertage.py (rein)`

### 155. Zufalls-Versatz für Zeit- und Sonnen-Auslöser ✓ erledigt (643b74f)

*lohnt sich · Aufwand: klein · Hub + App*

Storen, die 365 Tage im Jahr sekundengleich fahren, erzählen jedem Beobachter: Hier wohnt eine Zeitschaltuhr. Ein Feld «± Minuten zufällig» am Zeit- und Sonnen-Auslöser würfelt den Zeitpunkt jeden Tag neu innerhalb des Fensters. Zugleich die halbe Miete für Punkt 156.

Stellen: `core/automation.py:565 (Zeit-Auslöser)`, `automations/entwurf.ts (TriggerDraft)`

### 156. Vorlage «Ferienmodus»: Anwesenheit simulieren ✓ erledigt (0ef613f)

*lohnt sich · Aufwand: mittel · App*

Der Klassiker, der noch fehlt: Wenn tagelang niemand zuhause ist, abends ein, zwei Lichter mit Zufalls-Versatz an und später wieder aus – Wohnzimmer und ein Zimmer, nicht die ganze Etage. Als Vorlage aus dem Gerätebestand gebaut (Anwesenheit + Lichter sind ja bekannt), mit Punkt 155 als Zutat. Dazu passt der «Ferien»-Termin aus Punkt 153 als Alternativ-Auslöser.

Stellen: `automations/vorlagen.ts (buildTemplates)`

### 157. Schritt «über n Minuten dimmen» – auch als Aufwachlicht ✓ erledigt (0ef613f)

*Feinschliff · Aufwand: mittel · Hub + App*

Es gibt «schalten» und «warten», aber kein «weich». Ein Schritt, der eine Lampe über eine Spanne von Helligkeit A nach B fährt (der Hub rechnet die Zwischenschritte, Hue kann Helligkeit setzen), macht zwei Dinge möglich: Licht, das abends im Kinderzimmer über zehn Minuten ausglimmt statt zu knipsen – und das Aufwachlicht eine halbe Stunde vor dem Wecker.

Stellen: `core/automation.py:1464 (Schritt-Arten)`, `integrations/hue.py:196 (brightness)`

### 158. Nachricht an eine bestimmte Person schicken ✓ erledigt (643b74f)

*lohnt sich · Aufwand: klein · App*

Der Hub kann es längst: Die Nachricht-Aktion kennt ein `to` (alle, eine Rolle, ein Name). Der Editor bietet es bloss nicht an – jede Ablauf-Push geht an alle. Eine Empfänger-Auswahl im Nachricht-Schritt, und «Waschmaschine fertig» piepst nur noch bei dem, der sie ausräumt.

Stellen: `core/automation.py:21 (notify, to?)`, `automations/felder.tsx (Nachricht-Schritt)`

### 159. «Aus bis morgen» statt nur aus ✓ erledigt (643b74f)

*lohnt sich · Aufwand: klein · Hub + App*

Heute Abend soll das Bewegungslicht im Flur schweigen (Gäste schlafen dort) – also schaltet man den Ablauf aus. Und vergisst ihn wieder einzuschalten; drei Wochen später wundert man sich im Dunkeln. Neben dem Aus-Schalter ein «aus bis morgen früh» (`disabled_until`), das sich selbst wieder scharf macht. In der Liste steht solange «aus bis 06:00».

Stellen: `core/automation.py (enabled)`, `AutomationsScreen.tsx:479`


## Abläufe: sehen, was passiert (160–164)

### 160. Der Lauf-Verlauf zeigt die Schritte, nicht nur das Ergebnis ✓ erledigt (0ef613f)

*tut weh · Aufwand: mittel · Hub + App*

Der Verlauf sagt heute «gelaufen» oder «Bedingung nicht erfüllt» – aber wenn ein Lauf mittendrin scheitert, steht da nur eine Fehlerzeile. Welcher Schritt hing? Ist das «warte bis» abgelaufen, oder hat das Gerät den Befehl abgelehnt? Je Lauf die Schritte mit Ausgang aufzeichnen (ausgeführt / gewartet n s / Zeitüberschreitung / Fehler) und im aufgeklappten Verlauf als kleine Zeitleiste zeigen. Das ist die Antwort auf die häufigste Ablauf-Frage überhaupt: «Warum hat es nicht…?»

Stellen: `core/automation.py:1322 (_note)`, `AutomationsScreen.tsx:494 (Lauf-Verlauf)`

### 161. «Nächste Ausführung: heute 21:12» in der Zeile ✓ erledigt (643b74f)

*lohnt sich · Aufwand: klein · Hub + App*

Bei Zeit-, Sonnen- und Intervall-Auslösern weiss der Hub auf die Minute, wann es das nächste Mal so weit ist – er rechnet es für die eigene Warteliste ja aus. Diese Zahl in die Ablauf-Liste stellen («heute 21:12», «Mo 09:00») macht auf einen Blick sichtbar, ob der Sonnenuntergangs-Versatz das tut, was man meinte.

Stellen: `core/automation.py:565 (Fälligkeit)`, `AutomationsScreen.tsx (Listenzeile)`

### 162. Die Ablauf-Liste suchen und gruppieren ✓ erledigt (0ef613f)

*lohnt sich · Aufwand: mittel · App · Darstellung*

Beim Umsetzen zeigte sich: Suchfeld und Gruppierung (nach Kategorie) gab es bereits – dieser Punkt war halb erfüllt, bevor er geschrieben war. Geliefert ist die fehlende Hälfte: ein Symbol je Auslöserart (Uhr, Sonne, Bewegung, Termin, Messwert …) am Zeilenanfang, damit die Liste auf einen Blick sagt, worauf jeder Ablauf hört.

Stellen: `AutomationsScreen.tsx (Liste)`

### 163. Tagesband: was das Haus heute vorhat ✓ erledigt (0ef613f)

*Feinschliff · Aufwand: mittel · App · Darstellung*

Alle zeitgesteuerten Abläufe des heutigen Tages auf einer Leiste – 07:10 Storen auf, 09:00 saugen, 21:38 Storen zu (Sonnenuntergang + Versatz), dazu die schon gelaufenen als Häkchen. Eine Ansicht über der Ablauf-Liste, gebaut aus denselben Fälligkeits-Daten wie Punkt 161. Beantwortet «was macht das Haus heute noch?» ohne jeden Ablauf einzeln zu öffnen.

Stellen: `AutomationsScreen.tsx`, `core/automation.py (Fälligkeiten)`

### 164. Einen einzelnen Schritt ausführen – nicht den ganzen Ablauf ✓ erledigt (643b74f)

*Feinschliff · Aufwand: klein · Hub + App*

Der Probelauf zählt auf, was passieren würde; der Testlauf führt alles aus. Dazwischen fehlt etwas: Beim Einrichten will man oft nur wissen, ob Schritt drei – die Durchsage, das Kamerabild in der Nachricht – so ankommt wie gedacht. Ein «▶» je Schritt im Editor, der genau diesen einen ausführt, erspart es, für jede Formulierungsprobe die Storen mitfahren zu lassen.

Stellen: `automations/editor.tsx (Schrittliste)`, `hub: Route je Schritt`



# Teil IV: Familie & Haushalt (165–221)

## Familienseite (165–171 · 204–206)

### 165. Die Familienseite muss ohne Netz lesbar sein ✓ erledigt

*tut weh · Aufwand: mittel · App*

Der Geräte-Bildschirm legt seinen Stand im Gerät ab (`useHub` schreibt die Entitäten in den AsyncStorage) – die Familienseite nicht. Wer im Ladenkeller, im Zug oder bei schwachem WLAN die Einkaufsliste öffnet, sieht nichts. Dieselbe Mechanik hier: beim Laden zwischenspeichern, beim Öffnen zuerst den gespeicherten Stand zeigen und dann still auffrischen. Mit einer ehrlichen Zeile «Stand von 14:12, keine Verbindung».

Stellen: `app/src/screens/FamilyScreen.tsx`, `Vorbild: hooks/useHub.ts:114`

### 166. Eine Suche über alle Listen ✓ erledigt

*lohnt sich · Aufwand: mittel · App*

Die Seite hat siebzehn Module. «Wo stand nochmal die Nummer vom Kaminfeger?» heisst heute: Kontakte öffnen, suchen, zurück, Dokumentsafe öffnen, suchen. Ein Suchfeld über der Kachel-Übersicht, das quer durch Aufgaben, Einkauf, Kontakte, Rezepte, Dokumente und Notizen sucht und die Treffer nach Modul gruppiert – Antippen springt an die Stelle.

Stellen: `FamilyScreen.tsx (Kachel-Übersicht)`

### 167. Ein Papierkorb für die Familienlisten ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub + App*

Abläufe und Szenen haben einen (30 Tage, `core/trash.py`), die Familienlisten nicht: Ein Fehlgriff neben dem Häkchen löscht die Aufgabe, das Rezept, den Kontakt – endgültig. Dieselbe Ablage auch für `/api/family/{liste}`, mit «Rückgängig» direkt nach dem Löschen.

Stellen: `hub/homepilot/core/trash.py`, `api/routes/family.py (family_delete)`

### 168. Was ist neu, seit ich zuletzt hingeschaut habe? ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Jeder Eintrag trägt `author` und `created` – genutzt wird das kaum. Ein kleiner Punkt auf der Modul-Kachel, wenn dort seit dem letzten Besuch etwas dazugekommen ist (je Person im Gerät gemerkt), und in der Liste eine leise Zeile «von Sandra, vorhin». Dann sieht man auf der Übersicht, wo sich etwas getan hat.

Stellen: `FamilyScreen.tsx (Kacheln)`

### 169. Sicherung, die auch die Rezepte mitnimmt ✓ erledigt

*lohnt sich · Aufwand: klein · Hub*

Kontakte, Rezepte samt Fotos, das Notfallblatt, der Dokumentsafe – das alles liegt in `hub.data` und damit in genau einer Datei auf genau einem Rechner. Es gibt eine Sicherung im System-Bildschirm; was fehlt, ist ein Ausdruck, den man auch ohne HomePilot noch lesen kann: die Familiendaten als JSON und als lesbare HTML-Seite, einmal im Monat automatisch abgelegt.

Stellen: `hub/homepilot/core/persistence.py`, `api/routes/system.py (Sicherung)`

### 170. Erledigtes verschwindet von selbst ✓ erledigt

*Feinschliff · Aufwand: klein · Hub*

Abgehakte Aufgaben, erledigte Einkäufe und abgelaufene Countdowns bleiben stehen, bis jemand aufräumt – und niemand räumt auf. Eine stille Regel im Hub: Was länger als eine Woche erledigt ist, wandert in den Papierkorb (Punkt 167). Die Liste bleibt dadurch das, was sie sein soll: kurz.

Stellen: `api/routes/family.py`, `core/watchdog.py (täglicher Lauf)`

### 171. Die Familienseite am Wandpanel ✓ erledigt

*Feinschliff · Aufwand: mittel · App · Darstellung*

Am Kühlschrank hängt ein iPad, und es zeigt die Geräte. Für den Alltag interessanter wäre dort die Familie: heutige Termine, die Ämtli von heute, was es zu essen gibt, die Einkaufsliste. Eine ruhige Ansicht ohne Bedienelemente, gross genug für zwei Meter Abstand – und ohne Zugriff auf Türen und Alarm, weil am Kühlschrank jeder vorbeikommt.

Stellen: `FamilyScreen.tsx`, `Vorbild: Wandpanel-Modus`

### 204. Der Sonntagabend-Ausblick ✓ erledigt

*lohnt sich · Aufwand: klein · Hub*

Der Hub kennt die Termine der Woche, die fälligen Ämtli und die anstehenden Geburtstage – aber jeder sammelt sich das selbst zusammen. Eine Push am Sonntagabend («Diese Woche: 3 Termine, Grüngut am Dienstag, Livia hat am Freitag Geburtstag») kommt genau dann, wenn man die Woche ohnehin im Kopf durchgeht. Der Wächter hat den täglichen Lauf, die Push-Kategorien gibt es – es fehlt nur das Zusammensetzen.

Stellen: `core/watchdog.py`, `core/notifyrules.py (abschaltbar wie alle)`

### 205. Kacheln ausblenden, die niemand braucht ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Siebzehn Module, und die Reihenfolge lässt sich schon ziehen – aber wer keine Medikamente verwaltet und keine Packlisten führt, scrollt trotzdem jeden Tag daran vorbei. Ein «Ausblenden» im selben Ordnen-Modus (pro Person, wie die Reihenfolge), mit einer Zeile «3 ausgeblendete anzeigen» am Ende – nichts ist weg, es steht nur nicht mehr im Weg.

Stellen: `FamilyScreen.tsx (moduleOrder)`

### 206. Die Pinnwand kann keine Bilder ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Was wirklich an einer Pinnwand hängt, sind selten Sätze: der Elternbrief, der Stundenplan, die Zeichnung. Die Pinnwand hier kann nur Text. Ein Foto je Pin (dieselbe Mechanik wie beim Rezeptfoto: Kamera oder Galerie, verkleinert, als Bild in der Karte) macht sie zu dem, was der Name verspricht.

Stellen: `FamilyScreen.tsx (Pinnwand)`, `Vorbild: RecipeBook pickImage`


## Einkaufsliste (172–177 · 207–209)

### 172. Abhaken ohne Empfang – und es geht trotzdem nicht verloren ✓ erledigt

*tut weh · Aufwand: mittel · App*

Die Fortsetzung von 165 und der eigentliche Fall im Laden: Jedes Häkchen ist heute ein sofortiger Aufruf an den Hub. Ohne Netz passiert nichts – oder schlimmer, es sieht aus, als wäre es passiert. Änderungen im Gerät sammeln und nachsenden, sobald der Hub wieder da ist, mit einer Zeile «3 Änderungen warten». Ohne das ist die Liste im Laden Zierde.

Stellen: `FamilyScreen.tsx (update/add/remove)`

### 173. Einkaufs-Modus: grosse Zeilen, wacher Bildschirm ✓ erledigt

*lohnt sich · Aufwand: klein · App · Darstellung*

Im Laden hält man das Telefon in einer Hand, in der anderen den Wagen. Ein Knopf «Ich bin im Laden» schaltet auf grosse Zeilen mit grosser Trefferfläche, hält den Bildschirm wach (wie der Kochmodus), blendet Erledigtes aus und zeigt oben, wie viel noch fehlt. Ein zweites Tippen beendet ihn.

Stellen: `FamilyScreen.tsx (Einkaufsliste)`, `Vorbild: RecipeBook CookMode`

### 174. Derselbe Posten zweimal – einmal zählen ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Zwei Menschen tragen unabhängig «Milch» ein, und im Laden steht sie zweimal auf der Liste. `mengeUndName` und `mitMenge` gibt es schon; was fehlt, ist der Griff beim Eintragen: Steht der Posten bereits drauf, wird die Menge erhöht («2 Milch») statt eine zweite Zeile angelegt – mit einem Hinweis, der sich rückgängig machen lässt.

Stellen: `src/lib/einkauf.ts:166 (mengeUndName)`, `findeArtikel`

### 175. Posten einem Laden zuordnen ✓ erledigt

*lohnt sich · Aufwand: mittel · App*

Die Läden kennen ihre Gangfolge, aber jeder Posten steht in einer einzigen Liste. Der Käse vom Hofladen und die Schrauben aus dem Baumarkt stehen zwischen der Migros-Ware. Ein Laden-Feld je Posten (leer = überall), dazu ein Filter oben: «Migros (12)», «Baumarkt (2)». Wer im Baumarkt steht, sieht dann zwei Zeilen statt vierzehn.

Stellen: `src/lib/einkauf.ts (Shop, groupForShop)`

### 176. Was jede Woche fehlt, schlägt sich selbst vor ✓ erledigt

*Feinschliff · Aufwand: mittel · Hub + App*

Die Standardartikel muss man von Hand pflegen. Der Hub weiss es besser: Er sieht seit Monaten, was wie oft auf der Liste landete. «Milch stand zuletzt vor 9 Tagen drauf, sonst alle 7» ist ein brauchbarer Vorschlag beim Öffnen der leeren Liste – als Chip zum Antippen, nicht als automatischer Eintrag.

Stellen: `hub: shopping_known`, `lib/einkauf.ts (artikelVorschlaege)`

### 177. Die Liste teilen, ohne die App zu verlangen ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Wer schnell jemanden bittet, unterwegs etwas mitzubringen, schickt heute ein Foto vom Bildschirm. Ein Teilen-Knopf, der die offenen Posten als Text ins Teilen-Blatt gibt (nach Gang sortiert) – dieselbe Mechanik wie beim Rezept-Teilen aus Punkt 149.

Stellen: `Vorbild: lib/rezepttext.ts`

### 207. Menge am Posten, ohne zu tippen ✓ erledigt

*lohnt sich · Aufwand: klein · App*

«2 Milch» wird heute erfasst, indem man den Text bearbeitet. Ein langer Druck auf den Posten könnte ein kleines +/– einblenden: einmal drücken, aus «Milch» wird «2 Milch», nochmal «3 Milch». Die reinen Helfer dafür (`mengeUndName`, `mitMenge`) liegen längst bereit – es fehlt nur der Griff.

Stellen: `src/lib/einkauf.ts:166`, `FamilyScreen.tsx (CheckRow)`

### 208. Woher kommt dieser Posten? ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Der Wocheneinkauf schreibt «250 g Kapern» auf die Liste, und im Laden fragt man sich: wofür nochmal? Die Herkunft geht beim Übertragen verloren. Ein kleines «aus Lasagne» unter dem Posten (beim Sammel-Einkauf mitgespeichert), Antippen öffnet das Rezept – dann entscheidet man im Laden auch, ob es die teuren Kapern sein müssen.

Stellen: `lib/einkauf.ts (ingredientsToShopping)`, `ShoppingDraft`

### 209. Mehrere Posten in einem Zug erfassen ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Nach dem Kühlschrank-Blick hat man fünf Dinge im Kopf und tippt fünfmal Feld–Plus–Feld. Das Eingabefeld sollte Kommas und Zeilenumbrüche verstehen: «Milch, Butter, 2 Zwiebeln» wird zu drei Posten, jeder mit seinem Gang. Eine reine Funktion mit fünf Zeilen Test – und das Diktieren übers Mikrofon funktioniert damit nebenbei auch.

Stellen: `family/bausteine.tsx (ShoppingAddRow)`


## Kontakte (178–182 · 210–212)

### 178. Mehr als Nummern: Mail, Adresse, Notiz ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Ein Kontakt trägt heute Nummern, Foto, Rolle und Geburtstag. Was im Alltag fehlt: die Adresse (mit einem Knopf «Route», die Karten-Anbindung gibt es schon), die Mail-Adresse (der Antrag an die Gemeinde geht nicht per Telefon) und ein Notizfeld («Praxis Mi geschlossen», «klingelt es zweimal»).

Stellen: `lib/familie.ts (nummernVon)`, `Vorbild: appleMapsRoute in TopStrip`

### 179. Aus dem Telefonbuch übernehmen statt abtippen ✓ erledigt

*lohnt sich · Aufwand: mittel · App*

Jeder Kontakt wird hier von Hand erfasst, obwohl er im Telefon längst steht – der häufigste Grund, warum die Liste dünn bleibt. Mit `expo-contacts` öffnet ein Knopf die Auswahl des Systems, und Name, Nummer und Foto kommen mit. Die Rolle vergibt man danach in zwei Tipps.

Stellen: `ContactForm in family/bausteine.tsx`, `neu: expo-contacts`

### 180. Geburtstage, an die rechtzeitig erinnert wird ✓ erledigt

*Feinschliff · Aufwand: klein · Hub*

Das Geburtstagsdatum steht am Kontakt und erscheint auf der Startseite («in 12 Tagen»). Was fehlt, ist der Anstoss, der etwas auslöst: eine Push drei Tage vorher – Zeit genug für ein Geschenk – und, wer mag, ein Eintrag im Kalender. Der Wächter macht ohnehin einen täglichen Lauf.

Stellen: `hub/homepilot/core/watchdog.py`, `daysUntilBirthday in bausteine.tsx`

### 181. Einen Kontakt weitergeben ✓ erledigt

*Feinschliff · Aufwand: klein · App*

«Schick mir die Nummer der Kinderärztin» endet in einem abgetippten Zettel. Ein Teilen-Knopf, der den Kontakt als vCard ins Teilen-Blatt gibt – dann landet er beim Empfänger direkt im Telefonbuch, statt in einem Chat zu versanden.

Stellen: `FamilyScreen.tsx (Kontakt-Karte)`

### 182. Nummern altern – und niemand merkt es ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Das Notfallblatt hat eine jährliche Prüfung (`notfallUeberfaellig`), die Kontakte nicht. Dieselbe leise Frage auch dort: Wer seit zwei Jahren unangetastet ist, bekommt ein «stimmt das noch?» – ein Tipp bestätigt, ein zweiter öffnet zum Ändern. Eine falsche Nummer merkt man sonst genau dann, wenn man sie braucht.

Stellen: `lib/familie.ts:161 (geprueftVor)`

### 210. «Jetzt geöffnet» neben der Nummer ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Bei der Praxis, der Apotheke und dem Coiffeur ruft man an – und landet mittwochs auf dem Band. Ein Öffnungszeiten-Feld am Kontakt und eine reine, testbare Funktion, die daraus «jetzt geöffnet · bis 18:30» oder «öffnet Mo 08:00» macht. Keine Anbindung an irgendein Verzeichnis: Was man einmal einträgt, stimmt für die fünf Nummern, die zählen.

Stellen: `lib/familie.ts (neu, rein)`, `FamilyScreen.tsx (Kontakt-Karte)`

### 211. «Zuletzt kontaktiert» schreibt sich selbst ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Punkt 182 fragt «stimmt die Nummer noch?» – die Antwort kennt die App zur Hälfte selbst: Wer auf Anrufen tippt, hat den Kontakt benutzt. Den Zeitpunkt still am Kontakt vermerken; was oft gebraucht wird, gilt als gepflegt, und die Alters-Frage stellt sich nur bei dem, was wirklich brachliegt.

Stellen: `FamilyScreen.tsx (tel:-Links)`, `ergänzt Punkt 182`

### 212. Die drei wichtigsten zuoberst ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Die Liste sortiert nach Rollen – aber angerufen werden immer dieselben drei. Ein Stern am Kontakt (wie im Rezeptbuch) hebt ihn in eine Schnellwahl-Reihe über der Liste: grosse runde Foto-Knöpfe, ein Tipp wählt. Zusammen mit 211 könnte die Reihe sich sogar selbst füllen.

Stellen: `FamilyScreen.tsx (Kontakte)`, `Vorbild: favorite im Rezeptbuch`


## Babysitter (183–187 · 213–215)

### 183. Der grosse Knopf: «Eltern anrufen» ✓ erledigt

*tut weh · Aufwand: klein · App + Hub*

Die Babysitter-Ansicht zeigt Notrufnummern und die freigegebenen Kontakte – aber die eine Nummer, die zuerst gewählt wird, steht zwischen den anderen. Ganz oben ein grosser Knopf, der beide Eltern nacheinander versucht (und bei Nichterreichen die hinterlegte Zweitperson), plus ein zweiter «Kurz melden», der eine Push aufs Eltern-Telefon schickt, ohne dass jemand mitten im Kino klingelt.

Stellen: `FamilyScreen.tsx (Babysitter-Ansicht)`, `lib/familie.ts (fuerBabysitter)`

### 184. Sehen, was der Babysitter sieht ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Der Zugang gibt Licht und Familie frei – ob das Blatt am Abend wirklich vollständig ist, merkt man erst, wenn angerufen wird. Ein Knopf «Vorschau: so sieht es der Babysitter», der die Ansicht mit dessen Rechten zeigt, macht die Lücken vorher sichtbar («keine Nummer hinterlegt», «WLAN fehlt»).

Stellen: `lib/familie.ts (BABYSITTER_FEATURES)`

### 185. Der Zugang meldet sich ab ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

Der Zugang läuft zur eingestellten Stunde ab – still. Zwei Nachrichten machen daraus etwas Verlässliches: an die Eltern «Babysitter-Zugang ist abgelaufen» und an den Babysitter kurz vorher «dein Zugang endet um 23:00». Und wenn es später wird: ein Knopf «noch eine Stunde», statt den Zugang neu anzulegen.

Stellen: `lib/familie.ts:248 (babysitterZugang)`, `hub: Gast-Ablauf`

### 186. Ein Abendprotokoll in drei Tippern ✓ erledigt

*Feinschliff · Aufwand: klein · App*

«Wann ist sie eingeschlafen? Hat er gegessen?» wird am Türrahmen gefragt und halb vergessen. Ein paar vorgefertigte Zeilen in der Babysitter-Ansicht (Znacht ✓, eingeschlafen 20:15, einmal aufgewacht), die als kurze Notiz stehen bleiben – für die Eltern beim Heimkommen und fürs nächste Mal.

Stellen: `FamilyScreen.tsx (Babysitter-Ansicht)`

### 187. Mehrere Babysitter, jeder mit eigenem Zugang ✓ erledigt

*Feinschliff · Aufwand: mittel · Hub + App*

Es gibt genau einen Benutzer «Babysitter» (`BABYSITTER_USER`), den sich alle teilen. Solange es eine Person ist, geht das; bei Nachbarin, Göttikind und Grosseltern steht im Zugriffsprotokoll dieselbe Zeile für drei Menschen. Je Person ein Zugang, dieselbe Freigabe – dann sieht man auch, wer wann da war.

Stellen: `lib/familie.ts:229 (BABYSITTER_USER)`, `hub/homepilot/core/users.py`

### 213. Die Hausadresse gehört aufs Blatt ✓ erledigt

*tut weh · Aufwand: klein · Hub + App*

Wer 144 wählt, muss als Erstes sagen, WO er ist – und genau das weiss ein Babysitter in einem fremden Haus oft nicht auswendig. Die Adresse steht heute nirgends: nicht im Abend-Formular, nicht auf dem Blatt. Ein Feld in der Hub-Konfiguration (einmal erfasst), gross über den Notrufnummern – auch für das eigene Notfallblatt richtig.

Stellen: `lib/familie.ts (ABEND_FELDER, notfallText)`, `hub: config location`

### 214. Die Abendroutine der Kinder steht schon im System ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Im Routinen-Modul ist der Abendablauf der Kinder erfasst – und im Abend-Formular für den Babysitter tippt man ihn unter «Ins Bett um» noch einmal ab. Die passende Routine auf dem Babysitter-Blatt einblenden (Zähne, Geschichte, Licht aus um 19:30), dann ist das Blatt so genau wie das, was die Familie selbst lebt.

Stellen: `FamilyScreen.tsx (Babysitter + routines)`

### 215. Wenn es klingelt, sieht der Babysitter nichts ✓ erledigt

*lohnt sich · Aufwand: mittel · App + Hub*

Das Klingel-Vollbild mit Kamerabild wohnt auf der Startseite – die der Babysitter-Zugang bewusst nicht umfasst. Ergebnis: Es klingelt, und die fremde Person im Haus kann nur raten. Das Vollbild (Bild und Wegwischen, ohne Türöffner!) auch im Babysitter-Umfang zeigen: sehen, wer da ist, ist Sicherheit – öffnen bleibt Sache der Familie.

Stellen: `DashboardScreen.tsx (Türklingel-Vollbild)`, `lib/familie.ts (BABYSITTER_FEATURES)`


## Rezeptbuch (188–193 · 216–218)

### 188. Grossmutters Rezept abfotografieren ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Der Link-Import (136) deckt das Netz ab. Was er nicht deckt: die handgeschriebene Karte im Holzkasten. Ein zweites Foto am Rezept – nicht als Titelbild, sondern als «Original» – bewahrt die Handschrift, und die Zutaten tippt man in Ruhe daneben ab. Zum Kochen ist es dann egal, welcher Teil zuerst da war.

Stellen: `RecipeBook.tsx (RecipeForm)`

### 189. Weiterblättern, ohne den Bildschirm zu treffen ✓ erledigt

*lohnt sich · Aufwand: klein · App · Darstellung*

Im Kochmodus hat man Teig an den Händen – und muss trotzdem einen Knopf am unteren Rand treffen. Die ganze rechte Bildschirmhälfte als «Weiter» und die linke als «Zurück» (Wischen zusätzlich), mit den bestehenden Knöpfen als sichtbarem Hinweis. Ein Knöchel genügt dann.

Stellen: `RecipeBook.tsx (CookMode)`

### 190. Wie war es beim letzten Mal? ✓ erledigt

*Feinschliff · Aufwand: mittel · App*

Das Notizfeld ist eines für alle und wird überschrieben. Aus einem gekochten Rezept wird aber über Jahre ein besseres: «zu salzig» (Mai), «180° statt 200°» (Juli), «Kinder mochten die Kapern nicht». Nach dem «Fertig ✓» im Kochmodus eine kurze Frage, die eine datierte Zeile anlegt – und in der Detailansicht stehen sie untereinander wie ein Kochtagebuch.

Stellen: `RecipeBook.tsx (onCooked, notes)`

### 191. Ein Rezept auf Papier ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Manchmal will man das Blatt neben den Herd legen, statt das iPad in die Küche zu tragen – und beim Verschenken eines Familienrezepts erst recht. Eine druckbare Seite (Titel, Portionen, Zutaten, Schritte, ohne App-Beiwerk) über `expo-print`: als PDF teilen oder direkt drucken.

Stellen: `lib/rezepttext.ts (Textform steht schon)`

### 192. Was koche ich aus dem, was da ist? ✓ erledigt

*Feinschliff · Aufwand: mittel · App*

Der Vorschlag aus Punkt 139 fragt nach dem Kalender, nicht nach dem Kühlschrank. Ein Gegenstück: zwei, drei Zutaten antippen («Hackfleisch, Rahm») und sehen, welche Rezepte damit auskommen – samt der ehrlichen Angabe, was noch fehlt («ohne Tomatenpüree»). Die Zutatensuche gibt es bereits, ihr fehlt nur die Umkehrung.

Stellen: `RecipeBook.tsx (matchesSearch)`, `neu in src/lib/`

### 193. Rezepte mit Fotos brauchen einen eigenen Weg ✓ erledigt

*Feinschliff · Aufwand: klein · Hub + App*

Elf Rezepte mit Bildern sind gut ein Megabyte, und alle liegen in `hub.data` – bei jedem Öffnen der Familienseite geht das komplett über die Leitung. Bei fünfzig Rezepten wird das spürbar. Die Bilder gehören neben die Daten (eine Datei je Rezept, ausgeliefert unter `/api/recipes/{id}/bild`), damit der Browser sie zwischenspeichern kann.

Stellen: `api/routes/family.py`, `Vorbild: api/routes/passes.py`

### 216. Kategorien einmal aufräumen ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Der Import aus der alten App brachte «dinner», «drink» und «dessert» mit, von Hand entstand daneben Deutsches – die Filterleiste zeigt beide Welten. Die Chips aus Punkt 137 verhindern Neues, heilen aber den Bestand nicht. Ein «Kategorie umbenennen» (dinner → Znacht), das alle betroffenen Rezepte in einem Zug umschreibt – dieselbe Überlegung wie beim Geräte-Ersetzen.

Stellen: `RecipeBook.tsx (categories)`, `Vorbild: core/replace.py`

### 217. Das Rezept merkt sich deine Portionen ✓ erledigt

*Feinschliff · Aufwand: klein · App*

Das Rezept steht auf 4, gekocht wird immer für 6 – und bei jedem Öffnen stellt man wieder um. Die zuletzt gewählte Portionenzahl je Rezept im Gerät merken und beim nächsten Öffnen vorwählen. Drei Zeilen AsyncStorage, jeden Tag einen Handgriff weniger.

Stellen: `RecipeBook.tsx (RecipeDetail, servings)`

### 218. Der Wochenplan füttert «zuletzt gekocht» ✓ erledigt

*lohnt sich · Aufwand: klein · Hub*

«Zuletzt gekocht» entsteht heute nur, wer den Kochmodus bis zum Fertig-Haken durchläuft – die Lasagne, die man auswendig kann, zählt nie. Dabei weiss es der Plan: Stand ein Gericht am Dienstag im Wochenplan und der Dienstag ist vorbei, war es dran. Den Stempel (samt Zähler) daraus ableiten – dann stimmen auch die Vorschläge aus Punkt 139 und die «Klassiker»-Sortierung.

Stellen: `core/watchdog.py (täglicher Lauf)`, `family_meals → recipes`


## Ortung und Anwesenheit (194–203 · 219–221)

### 194. Die App soll selbst merken, wann jemand kommt ✓ erledigt

*tut weh · Aufwand: gross · App*

Heute meldet nicht die App den Ortswechsel, sondern ein iOS-Kurzbefehl, den jede Person einmal von Hand baut – und der still stirbt, wenn jemand ein neues Telefon einrichtet. Die App weiss vom Standort gar nichts (`expo-location` ist nicht einmal installiert). Eingebautes Zonen-Überwachen nimmt die Bastelei weg: einmal einrichten, danach meldet jedes Telefon von selbst. Ehrlich zu den Kosten: Das braucht einen eigenen App-Build, die Berechtigung «Standort immer» und eine gute Begründung im Dialog. Und es muss Region Monitoring sein, kein laufendes GPS – sonst ist der Akku am Nachmittag leer, und die Ortung wird abgeschaltet statt genutzt.

Stellen: `neu: expo-location (Region Monitoring)`, `hub: /api/presence/geofence steht schon`

### 195. Eine Zone ist heute nur ein Name ✓ erledigt

*lohnt sich · Aufwand: klein · Hub*

In der Konfiguration steht je Person eine Zone mit `id` und `name` – wo dieser Ort liegt, weiss der Hub nicht. Das genügt, solange jedes Telefon seine Zone selbst kennt, und ist genau der Grund, warum jede Person alles neu einrichten muss. Zonen mit Koordinaten und Radius im Hub («Zuhause», «Schule», 150 m) sind die Voraussetzung für Punkt 194: Dann holt sich jedes Gerät dieselben Zonen, und eine geänderte Adresse ändert man einmal.

Stellen: `hub/homepilot/integrations/geofence.py (parse_zones)`

### 196. «Wer ist da?» gehört auf die Familienseite ✓ erledigt

*tut weh · Aufwand: klein · App*

Die Anwesenheit steht heute als Gerätekachel zwischen Lampen und Storen – dabei ist sie die meistgestellte Frage im Haushalt. Eine ruhige Zeile zuoberst auf der Familienseite: wer zuhause ist, wer unterwegs, und seit wann. Ohne Karte, ohne Meterangaben: «Sandra zuhause · Stefan unterwegs seit 14:20» beantwortet, was man wissen will.

Stellen: `FamilyScreen.tsx`, `geofence.* und unifi.anyone_home`

### 197. Geortet zu werden muss man sehen – und aussetzen können ✓ erledigt

*tut weh · Aufwand: klein · App + Hub*

Sobald die App selbst ortet (194), ändert sich die Frage: Nicht «geht das technisch», sondern «weiss jeder, dass es läuft». Drei Dinge gehören zusammen: eine Zeile im eigenen Profil, die zeigt, dass die eigene Ortung aktiv ist und wer sie sieht; ein Schalter «Ortung pausieren» (2 Stunden / bis morgen), der auch wirklich pausiert statt nur zu verstecken; und Gäste, die grundsätzlich nie geortet werden. Ein Familiensystem, dem man beim Orten nicht zusehen kann, wird abgeschaltet – zu Recht.

Stellen: `UsersScreen (Profil)`, `hub: users.py (Rollen, Gäste)`

### 198. Mehr Orte als «zuhause» und «weg» ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub + App*

Eine Zone je Person kennt nur zwei Zustände. Der Alltag hat mehr: Schule, Arbeit, Turnhalle, bei den Grosseltern. Mit mehreren Zonen (Punkt 195) wird aus dem Zustand ein Ortsname – «Livia: Schule» – und Abläufe können darauf hören («wenn Livia die Schule verlässt, Nachricht an Sandra»). Die Ablauf-Auslöser gibt es bereits, sie kennen nur noch keine zweite Zone.

Stellen: `integrations/geofence.py`, `automations/entwurf.ts (kind: geofence)`

### 199. «Livia ist angekommen» ✓ erledigt

*lohnt sich · Aufwand: klein · App (Vorlage)*

Der Fall, für den Familien so etwas überhaupt einrichten: Das Kind ist von der Schule heimgekommen – oder eben noch nicht. Eine Nachricht an die Eltern beim Betreten einer Zone, wahlweise nur zu bestimmten Zeiten (werktags 15–18 Uhr), damit nicht jede Heimkehr piepst. Und die stille Umkehrung, die man erst schätzt, wenn sie fehlt: «um 17:30 immer noch nicht zuhause».

Stellen: `automations/vorlagen.ts`, `Auslöser «Ort» gibt es schon`

### 200. WLAN und Standort widersprechen sich ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub*

Es gibt zwei Quellen für dieselbe Frage: die WLAN-Anmeldung über UniFi und den Geofence. Sie sind unterschiedlich schnell und unterschiedlich verlässlich – das Telefon bucht sich aus, wenn es im Garten liegt; der Geofence meldet «weg», während das Telefon längst wieder im Netz ist. Wer beides ungeprüft nebeneinander stellt, bekommt eine Alarmanlage, die scharf schaltet, während jemand im Haus ist. Eine zusammengeführte Anwesenheit je Person mit klarer Regel («WLAN schlägt Geofence, solange es frisch ist») und einer Anzeige, woher der Wert kommt.

Stellen: `integrations/unifi.py (anyone_home)`, `integrations/geofence.py`

### 201. Zehn Minuten Vorsprung statt zwei ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub + App*

Der Geofence meldet den Übertritt einer Grenze – ab dann bleiben ein paar Minuten. Für die Heizung ist das knapp. Eine zweite, weite Zone («Quartier», 3 km) gibt den Vorlauf, den die Kommentare in `geofence.py` selbst als Grund nennen: Bei Betreten der weiten Zone Richtung Haus die Heizung hochfahren, bei der engen erst das Licht. Zwei Zonen genügen; eine echte Ankunftszeit aus Fahrtrichtung und Verkehr wäre viel Aufwand für wenige Minuten.

Stellen: `integrations/geofence.py (Kopfkommentar)`

### 202. Ein leerer Akku ist kein «niemand zuhause» ✓ erledigt

*tut weh · Aufwand: klein · Hub*

Meldet ein Telefon nichts mehr – Akku leer, Flugmodus, Kurzbefehl gelöscht –, bleibt der letzte Zustand für immer stehen. Steht dort «away», schaltet «Alles aus, wenn niemand da» irgendwann das Haus ab, während jemand darin sitzt. Genau dieselbe Falle wie beim Geschirrspüler, nur mit grösseren Folgen. Deshalb: Wer sich zwölf Stunden nicht gemeldet hat, gilt als «unbekannt», nicht als «weg» – und Abläufe, die auf Abwesenheit hören, laufen dann nicht.

Stellen: `integrations/geofence.py (report)`, `vgl. vzug: unfrozen_status`

### 203. Kommen und Gehen vergisst der Hub wieder ✓ erledigt

*Feinschliff · Aufwand: klein · Hub*

Sobald Zeitpunkte mitgeschrieben werden (196, 199), entsteht nebenbei ein Bewegungsprofil der Familie in `hub.data` – dieselbe Datei, die in die Sicherung wandert. Nützlich ist davon nur das Jüngste: «seit wann weg», «wann angekommen». Also von vornherein begrenzen: Ortswechsel höchstens sieben Tage behalten, danach löschen. Kein Verzicht, sondern eine Entscheidung, die man einmal trifft statt nie.

Stellen: `core/persistence.py`, `vgl. core/energy.py (HOUR_LIMIT)`

### 219. Warum steht da «weg»? Die Ortungs-Diagnose ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

Bei den Abläufen beantwortet /diagnose die Frage «warum schweigt der?» – für die Anwesenheit fehlt das Gegenstück. Je Person eine Zeile: wann die letzte Meldung kam, über welchen Weg (Kurzbefehl, WLAN), und ob das nach Funkstille aussieht. Der halbe Support-Fall «die Ortung spinnt» ist damit selbst zu beantworten.

Stellen: `Vorbild: automations diagnose`, `integrations/geofence.py`

### 220. Das Telefon meldet seinen Akku mit ✓ erledigt

*Feinschliff · Aufwand: klein · Hub*

Die häufigste Ursache für eine tote Ortung ist ein leeres Telefon – und das kündigt sich an. Die Meldung an /api/presence/geofence kann den Akkustand mitschicken (ein Feld mehr, der Kurzbefehl kennt ihn); unter 15 % warnt der Wächter: «Livias Telefon 12 % – die Ortung fällt gleich aus.» Passt zu 202, das den Ausfall danach ehrlich macht.

Stellen: `api/models.py (GeofenceRequest)`, `core/watchdog.py`

### 221. «Ihr seid weg – Ferienmodus?» ✓ erledigt

*Feinschliff · Aufwand: klein · Hub*

Die Anwesenheitssimulation (presence_sim, Vorlage 156) muss jemand scharf schalten – und genau das vergisst man beim Kofferpacken. Sind alle seit 24 Stunden weg und die Simulation ist aus, fragt eine einzelne Push nach: «Ferienmodus einschalten?» Eine Frage, keine Automatik – wer nur ein Wochenende weg ist, wischt sie weg.

Stellen: `integrations/presence_sim.py`, `core/watchdog.py`



# Teil V: Weiteres (ab 222)

## Nach dem Einchecken der Liste (222–)

### 222. Grundriss-Ansicht fürs Wandpanel ✓ erledigt

*Aufwand: gross · Hub + App*

Wer im Flur aufs iPad schaut, denkt nicht in einer Kachelliste, sondern
in «das Licht da hinten links». Ein Foto des Wohnungsplans mit den
Geräten als antippbaren Punkten beantwortet das direkt: antippen
schaltet, der Zustand färbt den Punkt. Einschaltbar je Gerät in den
Einstellungen beim App-Symbol; Bild und Punkte liegen auf dem Hub und
gelten für alle. Punkte werden durch Antippen gesetzt und versetzt,
bewusst ohne Ziehen – die Ziehen-Geste hat auf iOS zweimal getäuscht,
zwei Tipps kann jede Plattform.

Stellen: `hub/homepilot/core/grundriss.py`, `hub/homepilot/api/routes/grundriss.py`, `app/src/components/Grundriss.tsx`, `app/src/lib/grundriss.ts`

### 223. Durchsagen mit eigener Stimme zurückbringen ⏳ Probelauf offen

*Aufwand: mittel · App*

Die Aufnahme am Telefon lief über `expo-audio` - und genau dieses Paket
hat die App vom 29. bis 31. August auf jedem Gerät wortlos schwarz
starten lassen: Sein nativer Teil fasst schon beim App-Start die
AVAudioSession an, und gegen ein Hängen dort hilft kein JavaScript-Netz.
Es ist deshalb ganz aus dem Build genommen; die Vorlesestimme und der
Browser-Weg (MediaRecorder) gehen weiter.

Zurück darf die Funktion nur mit einer Fassung, deren Start nachweislich
nichts anfasst - neuere expo-audio-Version prüfen (das OnCreate mit
`AVAudioSession.sharedInstance()` ist der kritische Punkt) oder ein
eigenes schlankes Aufnahme-Modul, das erst beim Druck auf den
Aufnahmeknopf initialisiert. In jedem Fall: erst ein TestFlight-
Probelauf auf iPhone **und** Wandpanel, dann ausrollen. Die
Absturzgeschichte steht im CHANGELOG (2026-09-01) und in
`app/src/lib/aufnahme-nativ.ts`.

Umgesetzt als eigenes Modul `modules/aufnahme` (AVAudioRecorder, ~100
Zeilen Swift): kein `OnCreate`, kein Beobachter, kein Zugriff auf die
AVAudioSession vor dem Druck auf den Aufnahmeknopf. Mit dem Modul
steigt die Laufzeit auf 4 - der TestFlight-Probelauf auf iPhone und
Wandpanel steht noch aus; erst danach gilt der Punkt als erledigt.

Stellen: `app/modules/aufnahme/`, `app/src/lib/aufnahme-nativ.ts`, `app/src/lib/sprachnotiz.ts`

