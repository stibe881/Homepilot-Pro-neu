# Die Werkbank – Archiv

Was erledigt ist, mit der Begründung, aus der es entstand. Die Liste
dessen, was **offen** ist, steht nebenan in `werkbank.md`; diese Datei
ist ihr Gedächtnis.

Getrennt wurden die beiden, weil eine Datei nicht beides kann (Punkt
505): Auf viertausend Zeilen, in denen neunzig Prozent erledigt sind,
lässt sich «was ist offen?» nicht in dreissig Sekunden beantworten.
Zwanzig Minuten hat es gedauert, und danach war man sich immer noch
nicht sicher.

**Die Nummern bleiben, wo sie sind.** Kommentare im Code verweisen mit
«Punkt NNN der Werkbank» auf genau diese Nummern - deshalb wird **nie
umnummeriert**, auch nicht bei erledigten, gestrichenen oder nie
gebauten Punkten. Wer einen Punkt sucht, sucht ihn in beiden Dateien:

    grep -n "^### 155\.\|^\*\*155\." docs/werkbank*.md

Die Begründungen («warum») bleiben absichtlich stehen. Sie beschreiben
den Fehlerfall, gegen den der Code heute geschützt ist, und sind damit
die Vorgeschichte zu den «warum»-Kommentaren im Code. Genau deshalb
werden sie archiviert und nicht gelöscht.

| Punkte | Entstanden als | Blick |
| --- | --- | --- |
| 1–100 | Werkbank (erste Durchsicht des ganzen Repos) | Technik, Betrieb, Auslieferung |
| 101–135 | Durchsicht (Abläufe, Szenen, Räume, Widgets, Rezepte) | Funktionslücken |
| 136–164 | Küche & Abläufe | Rezeptbuch und Ablauf-Editor |
| 165–221 | Familie & Haushalt | Familienlisten, Kontakte, Ortung |
| 224–243 | Zweite Durchsicht | Wärme, Strom, Betrieb, und die Fehler einer Woche |
| 244–267 | Auf Zuruf (September 2026) | Benutzer und Zugang, Bedienung, Abläufe, Sicherheit |
| 268–420 | Achtundachtzig Vorschläge (September 2026) | App, Bedienung, Gestaltung, Gutscheine, Abläufe, Push, Alarm, Haus |
| 421–505 | Fünfundachtzig Vorschläge (September 2026) | dieselben acht Bereiche, eine Runde später |
| 506–509 | Auf einem anderen Zweig, derselbe Abend | Klingeltöne, Räume-Seite, Kontoeinstellungen |
| 510–533 | Zweite Vorschlagsrunde des anderen Zweigs | Abläufe, Push, Alarm, Gutscheine, Gestaltung |

Die Häkchen tragen die Commit-Kürzel von den Werkbank-Seiten; ganz alte
können hinter der flachen Klon-Grenze liegen.

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

### 11. Kein `KeyboardAvoidingView` in der ganzen App ✓ erledigt (2cddf53) · nachgebessert in 265

*lohnt sich · Aufwand: klein · App*

Kein einziges Vorkommen. Auf dem Telefon schiebt sich die Tastatur über Eingabefelder in Fenstern — auch über das Feld der Einkaufsliste, das ich gerade eingebaut habe. Auf dem iPad fällt es kaum auf, auf dem iPhone sofort.

Erledigt wurde damals genau ein Fenster: das der Einkaufsliste, an dem
es auffiel. «In der ganzen App» stand im Titel und blieb offen — zwölf
weitere Fenster kamen seither dazu, jedes mit demselben Fehler. Siehe
Punkt 265; dort steht auch der Test, der das Zählen künftig übernimmt.

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

# Teil V: Zweite Durchsicht (224–243)

Zwanzig Punkte, wieder aus dem Code gelesen und gegen die 223
bestehenden geprüft – einiges Naheliegende fiel dabei weg, weil es
längst gebaut war (Sturmschutz für die Storen, das Nachhaken bei der
Wäsche, der Papierkorb, die Watch-App, der Monats- und
Vorjahresvergleich beim Strom).

Die letzten sieben stünden hier nicht, wenn die Abende davor glatt
gelaufen wären. Sie benennen nicht den einzelnen Fehler, sondern das
Loch, durch das er gekommen ist.

## Wärme (224–226)

Der grösste weisse Fleck: Es gibt keine Entitätsart `climate`. Der Hub
kennt Licht, Schalter, Storen, Schlösser, Sauger, Wetter – und
Temperatur nur als Messwert.

### 224. Die Heizung kann der Hub nur lesen, nicht stellen — gestrichen

*tut weh · Aufwand: gross · Hub + App*

Gestrichen im September 2026 auf Entscheid: Die Heizung bleibt aussen
vor, samt 225 und 226, die darauf aufbauen.

Die Klima-Übersicht zeigt jeden Raum mit Temperatur und Feuchte und ist
eine reine Anzeige. Einen Sollwert setzen kann im ganzen System nur der
Grill – der einzige `set_temperature`-Aufruf der App steht in der
Grillkachel. Es fehlt die Entitätsart selbst und alles, was darauf
aufbaut: Soll-Temperatur je Raum, Betriebsart, Boost, ein Schritt im
Ablauf-Editor. Solange sie fehlt, ist die teuerste Energie im Haus die
einzige, die HomePilot nicht anfasst.

Stellen: `hub/homepilot/core/entity.py`, `app/src/components/ClimateOverview.tsx`, `hub/homepilot/integrations/zigbee2mqtt.py`

### 225. Fenster auf, Heizung läuft weiter — gestrichen

*Aufwand: klein · Hub · braucht 224*

Gestrichen mit 224.

Die Kontaktsensoren sind da, und der Wächter liest sie längst – er zählt
die offenen Fenster für die Alarmanlage und meldet, wenn eines zu lange
offen steht. Was er nicht kann: die Heizung in diesem Raum
zurücknehmen und danach wieder freigeben. Der Sensor weiss es, der
Heizkörper erfährt es nie.

Stellen: `hub/homepilot/core/watchrules.py` (`open_contacts`)

### 226. Heizen nach Plan und Anwesenheit statt nach Dauerwert — gestrichen

*Aufwand: mittel · Hub · braucht 224*

Gestrichen mit 224.

Der Hub weiss, wer zuhause ist, wann Schulferien sind, wann jemand ins
Bett geht und wie weit weg jemand gerade ist – alles gebaut, alles
getestet. Für die Heizung wäre genau das die Antwort auf «warum ist es
kalt, wenn ich heimkomme»: absenken, sobald alle weg sind, vorheizen,
sobald die Entfernung schrumpft.

Stellen: `hub/homepilot/core/presence.py`, `core/goodnight.py`, `core/schulferien.py`

## Luft und Strom (227–229)

### 227. Feuchte ohne Rat: wann lüften sich lohnt — gestrichen

*Aufwand: klein · Hub + App*

Gestrichen im September 2026 auf Entscheid.

Die Klima-Übersicht färbt die Feuchte, wenn sie aus dem Band läuft, und
lässt den Bewohner damit allein. Ob Lüften hilft, hängt aber vom
Vergleich mit draussen ab: Kalte Winterluft trocknet, schwüle Sommerluft
macht es schlimmer. Beide Werte hat der Hub – der eine vom Sensor, der
andere von Open-Meteo.

Stellen: `app/src/lib/komfort.ts`, `hub/homepilot/integrations/weather.py`

### 228. Der Hub kennt genau einen Strompreis — gestrichen

*Aufwand: mittel · Hub + App*

Gestrichen im September 2026 auf Entscheid: Der eine Preis bleibt,
samt 229, das darauf aufbaut.

Die Energieseite rechnet alles gegen einen einzigen `price_per_kwh`:
Tageskosten, Jahreshochrechnung, Standby-Kosten, die Rangliste der
grössten Verbraucher. In der Schweiz stimmt das an keinem Tag. Die
Stundenwerte werden bereits mitgeschrieben; ohne Tarifzeiten sind die
Franken systematisch daneben.

Stellen: `hub/homepilot/core/energy.py`

### 229. Die Waschküche weiss nichts vom günstigen Tarif — gestrichen

*Aufwand: klein · Hub · braucht 228*

Gestrichen mit 228.

Der Hub hakt nach, bis die Wäsche aus der Trommel ist. Es fehlt die
andere Hälfte: der Hinweis vorher. Wer um zwanzig vor neun eine Maschine
startet, zahlt zwanzig Minuten Hochtarif für nichts.

Stellen: `hub/homepilot/core/waschkueche.py`, `hub/homepilot/integrations/vzug.py`

## Betrieb (230–234)

### 230. Zigbee meldet seine Funkqualität, niemand liest sie ✓ erledigt (d3dff34)

*Aufwand: klein · Hub + App*

Jede Zigbee-Meldung trägt eine `linkquality` mit, und die Integration
übernimmt sie in den Zustand. Ausgewertet wird sie nie. Dabei ist sie
die Frühwarnung schlechthin: Ein Gerät, dessen Wert seit Wochen fällt,
meldet sich irgendwann gar nicht mehr – und dann sucht man den Fehler
bei der Batterie. Für Batterien gibt es diese Vorsorge längst, samt
Prognose.

Stellen: `hub/homepilot/integrations/zigbee2mqtt.py`, `hub/homepilot/core/batterieprognose.py`

### 231. Der Hub kann zurück auf den vorigen Stand, die App nicht ✓ erledigt (5a1bdb7)

*tut weh · Aufwand: mittel · Repo*

Das Bau-Skript hebt das alte Abbild als `:prev` auf und fällt bei einem
misslungenen Start von selbst darauf zurück. Für die nachgeladene
App-Fassung gibt es nichts dergleichen: Wer eine kaputte Fassung
veröffentlicht, kann sie nur durch eine neue ersetzen – zweimal
komplett beenden, und in der Zwischenzeit ist die App unbrauchbar.

Stellen: `deploy/rebuild-hub.sh`, `deploy/ota-aufraeumen.sh`

### 232. Eine Anbindung, die dauernd neu verbindet, fällt niemandem auf ✓ erledigt

*Aufwand: klein · Hub*

Der Wächter kannte zwei Zustände: erreichbar oder nicht. Die
Zwischenstufe fehlte, und sie ist die häufigste – der Fernseher, der
alle paar Minuten die Verbindung verliert und wieder aufbaut. Nach
aussen sieht das aus wie Betrieb: Der Ausfallmelder hat eine Karenz von
Minuten und greift nie. Kosten tut es trotzdem, und Befehle
verschwinden in einer gerade zumachenden Leitung – genau so gingen
monatelang die Tastendrücke an den Fernseher verloren.

Umgesetzt: Flanken statt Pegel, am Ereignis gezählt (eine Unterbrechung
von zwanzig Sekunden fällt zwischen zwei Minutenrunden sonst heraus).
Ab sechs Rückkehrern je Stunde eine Meldung, und erst nach einer ganzen
ruhigen Stunde wieder eine.

Stellen: `hub/homepilot/core/flattern.py`, `hub/homepilot/core/watchdog.py`

### 233. Nichts prüft, ob Hub und App noch dieselbe Sprache sprechen ✓ erledigt (5a1bdb7)

*Aufwand: mittel · Repo*

Die App beschreibt in `types.ts`, wie die Antworten des Hubs aussehen –
und der Hub weiss davon nichts. Wer im Hub ein Feld umbenennt, bekommt
weder vom Typprüfer noch von den Tests ein Wort zu hören: Beide Seiten
sind für sich sauber. Auffallen tut es erst auf dem Telefon, als leere
Kachel.

Stellen: `app/src/api/types.ts`, `hub/homepilot/api/routes/`

### 234. Antwortet Supabase nicht, kommt niemand mit Passwort ins Haus ✓ erledigt (5ed560e)

*tut weh · Aufwand: mittel · Hub*

Die Anmeldung mit E-Mail und Passwort schaltet sich selbst ab, sobald
der Dienst fehlt. Das ist ehrlich, heisst aber: Ein Ausfall irgendwo im
Internet sperrt die Familie aus ihrem eigenen Haus aus, obwohl Hub,
Telefon und WLAN im selben Raum stehen. Der Hub kennt seine Benutzer
selbst.

Umgesetzt: Nach jeder erfolgreichen Online-Anmeldung führt der Hub
einen gesalzenen Hash lokal nach (in den `emails`-Zeilen, die als
SECRETS nie in einen Export wandern) und fällt bei Netz- und
Serverfehlern darauf zurück. Ein von Supabase abgelehntes Passwort
fällt bewusst nicht zurück – sonst bliebe ein zurückgesetztes Passwort
lokal ewig gültig.

Stellen: `hub/homepilot/api/routes/auth.py`, `hub/homepilot/core/supabase_auth.py`

## Haushalt und Griff (235–236)

### 235. Der Abfuhrkalender fehlt — gestrichen

*Aufwand: klein · Hub + App*

Gestrichen im September 2026 auf Entscheid.

Kehricht, Grünabfuhr, Karton, Metall: feste Termine, die jede Gemeinde
veröffentlicht, und die einzige Hausaufgabe, die man am Vorabend
erledigen muss oder zwei Wochen liegen lässt. Der Hub führt Feiertage
und Schulferien bereits als eigene Kalender mit – dieselbe Bauart.

Stellen: `hub/homepilot/core/schulferien.py`, `core/feiertage.py`, `core/erinnerungen.py`

### 236. Siri kann die vorhandenen Knöpfe nicht drücken — gestrichen

*Aufwand: klein · App*

Gestrichen im September 2026 auf Entscheid.

Im Widget stecken fertige App-Intents – `SchaltIntent` schaltet ein
Gerät, `TuerOeffnenIntent` öffnet die Tür, beide mit Rückfrage und
Rechteprüfung. Es fehlt nur ein `AppShortcutsProvider` mit den Sätzen
dazu. Ohne ihn bleibt die Arbeit auf den Sperrbildschirm beschränkt.

Stellen: `app/targets/widget/index.swift`

## Aus den Fehlern dieser Woche (237–243)

### 238. Kein Prüfstand für die Häufigkeit einer Meldung ✓ erledigt

*Aufwand: mittel · Repo*

Es gab Tests dafür, ob eine Push kommt und wie sie heisst – keinen
einzigen dafür, wie oft. Genau daran ist die Akku-Warnung
durchgerutscht: Jeder einzelne Durchgang war für sich richtig, erst die
Reihe ergab den Fehler.

Umgesetzt: `tests/pushstand.py` lässt den Wächter Runden laufen, lässt
die Welt sich dazwischen ändern und zählt. Nachgewiesen an der alten
Fassung – mit `elif not text` im Wächter fällt die Zusage um.

Stellen: `hub/tests/pushstand.py`, `hub/tests/test_pushhaeufigkeit.py`

### 239. Blätter leben in Kacheln statt am Bildschirm ✓ erledigt

*tut weh · Aufwand: mittel · App*

Musikliste und Fernbedienung standen mitten im Kachelkörper, zwischen
Knöpfen, deren Bedingungen sich im Betrieb ändern. Ein Blatt
verschwindet aber, sobald die Bedingung darüber falsch wird: Die
Fernbedienung hing an «der Fernseher meldet an», und ein Android TV
meldet nach jedem Tastendruck kurz «aus».

Umgesetzt: beide an den Kachelfuss, zu den übrigen Blättern, und nur
noch an Geräteart und Befehlsliste gehängt. Die Regel samt Begründung
steht in `lib/blattgrund.ts`.

Stellen: `app/src/lib/blattgrund.ts`, `app/src/components/EntityCard.tsx`

### 240. Die Browser-Probe ist Handarbeit und liegt nicht im Repo ✓ erledigt

*Aufwand: klein · Repo*

Sie stand eine Seite lang in der CLAUDE.md, und jede Sitzung baute sie
von Hand nach – samt einer Wegwerf-Integration, die danach wieder
gelöscht wurde. Ein Werkzeug, das man vor jedem Gebrauch zusammensetzt,
benutzt man zu selten.

Umgesetzt: `scripts/probe.sh` mit drei Messungen, jede aus einem echten
Fehler. Dass sie misst, ist nachgewiesen: Mit dem alten Fehler meldet
sie «12-mal aus dem Dokument geflogen». Dafür hat der Gremlin einen
zappeligen Fernseher bekommen.

Stellen: `scripts/probe.sh`, `scripts/probe.mjs`, `hub/homepilot/integrations/gremlin.py`

### 241. Drei Zweige von Hand gleich halten ✓ erledigt

*Aufwand: klein · Repo*

Der teure Fall ist nicht der abgelehnte Push, den sieht man. Teuer ist
der Zweig, der still zurückfällt: eingecheckt, geprüft, grün – nur
nicht dort, wo gebaut wird.

Umgesetzt: `deploy/zweige.py pruefen` beantwortet die Frage und ändert
nichts; `stossen` führt zusammen und stösst auf alle. Mit Gewalt nie.

Stellen: `deploy/zweige.py`, `hub/tests/test_zweige.py`

### 242. Die App sagt nicht, dass sie eine Fassung gar nicht bekommen kann — gestrichen

*tut weh · Aufwand: klein · App*

Gestrichen im September 2026 auf Entscheid.

Unter System steht, welche Fassung läuft und ob sie mitgeliefert oder
nachgeladen ist. Was dort nicht steht, ist das Entscheidende: ob die App
die nächste überhaupt annehmen *kann*. Ändert sich die Laufzeit, ist der
Kanal zu, und jede weitere Auslieferung geht am Telefon vorbei – diese
Woche zweimal passiert, beide Male sah alles richtig aus.

Stellen: `app/src/screens/SystemScreen.tsx`, `app/app.json`

### 243. Der Hub weiss nicht, welche Fassung auf welchem Telefon läuft — gestrichen

*Aufwand: klein · Hub + App*

Gestrichen im September 2026 auf Entscheid, zusammen mit 242.

Die App meldet dem Hub Standort, Push-Token und Gerätenamen – ihre
eigene Version nie. Deshalb kann niemand die Frage beantworten, die nach
jeder Auslieferung als Erstes kommt: «Ist es angekommen?»

Stellen: `hub/homepilot/core/sessions.py`, `app/src/api/client.ts`


# Teil VI: Auf Zuruf (244–267)

Punkte aus Durchsichten im September 2026, auf Zuruf ausgewählt und
umgesetzt. Gleichzeitig wurden 224–227, 228–229, 235–236 und 242–243
bewusst gestrichen – die Begründungen stehen dort.

## Benutzer und Zugang (244–246)

### 244. Selbstverwaltung fürs eigene Konto ✓ erledigt (5ed560e, 916d22f)

*lohnt sich · Aufwand: mittel · Hub + App*

Ein Bewohner konnte sein Passwort nur beim erzwungenen Erst-Wechsel
ändern, und niemand sah, welche Geräte unter seinem Namen angemeldet
waren – dabei hielt der Hub die Sitzungsliste längst. Neu: Ein Blatt
«Konto» mit Passwortwechsel (beendet alle anderen Sitzungen) und
«Meine Geräte» (aktuelle Sitzung markiert, einzelne beendbar, das
Wandtablet erkennbar).

Stellen: `hub/homepilot/api/routes/auth.py`, `hub/homepilot/core/sessions.py`, `app/src/lib/konto.ts`

### 245. Eine echte Rolle «Kind» ✓ erledigt (683e450, 916d22f)

*lohnt sich · Aufwand: mittel · Hub + App*

Ein Kind war ein Bewohner mit fünf verstreuten Einschränkungsfeldern
(`simple_rooms`, `rooms`, `hours`, `features`, Familienlisten-Rolle) –
fünf Stellen, an denen man eine vergessen konnte. Die neue Rolle
bringt konservative Rechte mit (schalten und Verlauf sehen), und bei
ihr springen Ansicht und Schranke füreinander ein: Die Zimmerwahl ist
eine Wahl.

