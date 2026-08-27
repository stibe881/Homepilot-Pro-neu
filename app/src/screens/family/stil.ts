/**
 * Die geteilten Styles der Familien-Seite.
 *
 * Herausgelöst aus FamilyScreen.tsx (Punkt 21 der Werkbank).
 */
import { StyleSheet } from 'react-native';

import { Colors, radius, space } from '../../theme';

export const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // Das Rückgängig-Band. Es steht oben und nicht unten: Dort schaut
    // man nach dem Tippen ohnehin hin, und unten sitzt auf dem Telefon
    // die Tastatur.
    rueckband: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.surfaceSoft,
    },
    rueckbandText: { color: colors.ink, fontSize: 13, flex: 1 },
    rueckbandKnopf: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    reorderButton: {
      padding: 8,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    reorderSheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60, gap: 10 },
    reorderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reorderHint: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    hint: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17 },

    backHead: { gap: 4 },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingRight: 10,
    },
    backText: { color: colors.onGradient, fontSize: 15, fontWeight: '600' },
    viewTitle: { color: colors.onGradient, fontSize: 22, fontWeight: '700' },

    summaryCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
    },
    summaryItem: { flex: 1, alignItems: 'center', gap: 2 },
    summaryNumber: { color: colors.ink, fontSize: 26, fontWeight: '700' },
    summaryLabel: { color: colors.inkSoft, fontSize: 12 },
    summaryDivider: { width: 1, height: 34, backgroundColor: colors.surfaceBorder },

    memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
    member: { alignItems: 'center', gap: 4, width: 84 },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
    avatarSmall: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarSmallText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    memberName: { color: colors.onGradient, fontSize: 13, fontWeight: '700' },
    memberRole: { color: colors.onGradientSoft, fontSize: 11 },

    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
    moduleTile: { minHeight: 0, width: '48%', flexGrow: 1, maxWidth: 260, gap: 6 },
    // Etwas Luft zwischen den Gruppen: Ohne sie liest sich die
    // Überschrift als Teil der Kacheln darüber.
    modulGruppe: { gap: 8, marginTop: 6 },
    moduleLabel: { color: colors.ink, fontSize: 16, fontWeight: '700' },
    moduleSub: { color: colors.inkSoft, fontSize: 12 },

    listCard: { minHeight: 0, gap: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center' },
    checkTap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    checkText: { color: colors.ink, fontSize: 15, fontWeight: '500' },
    checkTextDone: { textDecorationLine: 'line-through', color: colors.inkFaint },
    checkSub: { color: colors.inkSoft, fontSize: 12 },
    // Die Menge («400 ml») neben dem Artikel: leiser, denn gesucht
    // wird der Artikel.
    checkMenge: { color: colors.inkFaint, fontWeight: '400' },
    deleteTap: { padding: 8 },
    // Einkaufs-Modus: Im Laden hält man das Telefon in einer Hand und in
    // der anderen den Wagen - die Trefferfläche muss ohne Hinsehen
    // treffbar sein.
    checkRowBig: { minHeight: 56 },
    checkTextBig: { fontSize: 20, fontWeight: '600' },
    countRow: { flexDirection: 'row', alignItems: 'center' },
    countTap: { paddingHorizontal: 6, paddingVertical: 8 },
    // Kopfzeile über der Liste: «Stand von 14:12, keine Verbindung».
    standRow: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    standText: { color: colors.inkSoft, fontSize: 12, flex: 1 },
    // Suche über alle Listen.
    suchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    trefferTitel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    trefferSub: { color: colors.inkSoft, fontSize: 12 },
    // Der Punkt auf der Kachel, wenn dort etwas Neues liegt.
    neuPunkt: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.on,
    },
    // Schnellwahl: grosse runde Knöpfe über der Kontaktliste.
    schnellRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
    schnellKnopf: { alignItems: 'center', width: 68, gap: 4 },
    schnellName: { color: colors.inkSoft, fontSize: 11, textAlign: 'center' },
    // Die Hausadresse auf dem Babysitter- und Notfallblatt.
    adresseCard: { gap: 2 },
    adresseLabel: { color: colors.inkSoft, fontSize: 11, letterSpacing: 1 },
    adresseText: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    adresseNote: { color: colors.inkSoft, fontSize: 13 },
    // Foto an der Pinnwand: breit, damit ein Stundenplan lesbar bleibt.
    pinPhoto: { width: '100%', height: 180, borderRadius: 10 },
    // Wandpanel: aus zwei Metern lesbar, ohne Bedienelemente.
    panelCard: { gap: 10 },
    panelTitel: { color: colors.inkSoft, fontSize: 13, letterSpacing: 1.5 },
    panelZeile: { color: colors.ink, fontSize: 26, fontWeight: '600' },
    panelKlein: { color: colors.inkSoft, fontSize: 17 },

    addRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    addButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addWide: {
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 12,
      alignItems: 'center',
    },
    addWideText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    formCard: { minHeight: 0, gap: 8 },
    // ── Datums- und Zeitwähler der Erinnerungen ──────────────────────
    wahlZeile: { flexDirection: 'row', gap: 8 },
    schalterZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 6,
    },
    schalterText: { flex: 1, color: colors.ink, fontSize: 15 },
    schalterHinweis: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, marginTop: 2 },
    schalter: {
      width: 46,
      height: 27,
      borderRadius: radius.pill,
      backgroundColor: colors.off,
      padding: 3,
      justifyContent: 'center',
    },
    schalterAn: { backgroundColor: colors.on },
    schalterKnopf: {
      width: 21,
      height: 21,
      borderRadius: 11,
      backgroundColor: colors.surfaceStrong,
    },
    schalterKnopfAn: { alignSelf: 'flex-end' },
    mitgliedZeile: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    mitgliedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    mitgliedChipAn: { borderColor: colors.accent },
    mitgliedChipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    mitgliedChipTextAn: { color: colors.accent },
    wahlFeld: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    wahlFeldAktiv: { borderColor: colors.accent },
    wahlFeldText: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
    // Gedeckelt: Auf einem iPad quer würden die Tageszellen sonst mit
    // der vollen Kartenbreite wachsen - ein Kalender wie ein Plakat.
    rasterBox: { width: '100%', maxWidth: 380, alignSelf: 'center' },
    rasterKopf: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    rasterMonat: {
      flex: 1,
      textAlign: 'center',
      color: colors.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    rasterPfeil: { padding: 8 },
    rasterZeile: { flexDirection: 'row' },
    rasterWochentag: {
      flex: 1,
      textAlign: 'center',
      color: colors.inkFaint,
      fontSize: 11,
      fontWeight: '700',
      paddingVertical: 4,
    },
    rasterZelle: {
      flex: 1,
      aspectRatio: 1.35,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.control,
    },
    rasterZelleAktiv: { backgroundColor: colors.accent },
    rasterHeute: { borderWidth: 1, borderColor: colors.accent },
    rasterZelleText: { color: colors.ink, fontSize: 14 },
    rasterZelleTextAktiv: { color: colors.panel, fontWeight: '700' },
    zeitSpalten: { flexDirection: 'row', gap: 8, height: 180, width: '100%', maxWidth: 380, alignSelf: 'center' },
    zeitSpalte: {
      flex: 1,
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    zeitEintrag: {
      alignItems: 'center',
      paddingVertical: 8,
      marginHorizontal: 6,
      borderRadius: radius.control,
    },
    zeitEintragAktiv: { backgroundColor: colors.accent },
    zeitEintragText: { color: colors.ink, fontSize: 16, fontVariant: ['tabular-nums'] },
    zeitEintragTextAktiv: { color: colors.panel, fontWeight: '700' },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    toggleLabel: { color: colors.ink, fontSize: 15 },
    clearButton: { alignItems: 'center', paddingVertical: 8 },
    resetText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    mealShopButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 13,
    },
    weekHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    weekRowItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pollRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: radius.control,
    },
    pollRowMine: { backgroundColor: colors.surfaceSoft },
    choreButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
    choreDone: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.on,
    },
    choreDoneText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    choreSkip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    choreSkipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    formHintSmall: { color: colors.inkFaint, fontSize: 12 },
    stapleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    staple: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    stapleText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    mealNameButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    mealNameText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    mealShopText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    confirmRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    confirmOk: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.on,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmNo: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    // Dunkle Tinte, nicht weisse: Der Chip hat in beiden Themen einen
    // hellen, durchscheinenden Grund (`surfaceSoft`). Weiss darauf misst
    // sich zu 2.4:1, `onGradientSoft` gar zu 1.9:1 – «Hauptkalender»
    // stand als heller Schatten da. Mit `ink` sind es 6.2:1 hell und
    // 9.9:1 dunkel.
    chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    groupTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },

    eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
    calHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
    /** Das Monatsgitter liegt auf einer Karte – siehe MonthCalendar. */
    calCard: { minHeight: 0, gap: 10 },
    calTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calWeekday: {
      width: `${100 / 7}%`,
      textAlign: 'center',
      // Eine Stufe kräftiger als `inkFaint`: Auf der Karte kommt das
      // Blasse auf 2.1:1 – als Spaltenkopf über sieben Zahlenreihen zu
      // wenig, um die Spalte überhaupt zuzuordnen.
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      paddingBottom: 4,
    },
    calCell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.control,
    },
    calCellToday: { borderWidth: 1, borderColor: colors.accent },
    calCellSelected: { backgroundColor: colors.surfaceStrong },
    // Die Tageszahl ist der Inhalt des Gitters, nicht seine Beschriftung
    // – sie gehört in die kräftigste Tinte. Als `inkSoft` war sie auch
    // auf der Karte nur 3.9:1.
    calDay: { color: colors.ink, fontSize: 15 },
    calDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.accent,
      marginTop: 2,
    },

    pinCard: { minHeight: 0, gap: 8 },
    pinFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    rewardCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    pointButton: {
      minWidth: 40,
      paddingVertical: 8,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
      alignItems: 'center',
    },
    pointButtonMinus: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    pointButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    pointsBig: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    groupLabel: {
      color: colors.onGradientSoft,
      fontSize: 13,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
    },
    rewardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    redeemChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radius.pill,
    },
    redeemChipOk: { backgroundColor: colors.accent },
    redeemChipOff: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    redeemChipText: { fontSize: 13, fontWeight: '700' },
    rewardDelta: { fontSize: 15, fontWeight: '800' },

    daysBubble: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    daysNumber: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    daysLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 9 },

    mealRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    mealDay: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', width: 28 },
    mealEmpty: { color: colors.inkFaint, fontSize: 14 },
    // Der heutige Tag im Wochenplan (Punkt 146).
    mealHeute: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      paddingHorizontal: 8,
      marginHorizontal: -8,
    },
    mealTile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
    mealThumb: { width: 52, height: 38, borderRadius: 8, backgroundColor: colors.surfaceStrong },
    mealThumbLeer: { alignItems: 'center', justifyContent: 'center' },
    mealTileMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 1 },
    // «Was koche ich heute?» im Essensplaner (Punkt 139).
    vorschlagKopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 2,
    },
    vorschlagWurf: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    vorschlagWurfText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    vorschlagZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    vorschlagName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    vorschlagGrund: { color: colors.inkSoft, fontSize: 12 },

    contactCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    contactName: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    contactInitial: {
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactInitialText: { color: '#FFFFFF', fontWeight: '700' },
    contactFormRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    contactFormPhoto: { width: 72, height: 72, borderRadius: 36 },
    contactPhotoEmpty: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    callButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.on,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Der grosse Knopf ganz oben auf der Babysitter-Seite: In der
    // Nummernliste zu suchen, während etwas los ist, ist genau das, was
    // man nicht können soll.
    notrufButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 16,
      borderRadius: 14,
      backgroundColor: colors.on,
    },
    notrufButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
    addRowText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    // Kleines Blatt über der Seite - fürs Ändern eines Termins.
    modalBack: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 420,
      gap: 12,
      padding: 20,
      borderRadius: 16,
      // Deckend: Über einem abgedunkelten Hintergrund darf nichts
      // durchscheinen, sonst kippt der Kontrast.
      backgroundColor: colors.panel,
    },
    // Blätterleiste des Wochenplans.
    // ── Die Karte «Wer ist wo» ───────────────────────────────────────
    // Eine Zeile je Mensch statt eines Absatzes: links ein farbiger
    // Punkt, rechts der Ort. Der Punkt trägt die Antwort, bevor man
    // liest - grün da, grau unterwegs, orange meldet sich nicht.
    daKopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    daTitel: { color: colors.ink, fontSize: 17, fontWeight: '700', flex: 1 },
    /** «1 von 7» in der zugeklappten Karte – wer das liest, weiss, ob
     *  sich das Aufklappen lohnt. */
    daZahl: {
      color: colors.inkFaint,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    daZeile: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceBorder,
    },
    daPunkt: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
    daOben: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    daName: { color: colors.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    daOrt: {
      color: colors.inkSoft,
      fontSize: 14,
      flex: 1,
      textAlign: 'right',
    },
    daUnten: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      marginTop: 1,
    },
    daDetail: { color: colors.inkFaint, fontSize: 12, flex: 1 },
    daAkku: { color: colors.inkFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
    daWarum: {
      color: colors.inkSoft,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 6,
    },
    weekNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
  });
