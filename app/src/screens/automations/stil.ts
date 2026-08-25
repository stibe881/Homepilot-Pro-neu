/**
 * Die geteilten Styles aller Ablauf-Komponenten.
 *
 * Herausgelöst aus AutomationsScreen.tsx (Punkt 21 der Werkbank).
 */
import { StyleSheet } from 'react-native';

import { Colors, radius, space, type } from '../../theme';

export const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap, marginTop: 4 },
    sectionTitle: {
      color: colors.onGradient,
      fontSize: 18,
      fontWeight: '700',
      marginTop: 14,
    },
    sceneAction: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    snapshot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    snapshotText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    snapshotHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    satzBox: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
      padding: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    satzText: { color: colors.ink, fontSize: 13, lineHeight: 19, flex: 1 },
    // «Alle zeigen» unter dem gekürzten Satz - klein, aber sichtbar:
    // Ohne den Hinweis wüsste niemand, dass da noch etwas ist.
    satzMehr: { color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 4 },
    groupLabel: {
      color: colors.inkSoft,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 6,
    },
    deviceRow: {
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    deviceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    deviceName: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
    deviceSearch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    deviceSearchInput: { flex: 1, paddingVertical: 10, color: colors.ink, fontSize: 15 },
    // Geräteauswahl: eine Zeile je Gerät statt einer endlosen Chip-Reihe.
    pickList: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 10,
      paddingVertical: 6,
      // Über zehn Zeilen wird die Seite unbedienbar lang; hier scrollt
      // die Auswahl in sich selbst.
      maxHeight: 320,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
      paddingHorizontal: 6,
      borderRadius: radius.control,
    },
    pickRowActive: { backgroundColor: colors.surface },
    pickName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    pickNameActive: { color: colors.accent },
    pickKind: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 6,
      paddingBottom: 2,
    },
    /**
     * Die Kategoriezeile über einer Gruppe.
     *
     * Sie stand in Grossbuchstaben mit gesperrter Schrift - als
     * Rubrikenschild gedacht. Bei selbst vergebenen Namen las sich das
     * aber nicht als Schild, sondern als Geschrei: «6-FACH
     * WANDTASTER», «BEWEGUNGSMELDER LICHT». Namen, die jemand getippt
     * hat, gehören so hin, wie er sie getippt hat - dafür etwas
     * grösser, damit sie sich weiter von den Karten darunter abheben.
     */
    groupTitle: {
      flex: 1,
      color: colors.onGradient,
      fontSize: 15,
      fontWeight: '700',
    },
    groupCount: { color: colors.onGradientSoft, fontSize: 13, fontWeight: '700' },
    templates: { gap: 8 },
    // «Alles mal ruhen lassen», ganz oben und dezent: eine Zeile statt
    // einer Karte. Sie bricht um, wenn das Telefon schmal ist - zwei
    // Knöpfe und die Zahl passen dort nicht nebeneinander.
    pausenZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: -4,
    },
    pausenText: { color: colors.onGradientSoft, fontSize: 13, flexGrow: 1 },
    // Umbrechend, seit der Babysitter dazugekommen ist: Drei Knöpfe
    // passen auf dem Telefon nicht in eine Zeile, und der dritte ragte
    // sonst über den rechten Rand hinaus.
    // flexShrink: In React Native schrumpfen Flex-Kinder von sich aus
    // nicht - ohne das ragte der dritte Knopf über den rechten Rand
    // hinaus, statt in die nächste Zeile zu rutschen.
    pausenKnoepfe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flexShrink: 1 },
    // Vorlagen: eingeklappt eine Zeile, aufgeklappt eine je Vorlage mit
    // Stift und Kreuz am rechten Rand.
    vorlagenKopf: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    vorlagenZeile: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // Widerspruch links, der Haken rechts - in einer Zeile, damit klar
    // ist, was der Haken abhakt.
    konfliktZeile: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    quittungKnopf: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
    quittungZeile: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    quittungText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    // Die quittierten Zeilen: unter der Karte, solange es noch offene
    // gibt - und ohne Karte, wenn alles abgehakt ist. Dann soll da nichts
    // mehr stehen ausser der Möglichkeit, es zurückzuholen.
    quittungBlock: { gap: 2, marginTop: -6, paddingHorizontal: 4 },
    quittungAllein: { gap: 2, marginTop: -4, paddingHorizontal: 4, opacity: 0.75 },
    templateOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    // Wie die Kategoriezeilen darunter: «VORLAGEN» in Grossbuchstaben
    // über einer Liste aus «6-Fach Wandtaster» sah nach zwei
    // verschiedenen Ebenen aus, obwohl es dieselbe ist.
    templatesLabel: {
      color: colors.onGradient,
      fontSize: 15,
      fontWeight: '700',
    },
    template: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    templateText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    triggerNote: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
    triggerBox: {
      gap: 8,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    triggerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    triggerBadge: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    addRowText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    stepBox: {
      gap: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    stepHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    preview: {
      gap: 4,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    previewHead: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 4 },
    previewLine: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    weekdayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    holidayToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    holidayText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    // Das Tagesband (Punkt 163).
    bandZeile: {
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 4,
    },
    agendaBand: { gap: 8, paddingBottom: 10 },
    agendaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      maxWidth: 220,
    },
    agendaZeit: {
      color: colors.ink,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    agendaName: { color: colors.inkSoft, fontSize: 12, flexShrink: 1 },
    // Eine Zeile der Schritt-Spur im Lauf-Verlauf (Punkt 160).
    runStep: { color: colors.inkFaint, fontSize: 12, paddingLeft: 14, lineHeight: 17 },
    weekday: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    weekdayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    weekdayText: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    weekdayTextOn: { color: '#FFFFFF' },
    stepNumber: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    rowGap: { flexDirection: 'row', gap: 8 },
    card: { minHeight: 0, gap: 6 },
    /** Die schaltbare Hälfte einer Szenenzeile - alles ausser dem Stift. */
    szenenZeile: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    /** Das Symbol in einem Kreis: Er kann sich färben, das Symbol allein
     *  wäre als «steht gerade» zu leise. */
    szenenSymbol: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    detail: { color: colors.inkSoft, fontSize: type.cardSub, marginTop: 2 },
    badge: { color: colors.inkFaint, fontSize: 11 },
    iconButton: { padding: 6 },
    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    newText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    note: {
      color: colors.onGradientSoft,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 20,
      maxWidth: 460,
    },
    editor: { flex: 1, backgroundColor: colors.panel },
    editorContent: { padding: 22, paddingTop: 18, gap: 18, maxWidth: 620, width: '100%' },
    /**
     * Die Kopfleiste des Editors – fest, nicht mitscrollend.
     *
     * Sie stand vorher als erste Zeile *im* Scrollbereich, hinter einem
     * geratenen `paddingTop: 60`. Zwei Dinge gingen dabei schief: Auf
     * einem Telefon mit hoher Statusleiste lag «Neuer Ablauf» unter der
     * Uhr, und wer im Formular unten war – es ist mehrere Bildschirme
     * lang –, musste zum Abbrechen und zum Sichern erst ganz nach oben
     * zurückscrollen. Jetzt liegt beides immer da, und der Abstand nach
     * oben kommt vom Gerät statt aus einer Zahl.
     */
    editorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
      backgroundColor: colors.panel,
    },
    editorTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', flex: 1 },
    /** Der Titel in der festen Leiste: kleiner, mittig, einzeilig. */
    editorBarTitle: {
      color: colors.ink,
      fontSize: 17,
      fontWeight: '700',
      flex: 1,
      textAlign: 'center',
    },
    editorBarKnopf: {
      minWidth: 76,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
    },
    editorBarText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    field: { gap: 8 },
    label: { color: colors.inkSoft, fontSize: type.cardSub, fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
    },
    picker: { flexGrow: 0 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    /** Die Farbwahl einer Lampe im Ablauf – dieselben Punkte wie auf der
     *  Gerätekachel, damit «das Blau von gestern» wiederfindbar bleibt. */
    farbReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    farbPunkt: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** «Farbe unverändert»: der Punkt ohne Farbe, mit Kreuz. */
    farbLeer: { backgroundColor: colors.surfaceSoft },
    choice: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    choiceActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    choiceText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    choiceTextActive: { color: '#FFFFFF' },
    save: {
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 15,
      alignItems: 'center',
    },
    saveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
    delete: { alignItems: 'center', paddingVertical: 12 },
    deleteText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  });