Stellen: `hub/homepilot/core/users.py`, `app/src/screens/UsersScreen.tsx`, `app/src/lib/rollenwahl.ts`

### 246. Gast-Zugang an einem Ort zu Ende denken ✓ erledigt (916d22f)

*Feinschliff · Aufwand: klein · App*

Die Personenseite konnte Gäste anlegen, verwies fürs Verlängern und
Widerrufen aber nur textlich in die Benutzerverwaltung. Und der
Bereichs-Riegel griff nur im Babysitter-Modus – Besuch, der tagsüber
am Wandtablet vorbeiging, sah Einkaufsliste und Kalender. Neu:
Verlängern, Sperren und Löschen direkt vor Ort, und der Riegel greift
am geteilten Gerät auch im Besuch-Modus.

Stellen: `app/src/screens/PersonenScreen.tsx`, `app/src/lib/bereichsriegel.ts`

## Bedienung (247–250)

### 247. Die Anmeldemaske läuft am Hub-Client vorbei ✓ erledigt (8b5e8bb)

*tut weh · Aufwand: klein · App*

Der Login-Bildschirm umging den zentralen Client mit drei nackten
`fetch`-Aufrufen: kein Zeitlimit, keine lesbaren Fehlersätze – ein
hängender Hub blockierte ausgerechnet die erste Maske ohne jede
Rückmeldung. Dazu hatten Login-, Energie- und Besuchsbildschirm als
einzige kein einziges Vorlesezeichen.

Stellen: `app/src/screens/LoginScreen.tsx`, `app/src/lib/anmeldefehler.ts`

### 248. Geführter Erst-Start und Hilfe in der App ✓ erledigt (5758c14)

*lohnt sich · Aufwand: mittel · App*

Es gab Leerzustände, Einrichtungshilfe und WhatsNew – aber keine
Einführung nach dem ersten Login und keinen Hilfe-Bereich; die
Doku-Seiten unter `docs/` sind von der App aus unerreichbar. Neu: ein
blätterbares Einführungsblatt (einmal pro Person, wie WhatsNew über
die Hub-Prefs), für Gäste und Babysitter als kurze «So funktioniert
das hier»-Fassung, dazu ein Hilfeblatt in den Einstellungen.

Stellen: `app/src/lib/einfuehrung.ts`, `app/src/components/Einfuehrung.tsx`, `app/src/components/Hilfeblatt.tsx`

### 249. Der Favoriten-Kommentar behauptete das Gegenteil des Codes ✓ erledigt (feaea28)

*Feinschliff · Aufwand: klein · App*

`lib/favoriten.ts` erzählte noch «der Stern gehört allen» – die
Favoriten sind seit dem Umzug in `/api/prefs` persönlich. Wer dem
Kommentar glaubte, baute am falschen Modell weiter; genau so entstehen
die Doppelbauten, gegen die dieses Repo sonst so gut gerüstet ist.

Stellen: `app/src/lib/favoriten.ts`

### 250. Rezepte überstehen keinen Hub-Ausfall ✓ erledigt (4f91494)

*tut weh · Aufwand: mittel · App*

Familienlisten und Schaltbefehle überlebten einen Ausfall vorbildlich,
die Rezepte nicht: Wer in der Küche stand und das WLAN zickte, verlor
das Rezept mitten im Kochen. Neu hält ein eigenes Lager die zuletzt
geladenen Rezepte ohne die eingebetteten Fotos; der Kochmodus läuft
vollständig daraus. Schreiben bleibt online-only – Konflikte in
Rezepttexten sind teurer als die seltene Unannehmlichkeit.

Stellen: `app/src/lib/rezeptcache.ts`, `app/src/screens/RecipeBook.tsx`

## Abläufe (251–254)

### 251. Kontrollfluss in Aktionslisten ✓ erledigt (eb03e5b, 12e599e)

*lohnt sich · Aufwand: gross · Hub + App*

Innerhalb einer Aktionsliste gab es kein Wenn/Dann und kein
Wiederholen – nur das eine globale «sonst» –, und Nachrichtentexte
waren starre Literale. Neu: `if` mit dann/sonst über die bestehende
Bedingungsauswertung, `repeat` mit Anzahl oder solange-Bedingung
(Tiefe 3, hart bei 50 Durchgängen gedeckelt), und Platzhalter
`{entity_id}`, `{entity_id.attribut}`, `{time}` in Nachricht und
Durchsage – Unbekanntes bleibt wörtlich stehen, eine Push mit
«{tippfehler}» ist besser lesbar als ein abgestürzter Ablauf.

Stellen: `hub/homepilot/core/automation.py`, `hub/homepilot/core/platzhalter.py`

### 252. Anwesenheit und Wetter als Auslöser ✓ erledigt (eb03e5b, 12e599e)

*lohnt sich · Aufwand: mittel · Hub + App*

Anwesenheit war im Editor nur Aktion, nie Auslöser, und die
Meteoalarm-Warnungen holte der Hub, ohne dass ein Ablauf darauf
reagieren konnte. Neu: «Person kommt an / geht» (je Zone, an derselben
Quelle wie die Ankunfts-Pushs – die Neustart-Welle feuert nicht) und
«Wetterwarnung» ab wählbarer Stufe, nur für neu hinzugekommene
Warnungen.

Stellen: `hub/homepilot/core/automation.py`

### 253. Der Monats- und Jahresrückblick ✓ erledigt (f5fb0e0, cef343b)

*lohnt sich · Aufwand: mittel · Hub + App*

Supabase schrieb eine `state_history`, die nie jemand las. Der neue
Rückblick macht daraus Kernaussagen: wärmster und kältester Raum,
meistgeschaltete Lichter, Stromtrend gegen Vormonat und Vorjahr – fair
bis zum selben Stichtag gerechnet. Strom und Licht kommen aus lokalen
Quellen, denn der Rückblick muss auch offline etwas zeigen; fehlt
Supabase, fällt nur die Temperatur weg, und die Antwort sagt es.

Stellen: `hub/homepilot/core/langzeit.py`, `hub/homepilot/api/routes/rueckblick.py`, `app/src/screens/HausRueckblick.tsx`

### 254. Die Zeitraum-Simulation für Abläufe ✓ erledigt (eb03e5b, 12e599e)

*lohnt sich · Aufwand: mittel · Hub + App*

Der Trockenlauf kannte nur das Jetzt. Die Simulation beantwortet «wie
oft hätte dieser Ablauf letzte Woche gefeuert?»: Zeit, Sonne und
Kalender exakt, Zustands-Auslöser aus dem Ereignisprotokoll – und was
sich nicht simulieren lässt, steht ehrlich als «nicht simulierbar»
dabei, denn eine geschätzte Zahl wäre eine Lüge mit Nachkommastellen.

Stellen: `hub/homepilot/core/ablaufsimulation.py`, `hub/homepilot/api/routes/automations.py`

## Sicherheit (255–256)

### 255. Die Alarmanlage kann jetzt mehr als Push ✓ erledigt (db5947d, cef343b)

*lohnt sich · Aufwand: mittel · Hub + App*

Im Zustand «ausgelöst» blieb es bei einer Push-Nachricht. Neu
eskaliert die Anlage nach einer einstellbaren Frist (Vorgabe 30 s,
damit ein Fehlalarm noch entschärfbar ist): Sirenen ein, wahlweise
alle Lichter, wahlweise eine Durchsage. Entschärfen bricht ab und
schaltet die Sirene aus – die Lichter bleiben bewusst an. Ohne
Konfiguration ändert sich nichts.

Stellen: `hub/homepilot/integrations/alarm_rules.py`, `hub/homepilot/integrations/alarm.py`

### 256. Ein Clip-Archiv mit Aufbewahrungsfrist ✓ erledigt (db5947d, cef343b)

*lohnt sich · Aufwand: mittel · Hub + App*

Kamera-Clips gab es nur als kurzlebige Snapshots für die Push. Neu
legt der Alarm beim Auslösen einen Clip der zugeordneten Kamera ins
Archiv (Dateien neben der Datendatei, Bauart wie die Raumbilder), der
Wächter-Minutentakt räumt Abgelaufenes weg (Vorgabe 14 Tage), und die
App zeigt die Aufnahmen mit denselben Rechten wie das Livebild –
löschen darf nur, wer Geräte bearbeiten darf: Gäste löschen keine
Beweise.

Stellen: `hub/homepilot/core/cliparchiv.py`, `hub/homepilot/api/routes/entities.py`

## Alltag (257)

### 257. Der Handgriff zur Tageszeit auf der Startseite ✓ erledigt (5cb3862)

*lohnt sich · Aufwand: klein · App*

Die Startseite ordnete ihre Blöcke morgens schon um (morningFirst),
aber der Griff, den die Stunde nahelegt, fehlte: Morgens will man die
Storen hochlassen, abends das vergessene Licht löschen und die Storen
schliessen. Neu bietet eine Schnellzeile genau diese Sammelgriffe an –
«3 Storen auf», «Licht aus», «Store zu» – und nur, wenn es wirklich
etwas zu tun gibt: Eine Zeile «0 Storen auf» wäre keine Auskunft,
sondern Möblierung. Bewusst kein Umsortieren der Kacheln: Wer seine
Startseite kennt, soll sie zu jeder Stunde am selben Ort wiederfinden.

Stellen: `app/src/lib/tageszeile.ts`, `app/src/components/TagesZeile.tsx`, `app/src/screens/OverviewScreen.tsx`

### 258. Die Batteriewarnung erinnert täglich - Stunde und Schwelle einstellbar ✓ erledigt (c49d5bc)

*tut weh · Aufwand: mittel · Hub + App*

«Ich bekomme keine Push mehr, wenn ein Gerät fast keinen Akku hat» -
und das stimmte: Die Warnung kam bewusst genau einmal und geriet dann
in Vergessenheit, bis der Melder still war. Neu meldet der Hub sofort
und erinnert danach täglich zur Erinnerungsstunde, bis die Batterie
gewechselt ist. Neben dem low_battery-Flag zählt neu der Prozentwert
gegen eine Schwelle (ein Sensor auf 4 %, dessen Integration das Flag
nicht kennt, blieb sonst unerwähnt); die Telefone bleiben draussen,
ihre Warnung wohnt bei der Ortung. Stunde und Schwelle stellt man in
den Push-Einstellungen ein - für den ganzen Haushalt, denn sie
bestimmen, ob der Hub überhaupt meldet.

Stellen: `hub/homepilot/core/batterie.py`, `hub/homepilot/core/watchrules.py`, `app/src/components/PushPrefs.tsx`

## Das Haus wird persönlicher (259–262)

### 259. Der Anrufbeantworter des Hauses ✓ erledigt (d4773f7)

*lohnt sich · Aufwand: mittel · Hub + App*

Sprachnotiz aufnehmen und Boxen bespielen konnte das Haus längst - was
fehlte, war die Brücke zum Ankommen: eine Nachricht «fürs nächste
Heimkommen» hinterlegen, die spielt, wenn jemand die Tür aufmacht
(«Lasagne im Ofen, bin um sechs zurück»). Einmalig, mit Verfall nach
48 Stunden, die hinterlegende Person verbraucht sie nicht selbst, die
Nachtruhe lässt sie liegen, und der Hinterleger erfährt per Push, dass
sie gespielt hat.

Stellen: `hub/homepilot/core/heimgruss.py`, `hub/homepilot/integrations/geofence.py`, `app/src/screens/OverviewScreen.tsx`

### 260. Ämtli-Sterne ✓ erledigt (3851409)

*lohnt sich · Aufwand: mittel · App*

Die Ämtli-Listen gab es, die Kinderseite gab es - was fehlte, war der
Spass: Abgehakte Ämtli geben Sterne, mit Wochenziel (Montag bis
Sonntag, wie überall) und einer von den Eltern gesetzten Belohnung.
Ohne gesetztes Ziel erscheint nichts - ein «0 von 0» wäre kein
Ansporn.

Stellen: `app/src/lib/aemtlisterne.ts`, `app/src/screens/family/kindseite.tsx`, `app/src/screens/FamilyScreen.tsx`

### 261. «Ruf Mami / Ruf Papi» in der Kinder-Ansicht ✓ erledigt (3851409)

*Feinschliff · Aufwand: klein · App*

Der Babysitter hatte den grossen Anruf-Knopf (Punkt 183), die Kinder
in ihrer eigenen Ansicht nicht. Jetzt: dieselben Notfall-Kontakte,
grosse Knöpfe mit dem Namen darauf - und wo tel: nichts wählt (Web,
Wandpanel), steht die Nummer gross zum Ablesen statt eines toten
Knopfs.

Stellen: `app/src/lib/elternruf.ts`, `app/src/components/KidsView.tsx`

### 262. Verwaiste Abläufe fallen nie auf ✓ erledigt (c32edc0)

*lohnt sich · Aufwand: mittel · Hub + App*

Stille sieht wie Erfolg aus: Ein Ablauf, der seit Monaten nicht
gefeuert hat (umbenanntes Gerät, nie erfüllte Bedingung), ist meist
tot, und niemand merkte es. Der Motor führt jetzt ein dauerhaftes
«zuletzt gefeuert» je Ablauf, die Liste zeigt bei Verwaisten «Zuletzt
gefeuert: vor 4 Monaten», der Editor verweist auf «Hätte gefeuert»
(Punkt 254), und höchstens einmal im Monat fasst eine Push die
stillen zusammen. Die 90-Tage-Grenze rechnet nur der Hub - App und
Hub sollen nie zwei Meinungen haben.

Stellen: `hub/homepilot/core/verwaist.py`, `hub/homepilot/core/automation.py`, `app/src/lib/verwaist.ts`

## Aus dem Betrieb (263)

### 263. Sauger-Meldungen kamen nie an - ein Feldname, den es nie gab ✓ erledigt

*tut weh · Aufwand: mittel · Hub*

«Schmutzwassertank voll/nicht eingesetzt» stand in der Roborock-App;
in HomePilot kam nichts. Die Ursache lag drei Schichten tiefer, als
sie aussah: `roborock.py` fragte die Station über
`dock_error_status_name` ab - ein Feld, das die Bibliothek nie hatte,
sie heisst `dock_error_status` ohne den Zusatz. `getattr` lieferte
still `None`, `dock["error"]` wurde nie gesetzt, und die Regel im
Wächter fand nichts zu melden. Nichts scheiterte, es fehlte einfach.

Der Test daneben war grün, weil er einen selbst gebauten Doppelgänger
mit denselben erfundenen Namen prüfte - er bestätigte nur, dass der
Code mit sich selbst einig ist. Deshalb liegt python-roborock jetzt im
dev-Extra, und ein Test hält die abgefragten Feldnamen gegen die echte
Klasse.

Dazu kam heraus, dass der volle Schmutzwassertank beim Saros gar nicht
im Fehler der Station steht, sondern in deren eigenem Tankstand
(`dirty_water_box_status` aus dem Sammelwert `dss`) - der wurde bisher
überhaupt nicht gelesen. Und der Merker der gemeldeten Probleme lag im
Arbeitsspeicher: Ein Tank, der voll bleibt, wurde einmal gemeldet und
dann nie wieder. Jetzt erinnert der Hub täglich zur selben Stunde wie
bei den Batterien (Punkt 258).

Stellen: `hub/homepilot/integrations/roborock.py`, `hub/homepilot/core/watchrules.py`, `hub/homepilot/core/watchdog.py`, `hub/homepilot/saugercheck.py`

## Familie (264)

### 264. Gutscheine als Familien-Modul ✓ erledigt (6944257, c040417)

*lohnt sich · Aufwand: gross · Hub + App*

Geschenk- und Einkaufsgutscheine lagen bisher in einer fremden App
oder in der Schublade - und verfielen dort. Neu verwaltet die
Familienseite sie selbst: Laden, Wert in Franken oder Stück, Nummer
und PIN (maskiert), Ablaufdatum oder «unbegrenzt», Kategorie, Foto der
Karte, Link zum Laden. «Abziehen» bucht eine Einlösung mit Datum und
Person in den Transaktionsverlauf, der Rest wandert als Balken mit;
aufgebrauchte klappen sich weg. «Privat» heisst privat - auch vor dem
Verwalter, sonst wäre das Wort eine Lüge; der Hub filtert, nicht die
App. Die Fotos liegen als Dateien neben den Daten (Bauart der
Rezeptbilder, verallgemeinert), und das Familienbuch nimmt die
geteilten Gutscheine ohne PIN mit - ein Gutschein ist Geld, und die
Druckseite ist für den Tag, an dem der Hub tot ist.

Dazu die Ablauf-Erinnerung: zwei Stufen vor dem Verfall (Vorgabe 30
und 7 Tage, einstellbar unter Benachrichtigungen) und am Ablauftag
selbst, je Gutschein und Stufe genau einmal; private gehen nur an den
Besitzer.

Stellen: `hub/homepilot/core/gutscheine.py`, `hub/homepilot/api/routes/family.py`, `app/src/screens/family/gutscheine.tsx`, `app/src/lib/gutscheine.ts`

## Aus dem Betrieb (265)

### 265. Die Tastatur legt sich über die Eingabefelder ✓ erledigt (7195fda, 3b6823b)

*tut weh · Aufwand: mittel · App*

Gemeldet beim Erfassen eines Gutscheins: Notiz und Link stehen unten im
Formular, und die Tastatur deckte sie zu. Der Fehler war aber weder neu
noch auf die Gutscheine beschränkt - er stand an vierzehn Stellen, und
Punkt 11 hatte ihn schon einmal behoben. Nur eben an einer einzigen:
dem Fenster der Einkaufsliste, an dem er damals auffiel.

Zwei Ursachen, zwei Antworten. Die eingebetteten Formulare (Gutschein,
Rezept, Ablauf-Editor) hängen alle im einen Rollbereich der Startseite;
der schiebt seinen Inhalt jetzt selbst hoch
(`automaticallyAdjustKeyboardInsets`, eine Zeile für alle). Die Fenster
liegen darüber und rollen nicht mit - sie bekommen `<Tastaturplatz>`,
eine Komponente statt einer Zeile, die man an jeder Stelle neu erfindet.

Und weil «in der ganzen App» ein Anspruch ist, den kein Mensch
nachzählt, zählt jetzt ein Test: Er liest die Quellen und wird rot,
sobald ein Fenster mit Eingabefeld ohne Tastaturplatz dasteht. Von
Auge ist das nie zu finden - es fällt nur auf dem iPhone auf, nur weit
unten im Fenster, und nur wenn dort wirklich jemand tippt.

Stellen: `app/src/components/Tastaturplatz.tsx`, `app/src/lib/tastaturplatz.test.ts`, `app/src/screens/DashboardScreen.tsx`

### 266. Ein Gutschein trägt seinen Beleg bei sich ✓ erledigt (f2d10ec, ed2dec6)

*lohnt sich · Aufwand: gross · Hub + App*

Das Modul nahm ein Foto der Gutscheinkarte - nur kommen die meisten
Gutscheine gar nicht als Karte, sondern als PDF per E-Mail. Wer den
abfotografierte, hatte ein unlesbares Bild eines Bildschirms. Neu hängt
neben dem Foto eine Datei am Gutschein (PDF, Bilder, Word, Excel, Text,
ZIP), die der Hub wie die Bilder neben die Daten legt und unter einer
eigenen Adresse ausliefert - mit derselben Sichtbarkeitsprüfung, denn
ein privater Gutschein ist auch als Datei privat.

Zwei Dinge, die dabei zu lernen waren. Geprüft wird **vor** dem Lesen:
Grösse und Format stehen schon im Auswähler fest, und eine zu grosse
Datei wird abgelehnt, bevor sie durch den Speicher wandert - ein Korb
im Dialog ist freundlicher als ein 415 nach dem Warten. Und die
Laufzeit: Der Auswähler ist ein natives Modul, `runtimeVersion` musste
also steigen. Der Sprung stand versehentlich schon eine Stunde früher
im Repo, während ein Bau lief - was beinahe eine OTA-Fassung
veröffentlicht hätte, die kein Telefon im Haus je bekommen hätte. Die
Regel dazu steht seither in der CLAUDE.md: Die Laufzeit steigt im
selben Commit wie das Modul, das sie braucht, und erst wenn der
TestFlight-Build unmittelbar folgt.

