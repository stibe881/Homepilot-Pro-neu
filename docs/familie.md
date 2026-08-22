# Familie: die Module und wie sie zusammenhängen

Der Bereich «Familie» ist kein Anhängsel der Haussteuerung, sondern der
Teil, den man täglich anfasst. Sechs Module tragen sich gegenseitig – wer
eines pflegt, füllt damit die anderen. Das ist die Regel dahinter: **Jede
Angabe wird an genau einer Stelle gepflegt.**

## Kontakte

Namen, Fotos, bis zu zwei Nummern, Geburtstag – und eine **Rolle**:
Notfall, Arzt, Schule/Hort, Familie, Handwerk.

Die Rolle ist mehr als eine Ordnung. Sie entscheidet, wo ein Kontakt
auftaucht: Auf der Babysitter-Seite erscheinen Notfall, Arzt und Schule –
der Gartenbauer nicht. Wer keine Rollen vergibt, sieht überall alles;
niemand muss also nachträglich etwas einordnen.

Geburtstage meldet der Hub morgens um acht von selbst. Die Daten liegen
ohnehin hier – daran denken musste man bisher trotzdem selbst.

## Notfallblatt

Feste Felder je Person: Blutgruppe, Allergien, Dauermedikation,
Versicherung, Hausarzt, Tetanus. Dazu Freitext für den Rest.

Warum feste Felder und kein Zettel: Ein Blatt, das man ausfüllt, ist
etwas anderes als eines, das man erfinden muss – und im Notfall sucht
niemand, sondern liest der Reihe nach. Die Schweizer Notrufnummern (144,
145, 117, 118, 1414) stehen fest oben und sind antippbar; sie pflegt
niemand.

**Prüfvermerk:** Ein Blatt von vorletztem Jahr ist gefährlicher als
keines – man verlässt sich darauf, und die Nummer der Kinderärztin stimmt
nicht mehr. Nach einem Jahr erinnert der Hub daran. Ein Tipp auf
«Geprüft» setzt das Datum neu.

Das ganze Blatt lässt sich als Text teilen – für den Kühlschrank oder für
jemanden ohne App.

## Medikamente

Für Kuren über mehrere Tage. Je Gabe ein Knopf, nicht je Tag: Antibiotika
sind meist dreimal täglich, und die Abendgabe ist die, die untergeht. Was
noch nicht an der Reihe ist, bleibt blass – abhaken kann man es trotzdem,
wenn es früher passt.

Dosis («5 ml») und Grund («wegen Mittelohrentzündung») gehören dazu: Für
den, der die Gabe übernimmt, sind das die eigentlichen Auskünfte. Ein
Verlauf hält fest, wann von wem – danach fragt der Arzt beim nächsten
Termin, und abends weiss es sonst niemand mehr.

Der Hub erinnert an die fällige Gabe, und zwar der zuständigen Person.
Erinnert wird je Tag und Tageszeit genau einmal und erst, wenn die
Tageszeit da ist.

## Babysitter

Zwei Dinge in einem: die Seite, die man hinlegt, und der Zugang.

Die Seite trägt zusammen, was in den anderen Modulen steht – Nummern,
Medikamente, Notfallblatt, Routinen. Nur «Heute Abend» (Bettzeit, Essen,
Rückkehr, WLAN) wird hier gepflegt; das sind die Fragen, die am Türrahmen
kommen und sonst nirgends stehen. Ganz oben: «Eltern anrufen», gross.
Alles zusammen lässt sich als Nachricht weitergeben.

**Der Zugang** legt einen Gastbenutzer «Babysitter» an, der von selbst
endet – mit dem Ablaufdatum und dem Zeitfenster, die es für Gäste längst
gibt. Freigegeben sind nur **Licht** und **Familie**: keine Türen, kein
Alarm, keine Kameras. Was man nicht freigibt, muss man später nicht
bereuen. Reicht der Abend über Mitternacht, gilt der Zugang bis in den
nächsten Tag.

Das Token wird genau einmal angezeigt – beim Anlegen. Danach steht es
nirgends mehr; wer es verliert, öffnet den Zugang neu.

## Wochenplan

Eine Seite statt vier Modulen, und zwar zum Planen, nicht nur zum Lesen:
Essen direkt eintragen, ein Ämtli mit einem Tipp weitergeben, eine
Aufgabe auf einen anderen Tag schieben. Blättern zur nächsten Woche –
denn am Sonntagabend plant man die kommende, nicht die laufende. Eine
Ansicht je Person beantwortet die Frage, die bei vier Personen wirklich
gestellt wird: wer hat wann was.

## Kalender

Liste und Monatsraster. Das Raster holt die Termine des Monats, den es
zeigt – der Zustand der Kalender-Entität trägt nur die nächsten zwölf,
und wer zurückblätterte, sah früher ein leeres Raster und musste glauben,
es sei nichts gewesen.

Der Ort steht bei jedem Termin und öffnet auf Tipp die Karte. Bei
mehreren Kalendern sagt ein Farbpunkt, wessen Termin es ist. Anlegen,
Ändern und Löschen gehen aus der App; Geburtstage aus dem
Google-Kontakte-Kalender sind schreibgeschützt, weil Google sie verwaltet.

Mit `remind_minutes` in der Konfiguration meldet der Hub sich kurz vor
einem Termin – auch auf dem Telefon, auf dem niemand den Kalender
eingerichtet hat.

## Was der Hub von selbst meldet

| Wann | Was | Kategorie |
|---|---|---|
| Zur fälligen Gabe | Medikament, an die zuständige Person | `medication` |
| Morgens um acht | Wer heute Geburtstag hat | `birthday` |
| Einmal im Jahr | Notfallblatt prüfen | `maintenance` |
| Vor einem Termin | `remind_minutes` vorher | `calendar` |

Abschalten lässt sich jede einzeln unter Einstellungen → Konto →
Benachrichtigungen.