Stellen: `hub/homepilot/core/dateien.py`, `hub/homepilot/api/routes/family.py`, `app/src/screens/family/gutscheine.tsx`, `app/src/lib/gutscheine.ts`

### 267. Der Gutschein, der nur mit der Karte gilt ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

Nummer und PIN stehen in der App, und genau das führt in die Irre: Ein
Teil der Gutscheine wird im Laden nur gegen das Original eingelöst -
die Plastikkarte, den Bon, den Ausdruck. Wer mit dem Telefon an der
Kasse steht und die Nummer vorliest, fährt wieder heim.

Neu steht beim Erfassen und Bearbeiten, wie eingelöst wird: «Nummer
genügt» oder «Karte mitbringen». Beide Seiten sind benannt, nicht ein
einzelner Schalter - bei «Karte mitbringen: aus» müsste man raten, was
das Gegenteil ist.

Wo der Hinweis auftaucht, folgt daraus, wann er gebraucht wird:
**vor** dem Losfahren. Deshalb steht er als Chip schon auf der Karte in
der Liste und nicht erst im Detail - da öffnet niemand jeden Gutschein
einzeln. Und im Teilen-Text steht er auch: Wer den Gutschein
weitergibt, gibt sonst nur die Nummer weiter, und der andere steht mit
ihr im Laden, während die Karte hier liegt.

Der Hub setzt das Feld bei jedem Speichern, auch als `false`. Sonst
hinge an derselben Liste zweierlei Bedeutung von «nicht da». Im
Familienbuch wird daraus ein Satz statt eines Wahrheitswerts, und nur
in der einen Richtung: «physical False» auf einer gedruckten Seite
liest sich wie ein Fehler.

Stellen: `app/src/lib/gutscheine.ts`, `app/src/screens/family/gutscheine.tsx`, `hub/homepilot/core/gutscheine.py`

# Teil VII: Achtundachtzig Vorschläge (268–352)

Eine Runde Vorschläge vom September 2026, auf Zuruf in acht Bereichen
gesammelt: die App allgemein, Bedienung, Gestaltung, Gutscheine,
Abläufe, Push-Nachrichten, Alarmanlage und freie Wahl. Daraus wurden
sechsundsechzig ausgewählt und in neun Blöcken umgesetzt.

**Zu den Lücken in der Nummerierung**: 273, 274, 277, 286, 289, 293,
308, 323, 328, 333, 338, 339, 343, 344, 346–348, 350 und 351 stammen aus
derselben Runde, wurden aber nicht ausgewählt. Ihre Beschreibungen sind
nicht ins Repo gekommen. Die Nummern bleiben trotzdem vergeben und
werden nicht neu benutzt – die Regel oben gilt auch für das, was nie
gebaut wurde, sonst zeigte ein späterer «Punkt 273» im Code auf etwas
anderes als gemeint.

**Ein Drittel war schon da.** Beim Umsetzen zeigte sich Block für Block,
dass ein guter Teil der Vorschläge längst gebaut ist – teils besser, als
sie vorgeschlagen waren. Das ist unten jeweils vermerkt, samt der
Stelle, an der es steht. Es ist der Grund, aus dem die CLAUDE.md mit
«Schau nach, ob es das schon gibt» anfängt: Beim Bauen von Punkt 312
(Konflikte zwischen Abläufen) entstand die Prüfung ein zweites Mal in
der App, obwohl `core/automation.py:find_conflicts` sie längst im Hub
rechnet. Sie wurde wieder herausgenommen.

## Fundament (268–277)

### 269. Typprüfung, die bindend ist ✓ erledigt (7eb5805)

`mypy homepilot` meldete 213 Fehler in 48 Dateien, und die Prüfung stand
deshalb auf «darf rot sein» – eine Zahl, die immer rot ist, liest
niemand. Jetzt andersherum: Was heute sauber ist, steht in
`mypy-sauber.txt` und wird geprüft; der Rest bleibt aussen vor, bis ihn
jemand aufräumt. Die Liste kann nur wachsen.

Die Lektion beim Bauen: immer über das **ganze** Paket prüfen und
danach filtern. Ein Prüflauf über die Teilmenge allein meldet die Fehler
der Nachbarn – beim ersten Versuch 95 Stück, die es gar nicht gab.

Stellen: `hub/mypy-sauber.txt`, `hub/tools/mypy_sauber.py`, `.github/workflows/pruefung.yml`

### 270. Die Abhängigkeiten der Haken bindend prüfen ✓ erledigt (7eb5805)

`react-hooks/exhaustive-deps` stand auf «Warnung» und meldete drei echte
Fehler, die niemand mehr las. Jetzt bindend, die drei sind behoben.

Stellen: `app/eslint.config.js`, `app/src/screens/DashboardScreen.tsx`

### 271. Alte Werte kenntlich machen ✓ erledigt (7eb5805)

Ein Fühler, der seit Stunden schweigt, zeigt weiter seine letzte
Temperatur – und die sieht aus wie die aktuelle. Neu blasst die Kachel
ab und trägt «Stand HH:MM». Die Regel darin: erst prüfen, ob die
Verbindung steht. Ein Fensterkontakt, der stundenlang nichts meldet,
ist der Normalfall, solange er verbunden ist.

Stellen: `app/src/lib/altwert.ts`, `app/src/components/EntityCard.tsx`

### 272. Ein Absturzbuch ✓ erledigt (7eb5805)

Ein Absturz war bisher nur ein weisser Bildschirm. Jetzt merkt sich die
App die letzten, mit Bereich und Meldung, und der System-Bildschirm
zeigt sie.

Stellen: `app/src/lib/absturzbuch.ts`, `app/src/hooks/useAbstuerze.ts`, `app/src/components/Auffangnetz.tsx`

### 275. Sichern und Zurückholen in der App ✓ war schon da

`/api/system/backups` listet, `/api/system/backup` legt an, dazu
Herunterladen, Zurückholen und die Kopie ausserhalb des Hubs – alles
unter System bedienbar.

Stellen: `hub/homepilot/api/routes/system.py`, `app/src/screens/SystemScreen.tsx`

### 276. Ein Ort für «nicht in Ordnung» ✓ war schon da

`lib/sorgen.ts` und `SorgenBlatt.tsx` tragen Batterien,
Nichterreichbares, Wartungen und die Funkstille zusammen. Vorher musste
man an vier Stellen nachsehen und die vierte kennen.

Stellen: `app/src/lib/sorgen.ts`, `app/src/components/SorgenBlatt.tsx`

## Bedienung (278–287)

### 278. Rückgängig ✓ war schon da

An beiden Stellen, an denen es wehtut: Schaltbefehle
(`lib/rueckgaengig.ts`, `useHub`) und gelöschte Familieneinträge
(`lib/rueckband.ts`, das Band mit acht Sekunden Frist).

### 279. Die Einstellungen mitsuchen ✓ erledigt (91e474c)

Die Suche fand Geräte, Räume, Szenen und Abläufe – nur die App selbst
nicht. Wer die Ruhezeit suchte, musste wissen, dass sie unter «Konto» in
der Karte «Benachrichtigungen» steht; das weiss, wer sie eingebaut hat,
und sonst niemand. Jetzt haben die Seiten Stichwörter, und der Treffer
sagt, weswegen er einer ist: «Konto · nachtruhe» statt bloss «Konto».
Nur Seiten, die man auch sehen darf – ein Treffer, den der Hub danach
abweist, ist schlimmer als keiner.

Stellen: `app/src/lib/seitensuche.ts`, `app/src/components/GlobalSearch.tsx`

### 280. Da weitermachen, wo man war ✓ erledigt (91e474c)

Man steht in den Abläufen, das Telefon sperrt sich, man entsperrt es –
und ist auf der Startseite. Zehn Minuten Frist, nur die Seite und nicht
der Zustand darin (ein Bearbeitungsblatt, das von selbst wieder aufgeht,
ist erschreckend). Nicht zur Alarmanlage oder zur Benutzerverwaltung
zurück, und am Wandtablet gar nicht: Dort ist die Startseite kein
Standardwert, sondern der Zweck.

Im Speicher des Telefons, nicht beim Hub – die Ausnahme von der Regel in
der CLAUDE.md, und mit Grund: «Wo war ich vor zehn Minuten» ist keine
Einstellung, sondern eine Beobachtung über *dieses* Gerät. Zuerst lag es
beim Hub, und der eine zusätzliche Abruf legte die wandernde
Terminzeile still (siehe 353).

Stellen: `app/src/lib/wiederaufnahme.ts`, `app/src/screens/DashboardScreen.tsx`

### 281. Bestätigungen, die etwas sagen ✓ war schon da

«Alles aus» zeigt vorher, was es ausschaltet und wie viele
(`components/AllOff.tsx`); die Türe fragt nach (`TuerRueckfrage`), das
Scharfschalten nennt die offenen Fenster beim Namen.

### 282. Einheitliches Langdrücken ✓ erledigt (91e474c)

Die Dauer stand nirgends: React Native nimmt ohne Angabe 500 ms, eine
Stelle setzte 350, eine andere 2000. Jede Zahl für sich begründbar,
zusammen ein Haus, in dem man nie lernt, wie lange man halten muss. Drei
benannte Absichten, und die Regel darunter: Was per Langdruck erreichbar
ist, muss auch anders erreichbar sein. Dazu der Satz für die
Vorlesehilfe – VoiceOver liest ein `onLongPress` nicht von selbst vor,
und damit ist ein Langdruck-Menü für jemanden, der die App vorlesen
lässt, schlicht nicht da.

Stellen: `app/src/lib/langdruck.ts`, `app/src/components/Card.tsx`

### 283. «Woher kommt diese Zahl» ✓ war schon da

`lib/ursache.ts` am Gerät, die Herkunft am Klima-Chip.

### 284. Umrisse statt Spinner ✓ erledigt (91e474c)

Ein Spinner sagt «warte», ein Umriss sagt «hier kommen drei Kacheln
hin» – und beantwortet damit die Frage, die man beim Öffnen einer Seite
hat. Ausserdem springt nichts mehr: Der Spinner nahm eine Zeile ein, der
Inhalt nimmt fünfhundert Punkte. Bewusst ohne Animation.

Stellen: `app/src/components/Zustand.tsx`

### 285. Systemschriftgrösse ✓ war schon da

`allowFontScaling` ist überall an, `MAX_SCHRIFT` begrenzt nur die engen
Stellen (`lib/schrift.ts`, Punkt 66).

### 287. Fehlermeldungen mit einem Ausweg ✓ war schon da

`fehlerText()` macht aus «403» einen Satz, `Fehlschlag` hat den Knopf
«Nochmal versuchen».

## Gestaltung (288–297)

### 288. Das Musterblatt ✓ erledigt (2358301)

Eine Gestaltung, die nur in den Köpfen steht, driftet: Man braucht ein
Grau, nimmt eines, das passt, und ein halbes Jahr später gibt es sieben,
von denen drei fast gleich aussehen. Von Auge merkt man das nie, weil
man immer nur einen Bildschirm auf einmal sieht. Das Blatt zeigt
Flächen, Schriftfarben, Schriftgrössen, Zahlen, Rundungen, Abstände und
die Symbolsprache – **aus dem Code erzeugt**, nicht abgemalt: Ein
abgemaltes Musterblatt wäre nach der ersten Änderung eine Lüge, und
eine, der man glaubt, weil sie so ordentlich aussieht.

Es heisst bewusst nicht «Stiltafel» – so heisst hier schon die
StyleSheet-Datei `screens/dashboard/stile.ts`.

Stellen: `app/src/components/Musterblatt.tsx`, `app/src/screens/SystemScreen.tsx`

### 290. Den Hellmodus messen ✓ war schon da

`lib/kontrast.test.ts` rechnet alle fünf Erscheinungsbilder nach – hell,
dunkel, pink, mitternacht, sand –, je für Fliesstext, Nebentext,
Beiläufiges, Signalfarben und weisse Schrift auf dem Verlauf.

### 291. Eine zweite Kachelgrösse ✓ war schon da

`doppeltBreit` in `lib/raster.ts` gibt Kamera, Thermostat und Grill die
doppelte Breite; die kurze Liste ist dort auch begründet.

### 292. Zustandsübergänge ✓ erledigt mit Punkt 443

Für den Ortswechsel gibt es sie (`components/Auftritt.tsx`, mit
Rücksicht auf «Bewegung reduzieren»). Weiter zu gehen wäre gegen die
Regel, die sich das Haus dort selbst gegeben hat: «Eine Oberfläche, in
der sich ständig etwas bewegt, ist unruhig, und Unruhe ist teurer als
der Gewinn.» Jede Kachel beim Schalten überblenden zu lassen ist damit
eine Entscheidung und keine Umsetzung.

Eingelöst mit Punkt 443: Nicht jede Kachel blendet über, sondern der
Zustandspunkt bewegt sich - und nur er. Wie lange, hängt davon ab, wer
geschaltet hat (`lib/uebergang.ts`): der eigene Tipp kurz, die Meldung
von aussen länger. Die Regel von damals bleibt damit gewahrt.

### 294. Eine Symbolsprache ✓ erledigt (2358301)

Ionicons hat für jeden Begriff mehrere Zeichen, und über fünfundvierzig
Dateien hinweg hat sich jede Stelle ihres ausgesucht: «Bearbeiten» mal
`create-outline`, mal `pencil-outline`, mal `pencil`. Jetzt steht je
Begriff ein Zeichen fest, und ein Test liest die Quelldateien und wird
rot, sobald daneben ein gleichbedeutendes im Umlauf ist. Er hat beim
ersten Lauf **28 Stellen in 20 Dateien** gefunden. Dazu die Umrissregel:
gefüllt heisst «das gilt jetzt», Umriss heisst «das kannst du tun».

Stellen: `app/src/lib/symbole.ts`, `app/src/lib/symbole.test.ts`

### 295. Dichte ✓ erledigt (2358301)

Die 150 Punkte Mindestbreite sind gemessen und begründet – aber sie
beantworten «was ist das Minimum», nicht die Frage, die im Haus gestellt
wird: Am Wandtablet liest man aus zwei Metern, auf dem Sofa will man die
Wohnung auf einen Blick. Drei Stufen, am **Gerät** gespeichert wie der
Grundriss und das App-Symbol. Was sich nicht ändert: Schrift und Namen –
eine Dichte, die auch die Schrift schrumpfen lässt, wäre ein zweiter
Schriftgrössen-Einsteller, und den gibt es im Betriebssystem schon.

Stellen: `app/src/lib/dichte.ts`, `app/src/screens/SettingsScreen.tsx`

### 296. Die Zahl führt ✓ erledigt (2358301)

Messwerte standen als ein Stück Text da – «21.5 °C» in einer Grösse,
einer Farbe. Damit ist die Zahl, die man sucht, gleich wichtig wie das
Zeichen dahinter, das man längst kennt. Jetzt: Zahl gross, Einheit klein
auf der Grundlinie daneben, Beschriftung darunter. Und Ziffern mit
fester Breite – ohne sie ist die «1» schmaler als die «8», und eine
Temperatur, die von 19.8 auf 21.1 geht, ruckt seitwärts. Der
Zwischenraum folgt dem Duden: «21 °C», aber «63%».

Stellen: `app/src/lib/kennzahl.ts`, `app/src/components/Kennzahl.tsx`

### 297. Druck- und Teilen-Ansichten ✓ war schon da

An den Stellen, wo man sie braucht: Gutschein teilen, Familienbuch,
WLAN-Aufkleber, Türzugang, Rezept.

## Gutscheine (298–307)

### 298–307 ✓ erledigt (41c2156, 861646d)

Beleg lesen (Betrag, Nummer, Ablauf aus einem Foto oder PDF),
Strichcode auf dem Gutschein (immer schwarz auf weiss, egal welches
Erscheinungsbild – die Kasse liest kein Dunkelgrau), Rücknahme eines
Abzugs, Übergabe an jemanden im Haushalt, Läden als Chips, die Bilanz
unter dem Kopf.

Drei Regeln aus dem Beleglesen, jede aus einem Fehlversuch: Der Betrag
ist der grösste Wert **mit Währung**; Nummer und PIN werden nur
**nach** dem Stichwort gesucht und müssen eine Ziffer enthalten; ein
Datum zählt nur mit «gültig bis» davor. Ohne die erste las der Leser
«CHF 2027.00» aus einer Jahreszahl vor «Freundliche Grüsse», ohne die
zweite das Wort «GUTSCHEINCODE» als Code.

**304** (Ladenadresse und «in der Nähe») kam später, mit Block I:
Der Weg zum Laden steht auf dem Gutschein, und wer davorsteht, wird an
ihn erinnert.

Stellen: `app/src/lib/gutscheinlesen.ts`, `app/src/lib/strichcode.ts`, `app/src/lib/ladenkarte.ts`, `hub/homepilot/core/beleglesen.py`, `hub/homepilot/core/gutscheinort.py`

## Abläufe (309–317)

### 309–317 ✓ erledigt (0f0a077)

Kopieren, Ruhenlassen mit Frist, eingerückte Schritte, «warum lief der
nicht», Vorlagen beim leeren Bildschirm, Schnell-Bedingungen,
Taster-Drücke im Entwurf, ein Ablauf aus einer Aktivität heraus.

**312 (Konflikte) wurde wieder herausgenommen – es gab sie schon.**
`core/automation.py:find_conflicts` rechnet sie im Hub,
`/api/automations/conflicts` liefert sie, und der Bildschirm zeigt sie
samt Quittieren. Beim Bauen entstand die Prüfung ein zweites Mal in der
App: genau der Fehler, wegen dem es die CLAUDE.md gibt. In
`lib/ablaufhilfen.ts` steht seither ein Absatz, der auf die richtige
Stelle zeigt.

Stellen: `app/src/lib/ablaufhilfen.ts`, `app/src/screens/AutomationsScreen.tsx`, `app/src/screens/automations/editor.tsx`

## Push-Nachrichten (318–327)

### 318–327 ✓ erledigt (283e0c2)

Die Kette zwischen «der Hub will melden» und «das Telefon brummt» hatte
genau einen Schalter: abbestellt oder nicht, ganz oder gar nicht, für
immer.

Neu: **Ruhezeit je Person** (320) mit einer namentlich aufgezählten
Liste dessen, was sie nie aufhält – Alarm, Wasser, Klingel, ein
weinendes Kind, der Timer. Eine Ruhezeit, die den Wasseralarm
verschluckt, ist ein Fehler, kein Komfort. **Stillstellen auf Zeit**
(325), das von selbst abläuft: Wer im September den Trockner abbestellt,
merkt es im März nicht mehr. **Tagesdeckel** (326), dessen Zählerstand
den Neustart übersteht – sonst wäre ein Update das Rezept, ihn zu
umgehen. **Bündeln** (319): Der Wächter prüft einmal je Minute alles auf
einmal, und drei offene Fenster waren drei Vibrationen; die Klingel wird
bewusst nie gebündelt. **Vorschau und Testversand je Kategorie** (318),
erkennbar am «Probe:» vorn im Titel – ohne das läuft jemand los, weil
«Wasser gemeldet» auf dem Telefon steht. **Dringlichkeit sichtbar**
(321). **Alle Knöpfe durchgegangen** (322): zehn Kategorien haben einen
dazubekommen, drei Gruppen bleiben bewusst leer.

**Nichts geht dabei verloren** (324) – das war der gefährliche Teil:
Die Ruhezeit sortiert die Empfänger aus, `send` findet keine Tokens und
kehrt um, und die Meldung wäre nirgends gewesen, auch nicht im
Nachlesen.

Dabei ein echter Fehler gefunden: Unter «Wartung fällig» stand
«Erledigt», die Meldung schickt aber keine Gerätekennung mit – die App
fand nichts zu quittieren und tat schlicht nichts.

**327** ist die Runde über alle Meldungstexte: jede Kategorie hat ein
Beispiel, eine Gruppe, keinen zu langen Titel, kein «ß», jeder Knopf
gehört zu einer echten Kategorie, und was keine Ruhezeit aufhält, ist
auch dringend zugestellt.

Stellen: `hub/homepilot/core/pushruhe.py`, `pushbuendel.py`, `pushbeispiel.py`, `hub/tests/test_pushtexte.py`, `app/src/components/PushPrefs.tsx`

## Alarmanlage (329–337)

### 329, 330, 332, 336 ✓ war schon da

Eingangs- und Ausgangsverzögerung samt Countdown-Ring, der Verlauf, der
Probealarm und das Kamerabild in der Alarm-Nachricht.

### 331. Sabotage und Funkstille als eigener Zustand ✓ erledigt (9f36ab4)

Der Fall tarnt sich als Ruhe: Ein Funkkontakt am Kellerfenster meldet
sich nicht mehr, die Anlage steht weiter auf «scharf», die App zeigt ein
grünes Schild, und niemand erfährt, dass dort seit vier Stunden nichts
überwacht wird. Aus Sicht der Anlage ist das kein Ereignis – es kommt
bloss nichts mehr.

Geprüft wurde das bisher nur *vor* dem Scharfschalten. Jetzt läuft es im
Minutentakt weiter, und die blinden Flecken stehen im *Zustand*, nicht
nur in einer Nachricht: Eine weggewischte Meldung ist weg, ein grünes
Schild über einem stillen Sensor bleibt.

**Die Sirene bleibt dabei still**, und das weicht bewusst von dem ab,
was echte Anlagen tun: Um drei Uhr nachts wegen einer leeren Knopfzelle
geweckt zu werden, ist der schnellste Weg zu einer Anlage, die niemand
mehr scharf schaltet.

Stellen: `hub/homepilot/core/alarmwache.py`, `app/src/lib/alarmblind.ts`

### 334. Panikknopf ✓ erledigt (9f36ab4)

Ohne PIN – wer den Knopf drückt, ist in Bedrängnis, und eine Tastatur
zwischen Bedrängnis und Sirene ist ein Fehler. Aus jedem Zustand, auch
aus «unscharf»: Eine Anlage, die erst scharf geschaltet werden muss,
bevor man um Hilfe rufen kann, hilft nicht. In der App zwei Sekunden
Halten statt eines Tipps.

### 335. An die Anwesenheit gekoppelt ✓ erledigt (9f36ab4)

Der häufigste Fehler an einer Alarmanlage ist nicht ein Fehlalarm,
sondern eine Anlage, die niemand scharf geschaltet hat. Zwei Richtungen,
getrennt eingestellt, weil sie verschieden gefährlich sind – die Vorgabe
ist beidseits «vorschlagen». Zehn Minuten Nachlauf vor dem
Scharfschalten, keiner beim Heimkommen.

Stellen: `hub/homepilot/core/alarmanwesenheit.py`

### 337. Nachbericht ✓ erledigt (9f36ab4)

Zehn Minuten nach einem Alarm steht man in der Küche und weiss nicht
mehr, was passiert ist. Steht im Bericht «von selbst, ohne dass jemand
hinsah», ist das die wichtigste Zeile darin.

Stellen: `hub/homepilot/core/alarmbericht.py`

## Haus (340–352)

### 340. Sturm-Vorwarnung ✓ erledigt (861646d)

Der Sturmwächter fährt die Storen hoch und meldet danach, dass er es
getan hat. Was er nicht hochfahren kann, muss ein Mensch hereinholen:
der Sonnenschirm, die Kissen, das Trampolin. Der Zeitpunkt dafür stand
seit je in den Daten und wurde nie benutzt – `onset`. Jetzt kommt die
Vorwarnung vierzig Minuten vorher, mit den offenen Fenstern und der
Frage nach dem, was draussen steht.

Stellen: `hub/homepilot/core/sturmvorwarnung.py`

### 341, 342, 345, 349, 352 ✓ war schon da

Musikwecker (`core/musik.py`), Anwesenheitssimulation
(`integrations/presence_sim.py`), Gästemodus mit Besuch und Babysitter
zusammengeführt (`core/babysitter.py`), Ämtli-Sterne auf der Kinderseite
(`lib/aemtlisterne.ts`, Punkt 260) und der Monats- und Jahresrückblick
(`api/routes/rueckblick.py`, Punkt 253).

## Was dabei aufgefallen ist (353)

## Gutscheine, Abläufe, Push (369, 371-372, 375-379, 397)

Aus einer Liste von neunundvierzig Vorschlägen (App, User Experience,
Design, Gutscheine, Abläufe, Push, Alarm, selbst gewählt), die zuerst
selbst zu erstellen war. Zwei Durchsichten vorweg ersparten drei
Punkte: **368** (Gutschein-Adresse und Erinnerung in der Nähe) war
zwischen Vorschlag und Umsetzung schon über den Hauptzweig eingegangen;
**381** (Toast nach dem Speichern eines Ablaufs) und **385**
(Massen-Bearbeitung bei Gerätetausch) gab es bereits – `save()` ruft
schon `onNote(...)`, und «Gerät ersetzen» in den Geräte-Werkzeugen
aktualisiert längst Szenen, Abläufe, Raumzuordnung und Leuchtengruppen.

### 371. Sichere Buchungen ✓ erledigt (dc6fbc1)

Zwei Telefone, die im selben Moment abziehen, sahen beide denselben
alten Rest – wessen PUT zuletzt ankam, überschrieb die Buchung des
anderen wortlos. Jetzt führt die Route die Verläufe zusammen (an `at`
erkannt, `transaktionen_zusammenfuehren`) statt sie zu ersetzen, und
`left` folgt immer aus dem Verlauf, nie aus dem, was die App schickt.

### 372. Archiv ✓ erledigt (dc6fbc1)

Ein aufgebrauchter Gutschein wandert jetzt automatisch aus der Liste,
sobald eine frische Buchung ihn auf null bringt – und wieder heraus per
Knopf im Detail. Einen Tag nach dem Ablauf kommt eine letzte Meldung mit
dem Betrag, der weg ist, und der Gutschein wird archiviert; die Summe
verfallener Gutscheine steht jetzt auch im Monats- und Jahresrückblick.

### 375. Vorlagen je Laden ✓ erledigt (dc6fbc1)

Kategorie, Einheit und Einlöseart füllen sich beim zweiten Gutschein
desselben Ladens – nur beim Anlegen und nur, solange noch nichts anderes
eingestellt ist.

### 376. Stückgutscheine ✓ erledigt (dc6fbc1)

«1 einlösen» als eigener Knopf statt erst eine Eins eintippen und
bestätigen – der Normalfall bei Kinoeintritten.

### 377. Übergabe mit Annahme ✓ erledigt (dc6fbc1)

Der Besitzer wechselte bisher sofort, sobald jemand «Übergeben»
antippte – ein vertippter Name verschenkte den Gutschein an die falsche
Person. Jetzt ist es ein Vorschlag; erst die Annahme über eine eigene
Route ändert den Besitzer, mit Push-Nachricht an die eingeladene Person
und einem schmalen Auszug `/api/family/vouchers/eingehend` – der volle,
private Gutschein bleibt bis dahin unsichtbar für sie.

### 369. Nummer scannen ✓ erledigt (dc6fbc1)

`QrScanner` ist jetzt allgemein: `onText` lässt jeden gelesenen Code
durch statt nur das Einrichtungs-JSON. Ein Knopf beim Nummer-Feld
scannt die Karte statt sie abzutippen.

Dabei zwei echte Fehler gefunden: `alsGutschein()` liess `art` und
`storniert` jeder Buchung beim Einlesen vom Hub unter den Tisch fallen
– nach jedem Neuladen sah eine Rücknahme wie ein gewöhnlicher Abzug aus.
Und `QrScanner` liess seine Sperre gegen doppeltes Auslösen über einen
Neuöffnen-Zyklus hinweg stehen – ein zweiter Scan hätte still nichts
mehr gemeldet.

### 378. Unbekannte Bausteine ablehnen ✓ erledigt (50e7ed7)

Ein Tippfehler im Aktions- oder Bedingungstyp liess sich bisher
speichern – der Ablauf lief dann und tat nichts, nur ein `log.warning`
beim Ausführen verriet es. Jetzt prüft `core/ablaufpruefung.py` beim
Speichern rekursiv gegen die bekannten Wörter und weist mit 400 ab.
Auslöser bleiben aussen vor – ihre Formen sind über zu viele Stellen
verteilt, um sie vollständig und ohne falsche Abweisungen aufzuzählen.

### 379. Eigene Nachtruhe-Stunden je Ablauf ✓ erledigt (50e7ed7)

`quiet_from`/`quiet_to` (0-23) statt der festen 22-8 Uhr – ohne Angabe
gilt weiter die Vorgabe, und die Nachtruhe des ganzen Hauses bleibt für
alle anderen Stellen unverändert.

### 397. «Heute nicht mehr» aus der Mitteilung ✓ erledigt (50e7ed7)

Ein dritter Knopf neben «Später»/«Erledigt», stellt die ganze Kategorie
für den Rest des Tages still – ohne den Umweg über Konto →
Benachrichtigungen.

### 398-400, 403, 407. Alarmzonen, eigene PIN je Person, Zwangs-PIN, Sensor-Testlauf, Fehlalarm-Statistik ✓ erledigt (e80e296)

Fünf Punkte auf einmal, weil sie an denselben Stellen sitzen
(`integrations/alarm.py`, `alarm_rules.py`):

- **398 Zonen** – jeder Sensor trägt jetzt ein `zone`-Feld (frei
  eingebbar, kein fester Katalog), `arm()` nimmt eine Zone entgegen und
  wertet nur deren Sensoren aus. Ohne Zone verhält sich alles wie
  bisher - die Übersichtsroute meldet die bereits vergebenen Zonen zum
  Anwählen, damit niemand neue Schreibweisen erfindet.
- **399 eigene PIN je Person** – `set_pin` war bisher eine einzelne,
  geteilte PIN. Jetzt legt jede Person ihre eigene an
  (Selbstbedienung); eine fremde zu setzen bleibt
  `MANAGE_USERS` vorbehalten. `check_pin` prüft alle hinterlegten PINs
  und meldet zurück, wer entschärft hat - auf einem geteilten Gerät
  überschreibt das die sonst passende Vermutung, auf dem eigenen
  Telefon bleibt die eigene Identität massgebend.
- **400 Zwangs-PIN** – eine zweite, unauffällige PIN, die genauso
  entschärft, aber im Hintergrund eine eigene Meldung nur an die
  *anderen* Bewohner auslöst (nie ans eigene Telefon - eine Nachricht
  dort wäre der Zwang selbst). Setzbar erst, wenn die eigene normale
  PIN schon existiert, und nicht identisch mit ihr.
- **403 Sensor-Testlauf** – nur bei unscharfer Anlage startbar: jeden
  gewählten Sensor einmal auslösen, der Hub hakt beim Eintreffen ab.
  Verhindert das «scharf gestellt, aber der Fenstersensor hängt seit
  Wochen» - ohne dafür die Anlage scharf zu stellen.
- **407 Fehlalarm-Statistik** – `alarmbericht.fehlalarm_kandidaten()`
  geht den Verlauf chronologisch durch und zählt, welcher Sensor
  auffällig oft schnell (< 60 s) und ohne dass die Eskalation je lief
  entschärft wurde. Die neue Route löst die Gerätekennung zum Namen
  auf; in der App ein «Auf verzögert stellen»-Knopf direkt bei der
  Kandidatenzeile.

Dazu, weil unmittelbar zusammenhängend: `pin_users` in der Übersicht
(wer hat überhaupt eine PIN gesetzt), und eine reale Alterung behoben -
`set_pin`/`set_duress_pin` schrieben bisher nur in `hub.data`, ohne den
gecachten Anlagenzustand zu erneuern; eine frisch gesetzte PIN fehlte
in der Übersicht bis zur nächsten Zustandsänderung.

**401 (Zeitfenster für automatisches Scharfstellen)** stand schon vor
dieser Runde im Code - keine eigene Arbeit nötig.

### 391. Eskalation bei einem Wassermelder, der nass bleibt ✓ erledigt, verengt

Ursprünglich als allgemeine Quittungs-Verfolgung gedacht - dafür hätte
`push.py`, `pushverlauf.py` und eine neue, hausweite Route eine
Quittierung je Meldung mitschreiben müssen, ein Umbau für sich. Verengt
auf den einen Fall, in dem das Fehlen am teuersten ist: Wasser. Der
Melder selbst sagt, ob noch jemand nachgesehen hat - bleibt er nach der
ersten Meldung `LECK_ESKALATION_MINUTEN` (15) am Stück nass, kommt eine
zweite, eindringlichere («Immer noch nass») statt stillem Weiterlaufen.
Trocknet er zwischendurch, zählt ein erneutes Nasswerden als neuer
Fall. Keine Quittung nötig, kein neues Datenmodell - nur ein Merker im
Wächter (`_leak_since`, `_leak_escalated`), analog zum bestehenden
Muster bei offenen Fenstern.

### Eine Nummer, zweimal vergeben (341, 345)

Die 49-Punkte-Liste dieses Auftrags zählte ab 338 weiter, weil die
Werkbank zu dem Zeitpunkt bei 267 endete. Während der Umsetzung liefen
aber weitere Commits ein, die 268–353 unabhängig davon nachtrugen -
darunter «341, 342, 345, 349, 352» (Zeile oben) mit ganz anderem
Inhalt. Die Kollision fiel erst auf, als die Punkte unten schon
gebaut, getestet und mit «Punkt 341»/«Punkt 345» im Code kommentiert
waren. Umzunummerieren hätte geheissen, bereits gepushte Commits samt
ihren Codekommentaren nachträglich zu ändern - mehr Risiko als der
Nutzen einer sauberen Zahl. Die Einträge unten bleiben darum bei 341
und 345, mit diesem Verweis als Auflösung. Künftige Funde aus dieser
Liste zählen ab 423 weiter, nicht mittendrin.

### 341 (App-Liste). Gleichzeitiges Bearbeiten an Familienlisten absichern ✓ erledigt

Familienlisten wurden per PUT ganz überschrieben - speichern zwei
Telefone denselben Eintrag kurz nacheinander, gewann bisher schlicht,
wer zuletzt sendet, und trug dabei still den Stand von vor der ersten
Änderung zurück. Jeder Eintrag trägt jetzt `updated` (vom Hub gesetzt);
`family_update` vergleicht den mitgeschickten Stempel mit dem
gespeicherten (`core/gleichzeitig.py`, `stempel_passt`) und weist mit
409 ab, wenn sie auseinanderlaufen - weich für ältere Apps und nie
zuvor gespeicherte Einträge, die den Stempel nicht kennen.
`useFamilienablage.update()` (`screens/family/ablage.ts`) trägt ihn
automatisch in jede Änderung ein (`lib/familiecache.ts`, `mitStempel`)
und lädt bei 409 neu. Bewusst aussen vor: die schnellen Häkchen und
Mengenänderungen auf der Startseite (`hooks/useFamilienlisten.ts`) -
einzelne, meist additive Felder, bei denen «wer zuletzt» kein echter
Verlust ist, anders als ein frei getippter Text.

### 344. Die Prüfwerkzeuge aus der App aufrufbar ✓ erledigt

`storencheck`, `livecheck`, `tvcheck`, `saugercheck`, `pushcheck`
brauchten `docker exec`. Die neue Route `/api/diagnose/{werkzeug}` baut
sie nicht um - sie lesen schon heute Token und Host aus derselben
Konfiguration wie der Hub selbst und sprechen ihn über HTTP an wie
jeder Client. Die Route startet dasselbe Programm als Unterprozess im
selben Container und reicht die Textausgabe unverändert weiter; die
zwei dokumentierten Sonderläufe (`--funk`, `--kalt`) über eine
Flag-Allowlist je Werkzeug. Besitzer-Ebene, weil die Ausgabe
Token-Stände und rohe Gerätezustände nennt. Ein neuer Bildschirm
(`DiagnoseScreen.tsx`) unter Einstellungen → Prüfwerkzeuge zeigt sie.

### 345 (App-Liste). Ein gemeinsamer Takt statt eigener setInterval ✓ erledigt

`useTakt` (Werkbank 241) hält im Hintergrund an und lädt beim
Zurückkommen sofort einmal neu - sieben Stellen bauten sich trotzdem
weiter ihren eigenen `setInterval`: Kamerawand, BesuchKarte,
Fortschritt, medienextras, `useSensorlinien`, der Aufnahme-Ticker in
OverviewScreen und der Bandtakt in FamilyScreen. Am Wandtablet, das
durchgehend läuft, macht das den Unterschied. Bewusst nicht angefasst:
Der Update-Poll in SystemScreen.tsx - der Kommentar dort begründet,
warum er gerade im Hintergrund nicht schweigen darf.

### 357. Einführungskapitel «Was das Haus von selbst tut» ✓ erledigt

Ein vierter Schritt in der Einführung - Nachtruhe, Abläufe,
Alarm-Kopplung -, genau das überrascht neue Mitbewohner am meisten,
wenn ein Licht ohne Tipp angeht. `EINFUEHRUNG_STAND` auf 3, damit es
auch sieht, wer die Einführung längst weggeklickt hat.

### 362. Feste Ziffernbreite auch in Listen ✓ erledigt

Punkt 296 gab der grossen Kennzahl feste Ziffernbreite; Listen mit
Beträgen (Gutscheine, Energie) blieben aussen vor - eine Liste ruckte
seitwärts, sobald sich eine Ziffer änderte. `betragGross`,
`betragEinheit`, `detailZahl`, `verlaufBetrag` (Gutscheine) sowie
`factValue`, `rowValue` (Energie) bekommen dieselbe Auszeichnung; ein
Test liest die Stildefinitionen und hält es fest.

### 365. Ein Umriss statt der Leere beim allerersten Öffnen ✓ erledigt

Abläufe hatte den Umriss (Punkt 284) schon - Familie fiel beim ersten
Öffnen (weder Zwischenspeicher noch Hub haben geantwortet) auf die
Leer-Ansicht jedes einzelnen Moduls zurück und sah aus, als gäbe es
siebzehn leere Listen. `stand` ist für genau diesen Fall `null`
(`screens/family/ablage.ts`) - jetzt steht dort ein Umriss.

### 366. Kontrast der Signalfarben auf dem Verlauf ✓ erledigt

Der Kontrasttest rechnete bisher nur weisse Schrift direkt auf dem
Verlauf (`onGradient`). Nachgerechnet zeigt sich, warum nie Rot oder
Orange: Ein fester Farbton kann nicht zugleich gegen das helle und das
dunkle Ende eines Verlaufs abstechen - im Hellen und im Sand-Bild sinkt
roh aufgelegtes Rot/Orange auf rund 1. Genau das traf auf die
Unwetterwarnung der Startkarte zu (`TopStrip.karteWarn`); sie bekommt
jetzt einen deckenden Grund (`karteWarnPille`) - im Hellen steigt der
Kontrast von 1.1 auf 3.4. Ein neuer Test hält je Palette fest, wie
schwach das rohe Rot/Orange bleibt, damit es nicht unbemerkt schwächer
wird.

### 367. Druckansicht für einen Ablauf ✓ erledigt

Ein Druck-Knopf neben Kopieren/Bearbeiten in den Abläufen, für den
Ordner oder den Babysitter. `ablaufseite.ts` zieht dieselben Sätze, die
schon im Editor mitlaufen (`ablaufsatz.ts`), in eine Liste auseinander
- Wenn, Nur wenn, Dann, Sonst - neben das Rezeptblatt aus Punkt 191/149.

### 415. Personenbilder für die Anwesenheit ✓ erledigt

Ein Gesicht statt des Symbols in «Wer ist da». `core/personenbilder.py`
ist ein dünner Wrapper um `core/raumbilder.py` - Hashen, Entpacken,
Schreiben, Aufräumen sind für ein Zimmer und eine Person dasselbe
Rechnen, nur der Ordner ist ein anderer. Neue Routen unter
`/api/persons/{name}/image`: lesen darf jeder Angemeldete, setzen und
entfernen jeder für sich selbst, für eine fremde Person nur mit
`MANAGE_USERS`. App-seitig ein Bild-Knopf im Benutzer-Detail
(`components/Personenbild.tsx`), und TopStrip zeigt das Foto in der
Anwesenheitsliste, wo eines gesetzt ist.

### 419. Musik folgt der Person ✓ erledigt, verengt

Neuer Musik-Schritt `follow`: übernimmt den laufenden Radiosender einer
Box auf eine andere und pausiert die erste. Bewusst nur der Sender,
nicht «was auch immer gerade läuft» - eine Playlist oder ein
Streaming-Dienst liesse sich über keine der angebundenen Integrationen
hinweg ehrlich fortsetzen, ein Radiosender ist dieselbe Auskunft, die
auch ein Favorit schon nutzt (`play_radio`/`station`). Der Editor
bekommt zwei Boxenwähler (woher/wohin); eine Vorlage («Musik folgt:
Raum → Raum») schlägt den wahrscheinlichsten Weg vor - die erste Box in
den Raum mit einem eigenen Bewegungsmelder -, ausgeschaltet geliefert:
Welche zwei Räume gemeint sind, weiss nur der Haushalt.

### Nicht umgesetzt, mit Begründung

- **370** (Beleg-Erkennung aus einem Foto) – keine OCR-Anbindung; eine
  hinzuzufügen wäre eine grössere, eigene Entscheidung.
- **373** (eigenes Gutschein-Widget) – natives Modul, hier ohne
  Xcode/Gradle nicht verifizierbar zu bauen.
- **383** (Variablen im Ablauf) – ein eigener Schritt-Typ quer durch
  Hub-Logik und Editor-Oberfläche, vom Umfang vergleichbar mit dem
  ganzen Gutschein-Block dieser Runde.
- **389** (Posteingang für Push) – teilweise schon da: «Zuletzt
  gemeldet» in den Push-Einstellungen zeigt die letzten Meldungen,
  ohne Bilder und ohne eigenen Bildschirm.
- **392** (kritische Meldungen als «critical alert») – braucht eine
  gesonderte Berechtigung von Apple. Vorbereitet ist es (Punkt 512):
  Eine Kategorie lässt sich auf «kritisch» stellen, die App fragt die
  Erlaubnis dafür beim Anmelden mit, und der Hub schickt den kritischen
  Ton, sobald `push.critical_alerts: true` in der config.yaml steht.
  Fehlt nur noch der Antrag bei Apple und das Entitlement in der Hülle.
- **405** (Watch-App) – ohne Xcode/watchOS-Werkzeuge hier nicht
  verifizierbar zu bauen.
- **353/340** (Lauftext misst sich falsch) – zwei frühere Versuche
  stehen oben als gescheitert; ohne eine mit Messung belegte dritte
  Fassung kein Versuch auf Verdacht.
- **363** (Abstandsraster als Test) – 913 Stellen im Code tragen heute
  eine nackte `padding`-Zahl statt eines `space`-Werts; sie alle auf
  das heutige, sehr kleine `space`-Raster (`gap`, `page`) umzustellen
  wäre ein Umbau quer durch die ganze Oberfläche, nicht ein Test dazu.
- **339** (DashboardScreen.tsx aufteilen) – bleibt bei «begonnen»
  (Punkt 268): mit 4417 Zeilen kaum gewachsen; ein sauberer Schnitt
  jetzt, obendrauf auf alles, was diese Runde sonst noch an dieser
  Datei geändert hat, wäre der riskanteste Einzelschritt der ganzen
  Liste gewesen.
- **354** (Widget-Rückmeldung) – natives WidgetKit/SwiftUI
  (`targets/widget/index.swift`), hier ohne Xcode nicht verifizierbar.
- **356, 359, 360, 361, 364** (Wisch-Übergänge am Rail,
  Kachelhöhen-Regel, Farbcodierung des Rails, Paletten-Bilddiff,
  iPhone-Quer) – alle fünf sind Layout- oder Design-Entscheidungen, die
  erst über mehrere Erscheinungsbilder und Bildschirmgrössen hinweg
  sichtbar richtig oder falsch sind; ohne eine Sitzung an der
  Browser-Probe mit echtem Hin- und Herschauen wäre das Raten statt
  Prüfen.
- **417** (Familienbuch als Jahresband) – ein eigenes Druck-Layout über
  Rezepte, Ämtli-Sterne und Kontakte eines ganzen Jahres hinweg; vom
  Umfang her ein eigener Auftrag, nicht mehr an die Reihe gekommen.

Stellen: `hub/homepilot/core/gutscheine.py`, `hub/homepilot/core/ablaufpruefung.py`, `hub/homepilot/core/automation.py`, `hub/homepilot/core/watchdog.py`, `hub/homepilot/core/watchrules.py`, `hub/homepilot/core/alarmbericht.py`, `hub/homepilot/core/gleichzeitig.py`, `hub/homepilot/core/personenbilder.py`, `hub/homepilot/api/routes/diagnose.py`, `hub/homepilot/integrations/alarm.py`, `hub/homepilot/integrations/alarm_rules.py`, `hub/homepilot/api/routes/family.py`, `hub/homepilot/api/routes/automations.py`, `hub/homepilot/api/routes/alarm.py`, `hub/homepilot/api/routes/users.py`, `app/src/lib/gutscheine.ts`, `app/src/screens/family/gutscheine.tsx`, `app/src/components/QrScanner.tsx`, `app/src/screens/automations/entwurf.ts`, `app/src/screens/automations/vorlagen.ts`, `app/src/lib/ablaufseite.ts`, `app/src/lib/mitteilungsknoepfe.ts`, `app/src/screens/AlarmScreen.tsx`, `app/src/screens/family/ablage.ts`, `app/src/lib/familiecache.ts`, `app/src/components/Personenbild.tsx`, `app/src/screens/DiagnoseScreen.tsx`

### 420. An der Kasse das Bild, das auf der Karte steht ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

«An der Kasse» (Punkt 299/300) zeichnete immer einen Strichcode - auch
für die Gutscheine, die auf der Karte einen QR-Code tragen. Aus einem
QR-Inhalt einen Code 128 zu machen ist keine Übersetzung: Die Kasse
erwartet das eine Bild und bekommt das andere. Gemerkt hat man es dort,
wo die Schlange steht.

Am Gutschein steht neu, womit die Kasse liest. Die App erfährt es aus
zwei Quellen, und die verlässlichere ist die stille: Beim Scannen
meldet `expo-camera` die gelesene Schrift ohnehin mit - sie wandert
jetzt durch `onText` bis ans Formular, das sich selbst umstellt. Von
Hand geht es darunter, gleich bei der Nummer.

Zwei Entscheidungen, die dahinter stecken:

**Ohne Angabe entscheidet die Nummer.** Sonst hätten alle Gutscheine
von vor dieser Frage weiter den falschen Code gezeigt. Was aussieht wie
eine Adresse oder länger als vierundzwanzig Zeichen ist, wird als
QR-Code gezeigt - als Code 128 wären das über dreihundert Module, auf
sieben Zentimetern Bildschirm dünner als ein Fünftelmillimeter je
Modul. Gezeichnet würde er trotzdem; gelesen von keiner Kasse.

**Nur ein gelesener QR-Code wird zu einem QR-Code.** Datamatrix und
Aztec kann die App nicht zeichnen, und sie als QR auszugeben hiesse, an
der Kasse ein Bild zu zeigen, das dort nie stand. Was daraus kein
Strichcode werden kann, fängt die Regel oben am Inhalt wieder ab.

Der QR-Code selbst kostete nichts: `react-native-qrcode-svg` steckt
seit dem Gäste-WLAN im Paket, ist reines JavaScript über
react-native-svg und rührt die `runtimeVersion` nicht an.

Nachgewiesen rot: Mit dem alten Verhalten (immer Strichcode) fallen
zwei der vier Messungen in `Kassencode.test.tsx` um. Ein Prüfstand, der
nie rot wird, ist keiner.

Stellen: `app/src/lib/strichcode.ts`, `app/src/components/Kassencode.tsx`, `app/src/components/QrScanner.tsx`, `app/src/screens/family/gutscheine.tsx`, `hub/homepilot/core/gutscheine.py`

# Teil IX: Fünfundachtzig Vorschläge (421–505), umgesetzt

Die achtundvierzig Punkte dieser Runde, die gebaut wurden. Was davon
offen blieb, steht in `werkbank.md` - dieselben Bereiche, dieselben
Nummern.

Ein Punkt ohne Häkchen-Kürzel heisst nicht «vielleicht»: In dieser Datei
steht nur, was fertig ist. Wo sich beim Bauen zeigte, dass etwas schon
da war, steht es beim Punkt selbst - das ist mehrfach vorgekommen und
ist der Grund, aus dem die CLAUDE.md mit «Schau nach, ob es das schon
gibt» anfängt.

## App allgemein (421-430)

**421. Die Browser-Probe sieht zwei Seiten von zwölf.** Gemessen werden
Startseite, Räume und der Fernseher-Fall. Familienseite, Alarm, Abläufe
und Gutscheine - die vier Bildschirme mit den meisten Formularen und
den längsten Listen - kommen nie vor. Ein seitlicher Überlauf in der
Gutschein-Liste auf dem iPhone fällt heute erst auf, wenn jemand mit
einem iPhone davorsteht. Stellen: `scripts/probe.mjs`

**423. `FamilyScreen.tsx` ist mit 4851 Zeilen die grösste Datei im
Baum** - grösser als die Startseite, für die Punkt 268/339 den Schnitt
schon beschreibt. Die Startseite hat immerhin `screens/dashboard/`; die
Familienseite hat `screens/family/` und benutzt es nur zur Hälfte. Wer
dort etwas ändert, liest eine Datei, die auf keinen Bildschirm passt.
Stellen: `app/src/screens/FamilyScreen.tsx`, `app/src/screens/family/`

**426. `hub.data` wächst, und niemand sieht zu.** Abläufe, Verlauf,
Familienlisten, Clip-Verweise und das Zugriffsprotokoll liegen in einer
Datei, die bei jedem Schreiben ganz gelesen und ganz geschrieben wird.
Die Platten-Warnung meldet, wenn es zu spät ist; was fehlt, ist die
Zahl davor - welche Sammlung wie viele Zeilen hat und welche in diesem
Monat am stärksten gewachsen ist. Stellen:
`hub/homepilot/core/persistence.py`, `hub/homepilot/api/routes/diagnose.py`

**430. Der Update-Knopf baut `main`, und die App sagt es nicht.** Das
steht in CLAUDE.md, aber wer auf einem Zweig arbeitet und auf Update
drückt, sieht einen erfolgreichen Bau ohne seine Änderung - genau der
Fehler, für den es diese Datei gibt. Unter *System*, direkt beim Knopf,
gehört hin, welcher Zweig gebaut wird und wann er zuletzt etwas
bekommen hat. Stellen: `app/src/screens/SystemScreen.tsx`,
`deploy/rebuild-hub.sh`

## Gestaltung (441-450)

**442. Fünf Erscheinungsbilder, ein Kontrastnachweis.** Hell, dunkel,
Pink, Mitternacht, Sand - geprüft wird der Hellmodus. Pink und Sand
sind die beiden, bei denen ein grauer Text auf hellem Grund durchfällt,
und niemand misst es. Stellen: `app/src/theme.tsx`,
`docs/wcag-audit-sonnenberg-baar.md`

**443. Zustandsübergänge sind weiterhin offen (Punkt 292).** Eine
Kachel springt von aus auf an. Was dazwischen fehlt, ist nicht Zierrat:
Der Sprung ist der Grund, warum man zweimal tippt - man hat nicht
gesehen, dass beim ersten Mal schon etwas geschah. Stellen:
`app/src/components/EntityCard.tsx`

**444. Die Signalfarben tragen zu viel.** Rot heisst Alarm, Fehler,
abgelaufen, offen und zu warm. Wer Rot sieht, weiss nicht, ob er
aufstehen muss. Eine Stufe dazwischen - «schau mal» gegen «jetzt» -
trennt das teuerste Signal vom häufigsten. Stellen:
`app/src/theme.tsx`, `app/src/components/Zustand.tsx`

**445. Das Wandpanel bekommt das Telefonlayout mit mehr Spalten.**
Ein Bildschirm, der immer an ist und aus zwei Metern gelesen wird,
braucht andere Schriftgrössen als eine Hand voll iPhone - nicht dieselben,
breiter verteilt. Stellen: `app/src/theme.tsx`,
`app/src/screens/DashboardScreen.tsx`

**448. Die Kachelhöhe hängt am Inhalt.** Eine Reihe mit einem
zweizeiligen Namen steht anders als die daneben. Punkt 359 nennt das
und verschiebt es auf eine Sitzung an der Probe; die Messung dafür wäre
eine Zeile und ginge heute. Stellen: `scripts/probe.mjs`,
`app/src/components/RoomCard.tsx`

## Gutscheine (451-460)

**451. Ein Gutschein kennt nur Franken und Stück.** Wer in Konstanz
einkauft oder online in Euro bestellt, trägt den Betrag als Zahl ohne
Währung ein - und die Summe oben zählt Euro zu Franken. `UNITS` um
eine Währung zu erweitern ist wenig Arbeit; die Summe dann ehrlich zu
trennen ist die eigentliche Entscheidung. Stellen:
`hub/homepilot/core/gutscheine.py`, `app/src/lib/gutscheine.ts`

**452. Ein Gutschein hat genau einen Code.** Manche Karten tragen
Nummer *und* PIN, manche einen Code je Teilbetrag, Kinokarten oft eine
Nummer je Eintritt. Heute steht alles zusammen in einem Feld, und an
der Kasse liest man vor, was die App zeichnet. Stellen:
`hub/homepilot/core/gutscheine.py`, `app/src/components/Kassencode.tsx`

**454. Es gibt keine Jahresbilanz.** `verfallen_zeitraum` rechnet, was
in einem Zeitraum verfallen ist - gezeigt wird es nirgends
zusammengefasst. «2026: 340 Franken eingelöst, 80 verfallen» ist die
eine Zahl, die das ganze Modul rechtfertigt oder widerlegt. Stellen:
`hub/homepilot/core/gutscheine.py`, `app/src/screens/HausRueckblick.tsx`

**455. Ein aufgebrauchter Gutschein verschwindet nicht von selbst.**
Rest null, seit vier Monaten - er steht weiter in der Liste, bis
jemand archiviert. Bei den Familienlisten räumt Punkt 170 das Erledigte
von selbst weg; hier nicht. Stellen: `app/src/lib/gutscheine.ts`,
`hub/homepilot/core/gutscheine.py`

**456. Doppelt erfasste Gutscheine fallen niemandem auf.** Zwei
Personen tragen dieselbe Karte ein - einmal privat, einmal für die
Familie -, und ab dann stimmt keine Summe mehr. Gleiche Nummer plus
gleicher Laden ist ein sicherer Hinweis, und die Rückfrage beim
Speichern kostet nichts. Stellen: `app/src/lib/gutscheine.ts`

**457. «Fast leer» ist kein Zustand.** Zwölf Franken Rest bei Interdiscount
sind praktisch verfallen: Man löst sie nie ein, weil man nie etwas für
zwölf Franken braucht. Eine eigene Stufe neben «bald» - mit dem
Vorschlag, den Rest beim nächsten Einkauf mitzunehmen - holt genau das
Geld zurück, das sonst still liegen bleibt. Stellen:
`app/src/lib/gutscheine.ts`

**459. Der Beleg ist eine Sackgasse.** Seit Punkt 266 hängt eine Datei
am Gutschein, und mehr passiert damit nicht. Wer die Karte verliert und
beim Laden nachfragt, braucht Beleg, Nummer und Kaufdatum zusammen als
Mail oder PDF - drei Tipper, die heute abtippen heissen. Stellen:
`app/src/screens/family/gutscheine.tsx`, `hub/homepilot/core/dateien.py`

**460. Privat heisst privat - auch beim Sichern nicht.** Die Sicherung
nimmt `hub.data` mit, und darin stehen die privaten Gutscheine im
Klartext. Das widerspricht nicht dem Versprechen des Moduls, aber
niemand hat es je ausgesprochen. Entweder steht es in der Sicherung
oder es steht in der Dokumentation - beides nicht ist die schlechteste
Variante. Stellen: `hub/homepilot/core/snapshots.py`,
`hub/homepilot/core/gutscheine.py`

## Abläufe (461-470)

**461. Ein laufender Ablauf lässt sich nicht anhalten.** «Gute Nacht»
mit drei Wartezeiten läuft zwölf Minuten. Wer nach der ersten Minute
merkt, dass noch jemand im Wohnzimmer sitzt, hat keinen Knopf - der
Ablauf fährt die Storen trotzdem. Die drei Wiederanlauf-Arten (`single`,
`restart`, `queued`) regeln den zweiten Auslöser, nicht den Abbruch.
Stellen: `hub/homepilot/core/automation.py`,
`hub/homepilot/api/routes/automations.py`

**462. Ein Widerspruch fällt erst in der Liste auf, nicht beim
Speichern.** `core/konflikte.py` sammelt gegensätzlich geschaltete
Geräte, und man quittiert sie dort. Im Editor selbst - in dem Moment,
in dem der Widerspruch entsteht - steht nichts. «Dieses Gerät schaltet
um 22:00 auch Ablauf ‹Gute Nacht›» wäre dieselbe Auskunft, eine Woche
früher. Stellen: `hub/homepilot/core/konflikte.py`,
`app/src/screens/automations/editor.tsx`

**463. Es gibt keine Variablen (Punkt 383) - und einen kleinen Ersatz
dafür.** Der ganze Schritt-Typ ist ein eigener Auftrag. Vorziehen liesse
sich das Stück, das die Hälfte der Wünsche deckt: dass eine Nachricht
den Wert eines anderen Geräts als Platzhalter tragen darf, nicht nur
den des Auslösers. Stellen: `app/src/screens/automations/entwurf.ts`,
`hub/homepilot/core/automation.py`

**464. Ein Ablauf lässt sich nicht befristen.** «Bis Ende der Ferien»,
«nur diese Woche» - heute schaltet man ihn ein und vergisst ihn. Der
Ferienmodus (Punkt 156) löst das für einen einzigen Fall; ein
Ablaufdatum gehört an jeden Ablauf, und der Hub schaltet ihn dann selbst
wieder ab. Stellen: `hub/homepilot/core/automation.py`

**465. Ein Schritt, der scheitert, meldet sich nicht.** Ist die Store
nicht erreichbar, steht das im Lauf-Verlauf - und sonst nirgends. Ein
«Gute Nacht», das zur Hälfte lief, ist schlechter als eines, das gar
nicht lief: Man glaubt, das Haus sei zu. Stellen:
`hub/homepilot/core/automation.py`, `hub/homepilot/core/push.py`

**466. Abläufe kennen keine Reihenfolge untereinander.** Zwei, die um
07:00 starten, laufen in der Reihenfolge, in der sie zufällig in der
Liste stehen. Solange das nirgends steht, ist es kein Verhalten,
sondern ein Zufall, auf den sich irgendwann jemand verlässt. Stellen:
`hub/homepilot/core/automation.py`

**467. Der Editor hat kein Zurück innerhalb einer Sitzung.**
Zurückholen gibt es - aber nur für gespeicherte Fassungen. Wer drei
Schritte umstellt, die Bedingung ändert und es dann doch anders will,
muss abbrechen und von vorn beginnen. Bei einem Ablauf mit zwölf
Schritten ist das der Grund, warum man ihn lieber nicht anfasst.
Stellen: `app/src/screens/automations/editor.tsx`

**470. Die Zeitbedingung kennt Feiertage, aber keine Schulferien.**
`except_holidays` gibt es seit Punkt 154, und die Luzerner Schulferien
liegen im Hub (`core/schulferien.py`) - benutzt werden sie nur von der
Simulation. «Wecklicht um 06:30» ist im Juli falsch, und heute stellt
das jemand von Hand ab. Stellen: `hub/homepilot/core/automation.py`,
`hub/homepilot/core/schulferien.py`

## Push-Benachrichtigungen (471-480)

**471. Einstellungen gelten je Benutzer, nicht je Gerät.** Wer sich mit
Telefon und iPad anmeldet, bekommt auf beiden dasselbe - auch die
Ruhezeit gilt für beide gleich. Das iPad liegt nachts im Wohnzimmer und
darf klingeln; das Telefon liegt neben dem Bett. `PushDevice` trägt
bereits `label`, die Einstellungen hängen aber am Namen. Stellen:
`hub/homepilot/core/push.py`, `hub/homepilot/core/pushruhe.py`

**472. Es gibt keinen Posteingang (Punkt 389 zu Ende gedacht).**
«Zuletzt gemeldet» steht in den Push-Einstellungen, ohne Bild, ohne
Knöpfe, ohne Ort. Eine weggewischte Klingel ist damit endgültig weg,
obwohl das Standbild im Hub liegt. Stellen:
`hub/homepilot/core/pushverlauf.py`, `app/src/components/PushBlatt.tsx`

**475. Eine Meldung weiss nicht, ob sie angekommen ist.** Expo liefert
Quittungen, `parse_receipts` liest sie - für tote Token. Dass eine
wichtige Meldung bei niemandem ankam, führt zu keinem zweiten Weg und
zu keinem Hinweis. Beim Alarm ist das der teuerste stille Fehler, den
das System hat. Stellen: `hub/homepilot/core/push.py`

**477. Die Kategorienliste wächst schneller als ihre Gruppen.** Über
vierzig Kategorien in acht Gruppen, und die Einstellungen zeigen sie
als lange Liste mit Schaltern. Wer etwas abstellen will, sucht - und
schaltet im Zweifel die Gruppe ab, in der auch das Wichtige steckt.
Stellen: `app/src/components/PushPrefs.tsx`,
`hub/homepilot/core/push.py`

**478. Ein Knopf unter der Meldung wirkt für alle.** «Ich mach's» ist
genau richtig so. «Später» und «Passt so» sind es nicht: Wer nachts die
Batteriewarnung wegdrückt, drückt sie auch dem anderen weg - der sie am
Morgen gebraucht hätte. Stellen: `hub/homepilot/core/push.py`,
`app/src/lib/mitteilungsknoepfe.ts`

**479. Die Ruhezeit kennt Stunden, nicht Tage.** Eine Zahl von-bis für
die ganze Woche. Samstagmorgen ist nicht Dienstagmorgen, und die
Ferienwoche ist keine Arbeitswoche. Stellen:
`hub/homepilot/core/pushruhe.py`

**480. Kritische Meldungen sind bewusst nicht möglich (Punkt 392) - und
niemandem gesagt.** Ohne Apples Berechtigung hält ein aktiver Fokus den
Alarm auf. Wer die Anlage scharf schaltet, sollte einmal lesen, dass
ein «Nicht stören» sie stumm stellt - das ist keine Technikfrage,
sondern eine Sicherheitsauskunft. Stellen:
`app/src/components/PushPrefs.tsx`, `app/src/screens/AlarmScreen.tsx`

## Alarmanlage (481-490)

**481. Die Sirene wird nie geprüft.** Es gibt einen Sensortest (Punkt
403) und einen drei Sekunden langen Ton beim Prüfen der Aktionen. Was
fehlt, ist der regelmässige Selbsttest: eine Sirene, die seit dem
Einbau nicht mehr geheult hat, heult vielleicht auch beim Einbruch
nicht. Einmal im Quartal, mittags, drei Sekunden - und ein Eintrag, der
es festhält. Stellen: `hub/homepilot/integrations/alarm.py`

**482. Es gibt kein Vorlauf-Bild.** Beim Auslösen beginnt die Aufnahme
(`_start_clip`) - also erst, wenn schon jemand drin ist. Die
interessanten fünf Sekunden liegen davor, und Protect hält sie
ohnehin vor. Stellen: `hub/homepilot/core/cliparchiv.py`,
`hub/homepilot/core/streams.py`

**484. Der Nachbericht bleibt im Haus.** Punkt 337 schreibt zusammen,
was bei einem Alarm geschah. Für die Polizei oder die Versicherung
braucht es dasselbe als Blatt mit Zeiten, Bildern und Sensoren - und
zwar in der Stunde danach, nicht drei Tage später aus der Erinnerung.
Stellen: `hub/homepilot/core/alarmbericht.py`

**485. Fehlalarme werden gezählt, nicht ausgewertet.** Die Statistik
(Punkt 407) sagt, wie viele es waren. Welcher Sensor sie verursacht hat
und ob er in einem Modus besser schweigen sollte, muss man sich selbst
zusammenreimen. Stellen: `hub/homepilot/integrations/alarm.py`,
`hub/homepilot/core/alarmbericht.py`

**486. Die Anlage ist nur in der App zu bedienen.** Widget und Knopfwand
tragen Licht und Szenen; das Scharfschalten fehlt - vermutlich aus
gutem Grund, aber nirgends aufgeschrieben. Unscharf am Widget wäre
gefährlich, scharf zu schalten nicht. Stellen:
`app/targets/widget/index.swift`, `app/src/lib/auto.ts`

**487. Die Eingangsverzögerung sagt nicht, wie viel Zeit bleibt.** Sie
läuft im Hub und ist dort korrekt. Wer zur Tür hereinkommt, sieht sie
erst, wenn er die App öffnet - dann sind zehn der dreissig Sekunden
weg. Ein Ton, der schneller wird, tut dasselbe ohne Bildschirm.
Stellen: `hub/homepilot/integrations/alarm.py`,
`hub/homepilot/core/klingelton.py`

**488. Es gibt keinen Haustier-Modus.** Für den Saugroboter gibt es
einen (`_sauger_deckt`, `DURCHBRUCH`) - und die Überlegung dahinter
passt eins zu eins auf eine Katze: Kameras, die Tiere erkennen,
schweigen; Melder, die es nicht können, sind ehrlich ausgenommen.
Stellen: `hub/homepilot/integrations/alarm_rules.py`

**489. Es gibt keinen Wartungsmodus.** Fensterputzen, ein Handwerker im
Haus, ein Umzugstag: Alles steht offen, und die einzige Antwort darauf
ist «ganz unscharf». Ein befristeter Modus, der sich am Abend von selbst
wieder scharf schaltet, ist der Unterschied zwischen einer Ausnahme und
einer Anlage, die seit dem Küchenumbau aus ist. Stellen:
`hub/homepilot/integrations/alarm.py`,
`hub/homepilot/integrations/alarm_rules.py`

**490. Ein Alarm wird nie von Hand eingeordnet.** Die
Fehlalarm-Statistik rät ihn sich aus: unter sechzig Sekunden entschärft,
mindestens dreimal - dann gilt der Sensor als Kandidat. Ein echter
Einbruch, den jemand schnell entschärft, zählt damit als Fehlalarm, und
ein Fehlalarm, den zehn Minuten lang niemand bemerkt, zählt als echt.
Die eine Frage beim Entschärfen - «war das echt?» - ersetzt die ganze
Schätzung. Stellen: `hub/homepilot/core/alarmbericht.py`,
`app/src/screens/AlarmScreen.tsx`

## Selbst gewählt (491-505)

**491. Die drei Prüfwerkzeuge des Hubs sind fünf.** `storencheck`,
`livecheck`, `tvcheck`, `saugercheck`, `pushcheck` - jedes einzeln über
`docker exec` aufzurufen, jedes mit eigener Ausgabe. Wer im Haus steht
und nicht weiss, woran es liegt, braucht eines: «prüf alles und sag
mir, was auffällt». Stellen: `hub/homepilot/`,
`app/src/screens/DiagnoseScreen.tsx`

**495. Ein Gerätename ist an fünf Stellen derselbe und nirgends
gemeinsam.** Wer ein Licht umbenennt, ändert die Kachel - Szenen,
Abläufe, Sprachbefehle und Widgets tragen den alten Namen weiter, bis
jemand sie einzeln anfasst. «Gerät ersetzen» kann das bereits; das
Umbenennen kann es nicht. Stellen:
`hub/homepilot/core/replace.py`, `hub/homepilot/core/registry.py`

**497. Die Kinderseite hat keine Grenze.** Es gibt die Rolle «Kind»
(Punkt 245) und eine eigene Seite. Was ein Kind darf - Licht im eigenen
Zimmer ja, Haustür nein, Alarm nie - steht heute in der Seite und nicht
in einer Regel, die der Hub durchsetzt. Stellen:
`hub/homepilot/core/users.py`, `app/src/lib/kindseite.ts`

**498. Der Gast-Zugang endet, das Aufgeräumte nicht.** Ein Gastpass
läuft ab (Punkt 246) - was er hinterlässt (Sitzungen, Protokolleinträge,
WLAN-Schein), bleibt. Nach einem Jahr Gästen ist das die längste Liste
im Haus. Stellen: `hub/homepilot/core/guestpass.py`,
`hub/homepilot/core/sessions.py`

**503. Eine neue Integration kostet mehr Papier als Code.**
`docs/neue-integration.md` beschreibt es gut - trotzdem sind es jedes
Mal dieselben acht Stellen: Modul, Registrierung, Entitätstypen, Test,
Demo-Fall, Dokumentation, Kachel, Symbol. Ein Gerüst-Skript, das die
acht anlegt, ist eine halbe Stunde Arbeit und spart sie bei jeder
weiteren Anbindung. Stellen: `hub/docs/neue-integration.md`,
`hub/homepilot/integrations/`

**504. Der Gremlin ist einer.** Der zappelige Fernseher hat gezeigt,
wozu ein bösartiges Demo-Gerät taugt. Es fehlen seine Geschwister: die
Store, die eine alte Stellung meldet; der Sensor, der Unsinn schickt;
die Anbindung, die zehn Sekunden braucht. Jeder von ihnen entspricht
einem Fehler, der hier wirklich passiert ist. Stellen:
`hub/homepilot/integrations/gremlin.py`

**505. Diese Datei steht an zwei Orten.** `CLAUDE.md` erklärt, wie hier
gearbeitet wird; `docs/werkbank.md` ist die Liste dessen,
was ansteht - und enthält längst mehr Begründung als Aufgabe. Was
erledigt und begründet ist, gehört in ein Archiv daneben; die Werkbank
selbst soll die Frage «was ist offen?» in dreissig Sekunden beantworten.
Heute beantwortet sie sie in zwanzig Minuten. Stellen:
`docs/werkbank.md`, `CLAUDE.md`

# Teil X: Aus derselben Woche, auf einem anderen Zweig (506–509)

Vier Punkte, die eine zweite Sitzung am selben Abend gebaut hat. Sie
stehen hier und nicht in einem der Teile darüber, weil sie erst beim
Zusammenführen der Zweige dazugekommen sind - und weil der erste von
ihnen die Geschichte erzählt, warum man vor dem Vergeben einer Nummer
nachsieht, was anderswo liegt.

*Diese Arbeit stand zuerst als Punkt 421 da. Zwei Sitzungen haben am
selben Abend dieselbe Nummer vergeben: hier für etwas Gebautes, dort für
den Anfang der fünfundachtzig Vorschläge darüber. Verschoben wurde
diese, weil sie allein steht - der andere Block hängt an 43 Dateien mit
«Punkt NNN der Werkbank» im Kommentar. Umnummeriert wird hier sonst
nie; wer «Punkt 421» sucht, findet ihn oben, und zwar als Vorschlag.*

### 506. Mehr Klingeltöne, und anhören darf man sie dort, wo man sitzt ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

Sechs Töne standen zur Wahl, und die Testtaste spielte sie auf den
**Boxen** im Haus. Beides zusammen macht das Aussuchen unmöglich: Zu
wenig Auswahl, um einen zu finden, den man mag - und wer ihn hören
will, muss neben der Küchenbox stehen, während das Telefon mit der
Auswahl im Wohnzimmer liegt. In der Praxis hat darum niemand
durchprobiert; es blieb beim ersten.

**Achtzehn statt sechs.** Dazugekommen sind Kuckuck-Nachbarn für den
klassischen Geschmack (Bim-Bam, Westminster, Glocke, Gong, Harfe,
Spieluhr), zwei nüchterne Signale (Piepser, Schiffshorn, Sirene) und
drei zum Schmunzeln (Fanfare, Roboter, «Alle meine Entchen»). Alle
weiterhin aus Zahlen gerechnet - kein Ton liegt als Datei im Abbild,
keiner braucht eine Lizenz.

**Eine Hüllkurve macht aus Zahlen einen Klang.** Ein Sinus mit flachem
Pegel klingt immer gleich; «Glocke» und «Hupe» wären dasselbe mit
anderen Frequenzen gewesen. Ein Klang trägt darum neu `abklingen`:
laut angeschlagen, dann ausschwingend. Glocken, Harfe und Gong haben
es, Hupe und Sirene bewusst nicht - eine Hupe, die ausschwingt, ist
keine Hupe mehr. Es kostet eine Multiplikation je Wert.

**Antippen spielt hier ab.** Ein Tipp auf einen Chip wählt den Ton
*und* spielt ihn auf dem Gerät in der Hand. Die alte Testtaste bleibt
daneben, heisst jetzt aber «Auf den Boxen» - sie beantwortet die andere
Frage, nämlich wie laut das im Flur ist. Wer nur zuhören darf (kein
Bearbeitungsrecht), hört trotzdem: Der Chip spielt, wählt aber nicht.

Zwei Dinge, die das billig gemacht haben:

- **Kein neues natives Modul.** `expo-video` steckt seit den Aufnahmen
  in der Hülle und spielt eine WAV-Datei wie ein Video. Damit bleibt
  `runtimeVersion` bei `"7"` - eine Erhöhung hätte einen
  TestFlight-Build nach sich gezogen, nur um sich Töne anzuhören.
  `expo-audio` kam nicht in Frage (Punkt 223: drei Tage schwarzer
  Start).
- **Das Token steht in der Adresse.** Audio-Player schicken keine
  eigenen Kopfzeilen mit - derselbe Weg wie bei den Aufnahmen
  (`lib/aufnahmeurl.ts`), und `token_from` in `api/server.py` liest
  ihn dort bereits.

Beim Erweitern der Liste ist «Kuckuck» einmal herausgefallen - ein
entfernter Schlüssel fällt still auf die Vorgabe zurück, die Wahl wäre
also weg gewesen, ohne dass es jemand merkt. Ein Test hält die sechs
ursprünglichen Schlüssel jetzt fest.

Stellen: `hub/homepilot/core/klingelton.py`, `hub/homepilot/api/routes/push.py`, `app/src/lib/klingeltonprobe.ts`, `app/src/components/Klingelprobe.tsx`, `app/src/components/Klingelprobe.web.tsx`, `app/src/components/PushRules.tsx`

### 507. Die Räume-Seite gehört den Räumen ✓ erledigt

*lohnt sich · Aufwand: klein · App*

(Geschrieben als 422/423 und sofort weitergerückt: Die Nummern gehören
den fünfundachtzig Vorschlägen oben, die eine andere Sitzung am selben
Abend vergeben hat. Dasselbe war schon der 421 passiert - wer hier eine
Nummer vergibt, sieht zuerst nach, was auf den anderen Zweigen liegt:
`python3 deploy/zweige.py pruefen`.)

Rechts neben den Raumkacheln stand die Spalte mit Wetter und
Hausmusik, und darüber zwei breite Schaltzeilen («Feste Reihenfolge»,
«Feste Raum-Reihenfolge»). Beides beantwortet keine Frage, die man auf
dieser Seite stellt: Wer «Räume» öffnet, sucht ein Zimmer.

**Die Spalte fällt weg** - aus demselben Grund, aus dem sie im offenen
Zimmer schon weg war (Punkt 275, `lib/seitenspalte.ts`). Neu heisst
der Grund nicht nur «beantwortet nichts», sondern auch: Die
Raumkacheln tragen Fotos, und 340 Punkte daneben kosteten auf dem iPad
eine ganze Kachelspalte. Die Startseite behält sie - sie ist die
Seite, auf der man stehen bleibt.

**Die zwei Schalter ziehen um** in die Kontoeinstellungen, unter
«Kacheln» (Punkt 508). Eine Reihenfolge stellt man einmal ein; bis
dahin nahmen sie den Platz von zwei Raumkacheln weg, und zwar auf
jedem Gerät bei jedem Öffnen.

Nachgewiesen rot: Die Browser-Probe misst neu beides - dass die
Startseite die Spalte behält und dass die Raumliste sie nicht hat. Mit
dem alten Verhalten fällt die zweite Messung um, mit einem kaputten
Messpunkt die erste. Gemessen wird am Lautsprecher-Wähler der
Musikkarte und nicht am Wetter: Der Demo-Hub hat kein Wetter, und eine
Messung, die schon am Prüfstand nichts findet, misst die Regel nicht.

Stellen: `app/src/lib/seitenspalte.ts`, `app/src/components/SidePanel.tsx`, `app/src/screens/DashboardScreen.tsx`, `scripts/probe.mjs`

### 508. Kontoeinstellungen: drei Karten statt einer Wand ✓ erledigt

*lohnt sich · Aufwand: mittel · App*

Unter «Erscheinungsbild» standen sechs Dinge untereinander, die
miteinander nichts zu tun haben: Farbe, Kachelgrösse, App-Symbol,
Grundriss, Wandpanel-Modus, Kindermodus. Die Überschrift passte auf
das erste. Wer den Wandpanel-Modus suchte, scrollte an drei
Chipreihen vorbei und fand ihn dort, wo er ihn nicht vermutete.

**Jede Karte beantwortet jetzt eine Frage.** «Erscheinungsbild» (Farbe
und App-Symbol), «Kacheln» (Grösse und Reihenfolge), «Fest montiert»
(Grundriss, Wandpanel, Kindermodus) - Letztere zuletzt im Block, weil
sie auf den meisten Geräten im Haus die Antwort auf eine Frage ist,
die niemand stellt.

**Ein Schalter sieht überall gleich aus.** Dieselbe Sache sah bisher je
nach Ort anders aus: in den Einstellungen ein Schieber mit Knopf, auf
der Startseite ein `toggle`-Symbol in Akzentfarbe. Neu gibt es eine
Zeile für alle (`components/Schalterzeile.tsx`), und die ganze Zeile
ist der Schalter, nicht nur der Schieber rechts - ein Ziel von 48
Punkten neben einer dreizeiligen Erklärung trifft man am Wandpanel im
Vorbeigehen nicht.

**Die Farbwahl zeigt Farbe.** Sieben gleich aussehende Wortpillen:
«Neonpink», «Mitternacht», «Sand». Was davon hell ist und was dunkel,
erfuhr man nur durchs Ausprobieren - und wer eines antippte, musste
sich durch die anderen zurücktippen. Neben jedem Wort steht jetzt ein
Fleck aus beiden Enden des Verlaufs (`lib/themenprobe.ts`). «System»
und «Nach Sonnenstand» zeigen hell über dunkel, weil sie beides sind.

Dazu zwei Doppelungen weg: «Kacheln» stand als Kartentitel *und* als
Feldbeschriftung darunter (jetzt «Grösse»), «Benachrichtigungen» als
Abschnitts-Überschrift *und* zwei Zeilen darunter als Kartentitel
(jetzt nur noch als Karte).

Stellen: `app/src/screens/SettingsScreen.tsx`, `app/src/components/Schalterzeile.tsx`, `app/src/lib/themenprobe.ts`, `app/src/screens/DashboardScreen.tsx`, `app/src/lib/einstellungsgruppen.ts`, `docs/einstellungen.md`

### 509. Der Medienplayer steht auch auf der Raumliste im Kopf ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Punkt 507 hat die Spalte rechts von der Raumliste genommen - mit ihr
ging die Musik des Hauses weg, und die war das Einzige daran, das man
dort wirklich bediente. Sie kommt zurück, aber nicht als Spalte: oben
im Kopf, neben der Begrüssung, als dieselbe Karte, die im Zimmer im
Raumkopf steht (`imKopf` - ohne Rand, ohne eigene Überschrift).

Das kostet keine Kachelspalte: Neben «Guten Morgen, Stefan» lag ohnehin
nichts als Luft. Damit die linke Hälfte auch etwas trägt, ist die
Klimazeile mitgewandert - sie stand als eigene Zeile zwischen Kopf und
Kacheln, und dort war sie eine Zeile Höhe für eine Zahl. Jetzt ist der
Kopf gebaut wie der Raumkopf: links Begrüssung und Klima, rechts die
Musik.

**Ab Tablet-Breite, nicht auf dem Telefon.** Dort schöbe der Player die
Raumkacheln unter den Rand - genau der Grund, aus dem die Spalte auf
dem Telefon nie stand.

Vorgewählt ist die Lautsprechergruppe fürs ganze Haus, wie auf der
Startseite: Ohne offenes Zimmer gibt es keine naheliegende Box, und der
Wähler stünde sonst leer auf «Box wählen», bis jemand selbst tippt.

Nachgewiesen rot, und zwar erst im zweiten Anlauf: Die erste Messung
zählte, ob ein Player dasteht - das tut er in beiden Fassungen, also
war sie auch für die alte grün. Ein Prüfstand, der nie rot wird, ist
keiner. Gemessen wird jetzt, was die zwei wirklich unterscheidet: was
den Raumkacheln an Breite bleibt.

Stellen: `app/src/screens/DashboardScreen.tsx`, `app/src/screens/dashboard/stile.ts`, `scripts/probe.mjs`

# Teil XI: Zweite Vorschlagsrunde des anderen Zweigs (510–533)

Vierundzwanzig Punkte, die eine zweite Sitzung derselben Woche gebaut
hat - aus derselben Liste von fünfundachtzig Vorschlägen wie Teil IX,
nur anders ausgewählt.

**Warum sie nicht 421–444 heissen.** Genau so standen sie auf ihrem
Zweig, und genau so heissen in Teil IX die Vorschläge selbst. Zum
dritten Mal an einem Abend hatten zwei Sitzungen dieselben Nummern
vergeben; 506–509 sind schon einmal aus demselben Grund gewandert.
Verschoben wurde wieder der Block, der für sich steht - die
fünfundachtzig Vorschläge hängen an Dutzenden Dateien mit «Punkt NNN
der Werkbank» im Kommentar und an der Gliederung dieses Archivs. Die
Verweise im Code dieses Blocks sind mitgewandert (111 Zeilen in 52
Dateien).

Daraus die Regel, die in der CLAUDE.md steht und hier zum dritten Mal
ihren Beleg bekommt: **vor dem Vergeben einer Nummer nachsehen, was auf
den anderen Zweigen liegt** - `python3 deploy/zweige.py pruefen`.

### 510. Standbild im Lauf-Verlauf ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

«Bewegung an der Kamera Garten → Licht an» stand im Verlauf nur als
Satz; was die Kamera dabei sah, war nach zehn Minuten weg
(core/snapshots.py). Löst eine Kamera aus, holt der Lauf jetzt beim
Start ein Standbild – vor den Schritten, nicht danach, sonst ist die
Person längst aus dem Bild – und legt es ins Bildarchiv des Alarms
(core/bildarchiv.py, dieselbe Frist). Der Lauf trägt die Kennung, die
App zeigt die Vorschau unter dem Lauf; Route
`/api/automations/bild/{kennung}` unter dem Verlaufs-Recht.

### 511. Ablauf-Editor aufgeteilt ✓ erledigt

*Aufwand: mittel · App*

`editor.tsx` war auf 2900 Zeilen angewachsen. Jetzt drei Dateien:
`editor.tsx` (Editor, Fassungen, Simulation), `ausloeser.tsx`
(TriggerRow) und `schritte.tsx` (StepList, Bedingungen, Wiederholung).
Die alten Exporte bleiben unter `editor.tsx` erreichbar. Im selben
Zug nennt jede eingebaute Vorlage ihre Gruppe als Feld statt über
einen Regex auf den Titel (`vorlagen.ts`).

### 512. Dringlichkeit je Kategorie ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

Was warten darf, stand fest im Code (`LEISE`). Jetzt hat jede
Kategorie eine Stufe fürs Haus – leise, dringend, kritisch –, die
unter Konto → Benachrichtigungen im Detail der Kategorie steht, für
die, die Einstellungen ändern dürfen. Fürs Haus und nicht je Person,
weil die Stufe beschreibt, was die Meldung *ist*; wer sie für sich
nicht will, bestellt sie ab. Ablage `push_stufen`, Route
`PUT /api/push/stufe`. «Kritisch» ist die Vorbereitung auf 392.

### 513. Empfängergruppen ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

«Eltern» statt «Stefan» und «Livia» in jedem Ablauf. Eine Gruppe ist
im Ablauf-Editor ein Ziel (`to: "gruppe:Eltern"`), bei den
Erinnerungen ebenso, und wird unter Konto → Benachrichtigungen
gepflegt. Mitglieder, die es als Benutzer nicht gibt, fallen still
weg; eine Gruppe ohne Mitglieder erreicht niemanden und wird gar nicht
erst geführt. Ablage `push_gruppen`, Routen `/api/push/gruppen`.

### 514. «Später» mit eigener Dauer ✓ erledigt

*Aufwand: klein · Hub + App*

Der Knopf in der Mitteilung hiess fest «In 30 Min nochmal». Am Herd
meint man eine Viertelstunde, im Bett den Morgen. Der Knopf heisst
jetzt «Später nochmal», die Zahl (15 min, 30 min, 1 h, 2 h) steht je
Person unter Konto → Benachrichtigungen, und der Hub nimmt sie, wenn
die App keine mitschickt. Nebenbei behoben: Das Abbestellen einer
Kategorie ersetzte die ganze Push-Zeile der Person und warf Ruhezeit
und Stillgestelltes mit weg.

### 515. Eigene Alarm-Modi ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub + App*

«Nacht», «Ausser Haus», «Urlaub» decken das Übliche - nicht «Nur
Erdgeschoss» oder «Gäste da». Ein eigener Modus ist ein Name, ein
Symbol und ein Schlüssel daraus (`alarm_rules.modus_schluessel`);
welche Sensoren darin wachen, steht wie bei den eingebauten an den
Sensoren, die dafür einen eigenen Reiter bekommen. Die Modi kommen
als Liste vom Hub (`config_dict()["modes"]`), die App zeichnet ihre
Knöpfe daraus statt drei feste zu kennen (`lib/alarmmodi.ts`).
Abläufe erreichen einen eigenen Modus über den Befehl `arm` mit
`mode` als Wert. Wird ein Modus gestrichen, verschwindet er auch aus
den Sensoren und dem Nachverhalten - sonst wachte er als Geist weiter.

### 516. Voralarm «Verdacht» ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + App*

Der erste sofortige Melder allein machte die Anlage laut. Mit
`suspect_delay` (Sekunden, 0 = aus) wird sie erst misstrauisch:
Zustand `verdacht`, Nachricht mit Bild, die Vorwarn-Befehle - aber
keine Sirene. Meldet sich ein *zweiter* Melder, ist es keine
Vermutung mehr und der Alarm kommt sofort; derselbe Melder noch einmal
zählt nicht. Wer in der Frist entschärft, hat einen Fehlalarm, von dem
die Nachbarn nichts gehört haben. Die Eingangsverzögerung bleibt, was
sie war: Sie gilt den verzögerten Sensoren, der Voralarm den
sofortigen.

### 517. Face ID vor dem Entschärfen ✓ erledigt

*Aufwand: klein · App*

Die Face-ID-Sperre (Konto) galt für Türe und Kacheln, nicht für den
grossen Knopf «Unscharf schalten» auf dem Alarm-Bildschirm. Jetzt
fragt er zuerst das Gesicht, dann die PIN - und nur beim ersten
Anlauf: Wer die PIN schon tippt, hat das Gesicht eben gezeigt. Ohne
Biometrie am Gerät lässt die Sperre durch; die PIN des Hubs bleibt die
eigentliche Hürde.

### 518. Klingelton nachts leiser oder still ✓ erledigt

*Aufwand: klein · Hub + App*

Ein Gong um Mitternacht weckt das ganze Haus - dabei ist der Pöstler um
diese Zeit ohnehin nicht da. Die Klingelton-Karte (Abläufe → Push →
«Es klingelt») hat jetzt eine Nachtregel: wie am Tag, leiser (30 %)
oder still, mit Stunden «ab» und «bis». Die Push-Nachricht kommt in
jedem Fall; die Testtaste hört auch nachts etwas
(`klingelton.lautstaerke_jetzt`, rechnet wie `nachtruhe.still`).

### 519. «Es klingelt» als Ansage - auch auf dem Fernseher ✓ erledigt, verengt

*Aufwand: klein · Hub + App*

Gewünscht war eine Meldung auf dem Fernseher, wenn es klingelt (die
Klingel hat keine Kamera, also nur der Satz). Ein Bild einblenden kann
der Hub auf einem Android TV nicht: Die Fernbedienungs-Schnittstelle
kennt nur Tasten und App-Starts, keine Einblendung. Was geht: der Satz
als Ansage. Nach dem Gong spricht der Hub «Es klingelt.» (Text
einstellbar) auf denselben Boxen - und ein Fernseher mit Google Cast
ist eine solche Box; er steht in der Boxen-Auswahl der Klingelton-Karte.
Auf einem Fernseher ohne Cast bleibt es bei der Push-Nachricht.

### 520. Mehrere Belege je Gutschein ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub + App*

Bestellbestätigung und Gutschein-PDF gehören beide an den Eintrag,
und bisher passte nur eines. Jetzt führt der Gutschein `files`, eine
Liste von Datei-Blöcken; jede weitere Datei trägt eine Kennung und
liegt als `<eintrag>_f_<kennung>.<endung>` neben der ersten, die ihren
alten Namen behält. `file` bleibt der erste Block, damit ältere
App-Fassungen weiter einen Beleg sehen; wer eine Datei aus der Liste
nimmt, nimmt sie von der Platte (`dateien.aufraeumen`). «Aus Beleg
übernehmen» liest alle Belege hintereinander - der Betrag steht im
einen, die Nummer im anderen. Höchstens sechs je Gutschein.

### 521. Stern und Raum im Langdruck-Menü ✓ erledigt

*Aufwand: klein · App*

Das Langdruck-Menü der Kachel gab es schon (Verlauf, Erinnern,
Umbenennen, Sperren, Zählung, Doppeltipp). Dazu kommen die zwei
Handgriffe, für die man sonst das Blatt öffnete: «Als Favorit» (oder
«Kein Favorit mehr») und «In anderen Raum». Der Stern steht vor dem
Umbenennen - er ist der Griff, den man täglich macht
(`lib/kachelmenue.ts`).

### 522. Wischen zwischen den Bereichen ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Auf dem Telefon wechselt ein waagrechtes Wischen über die Seite zum
Nachbarn in der Leiste - nach links «weiter», nach rechts «zurück», am
Rand endet es. Nur ohne Seitenleiste, nicht im Zimmer (dort heisst
Wischen «zurück», lib/zurueckwischen.ts) und nicht beim Anpassen. Die
Geste wird erst während der Bewegung beansprucht, damit Wischdimmer,
Kachel am Finger und Storen-Leiste Vorrang behalten
(`lib/bereichwischen.ts`, `hooks/useBereichWischen.ts`).

### 523. iPhone im Querformat ✓ erledigt, verengt

*Aufwand: klein · App*

Die Ausrichtung war nie gesperrt (`orientation: default`), und ab
700 Punkten Breite kommt die Seitenleiste - im Querformat also auch
auf dem Telefon. Was fehlte, waren die seitlichen Sicherheitsabstände:
Die Aussparung des iPhones liegt quer an der Seite, und die Leiste
sass darunter. Der Rahmen nimmt jetzt auch `insets.left/right`.
Ob das auf dem Gerät so aussieht wie gedacht, sagt nur das Gerät
(CLAUDE.md: was der Browser nicht beantwortet).

### 524. Posteingang hinter der Glocke ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Werkbank 389, fertig gemacht: Eine Glocke in der Kopfzeile der
Startseite öffnet den Posteingang (`components/Posteingang.tsx`).
Zuoberst, was das Haus für mich zurückgehalten hat (Ruhezeit,
stillgestellt, Tagesdeckel - `/api/push/verpasst`), darunter zum
Nachschlagen die letzten Tage. Die Zahl an der Glocke ist, was seit
dem letzten Öffnen dazukam; der Zeitpunkt liegt beim Hub
(`posteingang.gesehen` in lib/persoenlich.ts), damit das iPad nicht
zeigt, was das Telefon längst gelesen hat.

### 525. Die Leiste in der Farbe des Orts ✓ erledigt

*Aufwand: klein · App*

Werkbank 360, gebaut: Der gewählte Punkt der Leiste trägt eine
durchscheinende Tönung im Farbwinkel des Bereichs (`lib/bereiche.ts`:
bereichTon - Licht warm, Kameras kühl, sieben feste Winkel) und im
Zimmer im Winkel des Raums (`raumTon`, dieselbe Farbe wie die
Raumkachel und der Raumkopf). So weiss man beim Hinsehen, wo man ist,
bevor man den Namen liest. Durchscheinend, damit sie auf jedem
Erscheinungsbild neben der Leistenfläche besteht.

### 526. Drei Stufen für Symbole ✓ erledigt, verengt

*Aufwand: klein · App*

`theme.icon = { klein: 16, mittel: 18, gross: 22 }`. Über die Dateien
hinweg standen 12 bis 24, jede Stelle hatte sich ihre Zahl ausgesucht.
Umgestellt sind Kopfzeile, Leiste und Posteingang; der Rest folgt
Stelle für Stelle, wenn man ohnehin dort ist - ein Massensuchlauf über
fünfzig Dateien tauschte auch Zahlen, die absichtlich abweichen.

### 527. Der Übergang beim Schalten ✓ erledigt, beim Zusammenführen in Punkt 443 aufgegangen

*Aufwand: klein · App*

Werkbank 292 hatte entschieden, Kacheln nicht überblenden zu lassen:
«Unruhe ist teurer als der Gewinn». Auf Wunsch des Hauses jetzt doch,
aber so klein wie möglich: Der Punkt der Lichtkachel blendet in 150 ms
von aus nach an, statt umzuspringen - kurz genug, dass nichts wackelt,
lang genug, dass das Auge den Wechsel als Antwort liest. Wer «Bewegung
reduzieren» eingestellt hat, bekommt den Sprung
(`hooks/useBewegungReduziert.ts`, auch von `Auftritt` benutzt).

### 528. Die Kachelhöhen-Regel ✓ erledigt

*Aufwand: klein · App*

Werkbank 359: Jede Kachel ist mindestens `theme.kachel.mindesthoehe`
hoch (138, vorher eine nackte Zahl in `Card.tsx`), und in einer Zeile
des Rasters gibt die höchste die Höhe vor - `alignItems: 'stretch'`
ausdrücklich am Raster, nicht als Zufall der Vorgabe.

### 529. Deckel fürs Mitwachsen auf der Lichtkachel ✓ erledigt

*Aufwand: klein · App*

Werkbank 66, eine Stelle weiter: Wert, Name und Unterzeile der
Lichtkachel und der grosse Wert der übrigen Kacheln wachsen bis 160 %
mit der Systemschrift mit und halten dann (`lib/schrift.ts`:
MAX_SCHRIFT) - bei 200 % schob der Wert sonst den Namen aus der Kachel.
Fliesstext wächst weiter unbegrenzt mit; das soll so bleiben.

### 530. Lauftext: Messung und Anzeige getrennt ✓ umgebaut, Nachweis offen

*Aufwand: klein · App*

Werkbank 353, so gebaut wie dort beschrieben: Der Messkasten bleibt
immer 4000 Punkte breit und unsichtbar (`position: absolute`, im
Fenster abgeschnitten), der Text darin meldet bei jedem Durchgang
seine eigene Breite; der animierte Kasten daneben hat die gemessene
Breite und misst nichts. Die Browser-Probe hat dazu eine Messung
bekommen: Ein Gerät schaltet beim Start und noch einmal nach der
ersten Wanderung (die Startseite baut sich über den WebSocket neu
auf), danach muss die Zeile weiter wandern.

Ehrlich dazu: Diese Messung war auch mit der alten Fassung grün - der
Fall aus 353 («ein zusätzlicher Abruf beim Start») liess sich in der
Probe nicht nachstellen, weder über einen Zustandswechsel noch über
eine Fenstergrösse. Der Umbau ist damit die vorgeschlagene, sauberere
Bauart, aber kein bewiesener Fehlerfix. Wer den alten Fehler wieder
sieht, hat mit der neuen Messung wenigstens einen Platz, an dem er
ihn festhalten kann.

### 531. mypy-sauber ohne rote Module ✓ erledigt

*Aufwand: klein · Hub*

`tools/mypy_sauber.py` meldete fünf Module aus `mypy-sauber.txt` rot
(vorlagen, geofence, mqtt, weather, zigbee2mqtt) - je ein Typfehler:
eine unannotierte Liste, eine Sitzung, die als `None` getippt war, der
Broker als `Any | None` statt `str`, und die Wetter-Parameter als
`dict[str, object]`. Alle fünf behoben, ohne einen Eintrag zu
streichen; die Prüfung ist wieder bindend: «Typen sauber: 160 Module».

### 532. Kassenansicht hell und wach ✓ erledigt (nativ, runtimeVersion 8)

*lohnt sich · Aufwand: klein · App*

«An der Kasse» blieb an, konnte aber die Helligkeit nicht hochdrehen -
das ging ohne natives Modul nicht. Jetzt tut es `expo-brightness`:
Solange die Ansicht offen ist, steht der Bildschirm auf voll und
schläft nicht ein (`hooks/useKassenlicht.ts`); beim Schliessen kommt
der alte Wert zurück, sofern er dunkler war (`lib/kassenlicht.ts`).
Im Browser gibt es keine Helligkeit, dort bleibt es beim Wachhalten.
Weil das Modul nativ ist, ging die `runtimeVersion` auf 8 - **der
TestFlight-Build muss unmittelbar folgen**, sonst erreicht keine
Nachladung mehr ein Telefon (CLAUDE.md, «Ausliefern»).

### 533. Fotografierte Belege lesen ✓ erledigt

*lohnt sich · Aufwand: klein · Hub + Abbild*

«Aus Beleg übernehmen» las nur PDF und Text. Ein Foto oder Scan des
Belegs geht jetzt auf dem Hub durch Tesseract (`beleglesen.aus_bild`,
Deutsch und Englisch): neues Extra `ocr` (pytesseract, Pillow) in
der pyproject.toml, `tesseract-ocr` samt `deu` per apt im Abbild, in
der pip-Zeile des Dockerfiles, und auf der Systemseite als «Belege
fotografiert lesen». Auf dem Hub und nicht auf dem Telefon: Ein
natives OCR-Modul hätte eine weitere neue Hülle gebraucht; ein
apt-Paket im Abbild braucht keine. Ohne das Extra sagt die App beim
Foto, was fehlt, statt still nichts zu finden.

### 534. Die Leuchte lernt dazu, wenn ihre Spots später kommen ✓ erledigt

*lohnt sich · Aufwand: klein · Hub*

Aus dem Haus: «Hier kann ich immer noch nicht die Helligkeit, Farbe und
wie weiss das Licht sein soll einstellen» - im Ablauf-Editor, an zwei
Leuchten aus mehreren Lampen. Es sah nach einem fehlenden Bedienelement
aus und war eine falsche Auskunft des Hubs.

Was die Leuchte kann, rechnet `merged_commands` beim **Anlegen** aus
ihren Mitgliedern aus - aus denen, die in dem Moment schon registriert
sind. Eine Hue-Bridge meldet sich langsamer, als der Hub startet: Dann
ist keines da, und die Leuchte bleibt bei «ein, aus, umschalten».
Kommen die Spots später, zog `_recompute` bisher nur den **Zustand**
nach, nie die Befehlsliste. Sie blieb falsch, bis zufällig ein Neustart
die andere Reihenfolge brachte.

In der App hängen genau drei Dinge an dieser Liste: Helligkeit
(`set_brightness`), Farbe (`set_color`) und Weissanteil
(`set_color_temp`). Sie fehlten deshalb im Ablauf-Schritt - und in der
Szene, und auf der Kachel. Dass es mal ging und mal nicht, machte es
schwer zu fassen: «immer noch nicht» ist die Beschreibung eines
Fehlers, der zwischendurch weg war.

`_recompute` zieht die Befehle jetzt mit nach, über ein neues
`registry.set_commands` - dieselbe Art zu melden wie `set_combined`, mit
`state_changed` und der ganzen Entität, sodass die App die neue Liste
sieht. Sie heilt sich damit von selbst: Beim ersten Zustandswechsel
eines Mitglieds steht sie richtig, spätestens Sekunden nach dem Start.

Nachgewiesen rot: Ohne die drei Zeilen in `_recompute` fällt
`test_die_leuchte_lernt_dazu_wenn_ihre_spots_spaeter_kommen` um - die
Leuchte bleibt bei den drei Schaltbefehlen, obwohl ihr Spot Farbe kann.

Stellen: `hub/homepilot/integrations/group.py`, `hub/homepilot/core/registry.py`

### 535. In der Kopfzeile steht nur noch der Punkt ✓ erledigt

*lohnt sich · Aufwand: klein · App*

«verbunden» stand neunundneunzig Prozent der Zeit neben einem grünen
Punkt und sagte dasselbe wie er - zwei Zeichen für eine Auskunft, und
ausgerechnet die langweiligste nahm den meisten Platz in der Ecke der
Begrüssungskarte. Die Ampel trägt es allein: grün, gelb, rot.

**Die Wartezahl bleibt**, und zwar aus dem Grund, aus dem sie hinzukam:
Ohne sie ist ein Tipp im Funkloch nicht von einem verschluckten Befehl
zu unterscheiden - beides sieht nach «nichts passiert» aus. Sie ist
keine Zustandsbeschreibung, sondern eine Zahl, die man sonst nirgends
bekommt. Steht also «2 wartet» da, ist etwas los; steht nichts da, ist
nichts los.

**Das Wort wandert in die Vorlesefunktion.** Ein farbiger Kreis ohne
Beschriftung ist für VoiceOver eine leere Fläche - und für wen Farben
schwer zu unterscheiden sind, die einzige Auskunft, die er nicht
bekommt. `verbindungsAnsage` sagt weiterhin «getrennt · 2 wartet».

Auf der Verbindungen-Seite bleibt das Wort sichtbar: Dort ist es der
Inhalt und nicht die Verzierung eines Punktes.

Stellen: `app/src/lib/verbindungsstand.ts`, `app/src/components/TopStrip.tsx`

### 536. Zigbee über den Dongle am Netzwerkkabel ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub-Stack + Doku*

Die Zigbee-Integration gibt es seit Langem, aber im Haus lief nichts
damit: Es fehlten die zwei Dienste davor. Der Hub liest MQTT-Themen -
wer sie hineinschreibt, war nirgends eingerichtet. Im Stack standen
Hub, mediamtx und Matter; ein Broker kam darin nicht vor, und
`MQTT_USER` war eine Variable ohne Gegenstück.

Neu im Stack: **Mosquitto** und **Zigbee2MQTT**, beide im host-Netz, wie
alles andere. Die Kette ist damit vollständig:

    Zigbee-Gerät  ~funk~  Dongle  ~LAN~  Zigbee2MQTT  →  Mosquitto  →  Hub

**Der Dongle hängt am Netzwerkkabel, nicht am USB-Anschluss** - ein
SONOFF Dongle Max (Dongle-M) mit PoE. Deshalb steht in der
docker-compose.yml kein `devices:`-Eintrag, wie ihn jede Anleitung
zeigt: Der Koordinator ist kein Gerät dieses Rechners, sondern eine
Adresse im Netz (`tcp://…:6638`). Das ist nicht bloss bequem - Zigbee
ist ein Funknetz, und im Serverschrank neben zwei Netzteilen und einem
WLAN-Router steht ein Koordinator schlecht.

Drei Dinge, an denen es sonst scheitert, stehen in
`deploy/zigbee2mqtt.example.yaml` und in `docs/zigbee.md`:

- **`adapter: ember`, nicht `zstack`.** Im Dongle Max sitzt ein
  EFR32MG24 von Silicon Labs. `zstack` ist der TI-Stick aus den meisten
  Anleitungen im Netz; damit verbindet sich hier nichts, und die
  Fehlermeldung sagt es nicht deutlich.
- **Eine feste Adresse im Router.** `Dongle-M.local` steht in der
  Anleitung von SONOFF und geht über mDNS - aber eben nur, solange mDNS
  geht. Fällt es aus, sieht das aus wie ein defekter Dongle.
- **Erst benennen, dann den Hub lesen lassen.** Die Kennung einer
  Kachel leitet sich vom Namen in Zigbee2MQTT ab; wer später umbenennt,
  bekommt eine neue Kachel, und Raum, Favorit und Abläufe zeigen auf die
  alte.

**Der Broker horcht nur auf 127.0.0.1**, und darum steht auch kein
Passwort darin. Wer ihn aus dem WLAN erreichte, hörte jeden
Fensterkontakt mit und dürfte jedes Licht schalten - MQTT kennt keine
Rechte je Thema. Ein Passwort in einer Datei, das niemanden abhält,
wäre schlechter als keines: Es sähe nach Sicherheit aus. Sollen später
Tasmota-Geräte aus dem WLAN dazukommen, ändern sich Listener und
Passwort zusammen; die drei Zeilen dafür stehen in der Datei.

Der Datenordner liegt als Ordner neben der config.yaml und nicht in
einem Docker-Volume - wie bei Matter, aus demselben Grund: Er wandert
mit ins Backup, ein Volume übersieht man. Und ohne ihn muss jedes
Zigbee-Gerät neu angelernt werden.

**Nachtrag - der Stack startete zuerst gar nicht.** Portainer meldete:
«Are you trying to mount a directory onto a file (or vice-versa)?» für
`/data/compose/61/deploy/mosquitto.conf`. In der Portainer-Fassung stand
für die Broker-Konfiguration ein Repo-Pfad (`./deploy/mosquitto.conf`),
obwohl im Kopf genau dieser Datei steht, dass dort alles aus
`/opt/homepilot` kommt. Von Hand stimmt der Pfad - man ruft Compose ja
im Klon auf; ein Repository-Stack klont sich aber dorthin, wo Portainer
ihn hinlegt. Was Docker dort nicht findet, legt es wortlos als leeres
*Verzeichnis* an, und darüber lässt sich die Datei aus dem Abbild nicht
legen. Nicht nur der Broker fiel damit aus, sondern der ganze Stack.

Der Fehler war von Auge nicht zu sehen: `compose_abgleich.py` vergleicht
bewusst nur die Volume-*Ziele*, weil sich die Quellen je Aufstellung
unterscheiden dürfen. Was es nicht prüfte, war die Regel darüber - in
der Portainer-Fassung darf die Quelle eben *nicht* aus dem Klon kommen.
Das hält jetzt `hub/tests/test_compose_pfade.py` fest (und wird rot mit
dem alten Pfad).

Dazu die zweite Überraschung: Der Broker läuft im Abbild als Benutzer
`mosquitto`, **1883** und nicht 1000 wie der Hub. Gehört ihm sein
Datenordner nicht, startet er nicht - in `deploy/portainer.md` steht
beides jetzt getrennt.

**Zweiter Nachtrag - der Dienst schwieg.** Nach dem Ausrollen stand der
Container zwölf Minuten auf `Up` und hatte seit den Migrationsnotizen
nichts mehr gesagt. Gesucht wurde am Dongle, an der Firmware und am
Broker; kaputt war nichts. In der Vorlage stand `log_level: warning`,
und die Zeilen des ersten Starts - «Starting Zigbee2MQTT version …»,
«Connecting to MQTT server», «Adapter ready» - sind alle `info`. Ein
Dienst, der schweigt, sieht aus wie einer, der hängt; das kostet mehr
als die paar Zeilen im Protokoll, zumal dort der Deckel aus der
docker-compose.yml greift. Jetzt `info`, mit einer Prüfung dagegen und
einem Abschnitt in `docs/zigbee.md`, der genau dieses Bild zeigt.

Beim Nachsehen im laufenden Betrieb (`zigbee2mqtt/bridge/info`) fiel
dann noch `enable_external_js: true` auf - die Vorgabe von Zigbee2MQTT.
Dessen eigenes Schema warnt davor: «can execute arbitrary user-provided
code». Die Weboberfläche auf 8099 hat keine Anmeldung und hängt am
host-Netz, ist also aus dem ganzen WLAN erreichbar; wer sie öffnet,
dürfte damit beliebigen Code im Container ausführen. Das hebt auf,
wofür der Broker nebenan eigens auf 127.0.0.1 eingesperrt ist.
Gebraucht wird es hier nicht - der Hub liest die Themen selbst. Jetzt
aus, mit einer Prüfung dagegen.

Stellen: `docker-compose.yml`, `docker-compose.portainer.yml`, `deploy/mosquitto.conf`, `deploy/zigbee2mqtt.example.yaml`, `deploy/portainer.md`, `docs/zigbee.md`, `docs/integrationen.md`, `hub/config.example.yaml`, `hub/tests/test_compose_pfade.py`, `hub/tests/test_zigbee_stack.py`, `.gitignore`

# Teil XII: Auf Zuruf (537)

### 537. Die Geräteauswahl im Ablauf-Editor ✓ erledigt

*tut weh · Aufwand: mittel · App*

Gemeldet mit einem Bild und drei Worten: «neu, schöner, moderner und
intuitiver». Was darauf zu sehen war, liess sich benennen:

**Fünf Chip-Reihen, eine davon beschriftet.** Unter einem gewählten
Licht standen «ein · ein, gedimmt · aus · umschalten», darunter
«Helligkeit lassen · 10 % · … · 100 %», darunter allein «nach
Tageszeit», dann «Wie lange an?» und zuletzt die Weisstöne. Nur die
vierte Reihe sagte, welche Frage sie beantwortet. Jede trägt jetzt ihre
Frage (`Unterfrage` in `felder.tsx`), ausgeschrieben und nicht als
Stichwort.

**«nach Tageszeit» sah aus wie ein sechster Prozentwert.** Es stand in
derselben Reihe wie die Zahlen - sieben Chips, die auf kein Telefon in
eine Zeile passen, also fiel es in die zweite und stand dort allein.
Die Reihe ist geteilt: «Helligkeit» führt Zahlen, «Oder rechnen lassen»
die beiden Quellen (`helligkeitsStufen`, `helligkeitsQuellen`). Ein Test
hält fest, dass die Teilung nichts verliert.

**Zwei gewählte Geräte liefen ineinander.** Getrennt waren sie durch
eine Haarlinie; die Chip-Reihen des ersten und der Name des zweiten
hatten denselben linken Rand. Jetzt ist jedes Gerät eine Karte auf
`accentSoft` mit Symbol, Name und Art im Kopf - man sieht, wo eines
aufhört, bevor man liest.

**Der Name war der Ausknopf.** Wer ein Gerät eingestellt hatte und dann
seinen Namen antippte, um nachzusehen, verlor alles daran. Wegnehmen
geht jetzt über ein eigenes Kreuz.

**Jeder Chip war eine gefüllte Fläche**, ungewählt grau, gewählt blau -
auf fünf Reihen dreissig Kacheln, von denen fünf die Antwort waren.
Ungewählt ist jetzt eine Haarlinie; gefüllt ist nur noch, was gilt.

**Und ein echter Fehler, der dabei herausfiel:** «eigene Zeit» stand
*neben* dem Blatt, ausserhalb des sichtbaren Rands. `MinutenWahl` und
`NachlaufWahl` legten ihre Chip-Reihe in einen Kasten mit
`flexDirection: row` und ohne `flexWrap` - `Choice` bringt sein
umbrechendes Band selbst mit, der Kasten darum zwang es in eine Zeile.
Acht Chips passen in keine Karte. Der Kasten ist weg.

Nachgewiesen rot: Die Browser-Probe misst neu, ob im offenen
Ablauf-Editor etwas ausserhalb seines Kastens steht - mit dem alten
Wrapper meldet sie auf iPad und iPhone je drei Stellen, ohne ihn
nichts. Gemessen wird dabei nur *im Blatt*: Die Leiste der
Einstellungen scrollt von sich aus waagrecht und ist dabei zu Recht
breiter als ihr Kasten.

Dazu Kleinigkeiten, die beim Hinsehen auffielen: Das Feld für die
eigene Zeit zeigte eine nackte «4» - jetzt steht «Min.» darin. Die
Abschnitte heissen «Ausgewählt» und «Weitere hinzufügen» statt gar
nichts. Die Räume im Angebot stehen als Versalien über ihrer Gruppe,
und eine Zeile darin ist ein Ziel, das man am Wandpanel im Vorbeigehen
trifft.

Stellen: `app/src/screens/automations/szenen-editor.tsx`, `app/src/screens/automations/felder.tsx`, `app/src/screens/automations/stil.ts`, `app/src/lib/helligkeitsvorgabe.ts`, `app/src/theme.tsx`, `scripts/probe.mjs`

### 538. Temperatur und Feuchte auf der Raumkachel ✓ erledigt

*lohnt sich · Aufwand: klein · App*

Gewünscht mit einem Bild und einem rot eingekringelten Fleck oben rechts
auf dem Kopfbild: «hier soll die Temperatur und Luftfeuchtigkeit
angezeigt werden, wenn im entsprechenden Raum ein Sensor zugewiesen
ist.»

Das «wenn» ist der ganze Punkt. Eine Kachel, die «–°» zeigt, behauptet,
es gäbe einen Fühler und er schweige; ohne Fühler bleibt die Ecke leer
(`kachelKlima`, lib/raumkarte.ts).

**Welcher Fühler gilt, entscheidet nicht die Kachel.** Sie fragt
`raumKlima` (lib/raum.ts) - dieselbe Rechnung wie der Raumkopf. Sonst
stünde auf der Kachel eine andere Zahl als in dem Zimmer, das sie
öffnet, und beide wären für sich richtig. Damit gelten auch dieselben
Ausschlüsse: Akkustand und Sendespeicher zählen ebenfalls in Prozent
und sind keine Luftfeuchtigkeit (lib/klimachip.ts), und ein Fühler mit
«gilt nur für diesen Raum» bleibt draussen - die 30 Grad neben dem Rack
in der Waschküche stünden sonst zwischen lauter Wohntemperaturen.

**Die Werte standen schon da - eine Zeile tiefer.** `raumZeile` führte
sie als ersten Teil des Zustandssatzes («21,5° · 45 % · Fenster offen»).
Stehen zu lassen hiesse dieselbe Auskunft zweimal auf einer Kachel,
zwei Zeilen auseinander. Sie sind aus der Zeile heraus und in die Ecke
gewandert; unten bleibt, was man am Bild nicht sieht.

**Die Ecke gehörte schon jemandem.** Die Szenenknöpfe sassen oben
rechts. Ohne Szenen fiel das nicht auf, mit zweien läge die Temperatur
unter einem Szenennamen. Jetzt teilen sie sich eine Kopfzeile: Szenen
links und schrumpfend, das Klima rechts und fest - die Zahl soll nicht
auf «21…» abgeschnitten werden.

Der Demo-Fühler meldet neu auch Feuchte: Ohne ein Gerät, das beides
liefert, liesse sich der Fall im Browser gar nicht ansehen.

Stellen: `app/src/lib/raumkarte.ts`, `app/src/lib/raum.ts`, `app/src/components/RoomCard.tsx`, `hub/homepilot/integrations/demo.py`, `scripts/probe.sh`

### 539. Ein Sensor für mehrere Zimmer ✓ erledigt

*lohnt sich · Aufwand: mittel · Hub + App*

Gewünscht im Haus, gleich nach der Klimaecke auf der Raumkachel: «man
soll einen Sensor auch mehreren Räumen zuweisen können». Der Fall ist
der offene Wohnbereich - *ein* Klimafühler, und Wohnzimmer wie
Esszimmer sollen ihn zeigen.

**Bisher gewann wortlos das zuletzt genannte Zimmer.** Die Zuordnung
war ein Dict mit einem Schlüssel je Gerät (`_rooms_by_entity`). Wer den
Fühler in der config.yaml unter beiden Räumen aufführte, bekam keinen
Fehler und kein zweites Zimmer - nur das spätere. Genau die Sorte
Fehler, gegen die diese Datei geschrieben ist: Von aussen sah es aus
wie gemacht.

**`room` bleibt, `rooms` kommt dazu.** Die Entität führt beides: `room`
beantwortet «wo *steht* das Gerät» - dort liegt seine Kachel, daher
kommt sein Namensvorschlag, und daran hängt zu viel, um es zu einer
Liste zu machen. `rooms` beantwortet die andere Frage: «für welche
Zimmer zählt es mit». Das erste der Liste ist der Standort.

**In der App fragt das eine Stelle**, nicht sechsundzwanzig: `imRaum`
(lib/raum.ts). Ein blosses `entity.room === name` übersieht das zweite
Zimmer, und es stand an sechsundzwanzig Stellen. Umgestellt sind die
acht, die wirklich «gehört das hierhin?» fragen - Raumkacheln,
Raumgruppen, Kinderseite, Klimaübersicht. Wo es um «wo steht es» geht
(Namensvorschlag, Anzeige des Standorts), bleibt `room` richtig.

**Die Raumliste kommt aus den Mitgliedschaften.** Ohne das fehlte das
Esszimmer als Kachel, dessen einziges Gerät der Fühler von nebenan ist:
Die Klimaübersicht zählte es, eine Kachel dafür gab es nicht.

**Der Wähler schliesst nicht mehr beim ersten Tipp.** Wer zwei Zimmer
wählen will, käme sonst nie zum zweiten. Das erste gewählte trägt
«Standort» - ohne den Hinweis sähe die Liste aus wie eine beliebige
Mehrfachauswahl, und dass die Reihenfolge etwas bedeutet, merkte man
erst, wenn die Kachel woanders auftaucht.

Eine ältere App schickt weiterhin nur `room` und meint dann genau
dieses eine Zimmer; eine ältere Fassung des Hubs liest `room` aus der
Datendatei und bekommt den Standort. Beides ist geprüft.

Stellen: `hub/homepilot/core/entity.py`, `hub/homepilot/core/registry.py`, `hub/homepilot/core/hub.py`, `hub/homepilot/api/routes/entities.py`, `app/src/lib/raum.ts`, `app/src/components/entity/anpassen.tsx`, `app/src/hooks/useHub.ts`, `docs/erste-stunde.md`
