/**
 * Die Stile der Startseite.
 *
 * Sie stehen hier und nicht im Bildschirm selbst, weil die Vollbilder
 * (Klingel, Kamera, Erinnerung) und die Gruppensteuerung dieselbe Tafel
 * benutzen. Sonst müsste jede dieser Dateien den Bildschirm importieren,
 * der wiederum sie importiert – ein Kreis, den kein Bündler mag.
 */
import { StyleSheet } from 'react-native';

import { Colors, radius, space, type } from '../../theme';

export const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1 },
    timelineBox: { paddingHorizontal: 16, paddingTop: 10 },
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.warn,
    },
    offlineText: { color: colors.onGradient, fontSize: 13, flex: 1 },
    allOffRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 4,
    },
    searchButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    lockBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    lockSheet: {
      width: '100%',
      maxWidth: 380,
      gap: 10,
      padding: 20,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    lockTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    lockText: {
      color: colors.inkSoft,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    lockActions: { flexDirection: 'row', gap: 10, marginTop: 6, alignSelf: 'stretch' },
    lockCancel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    lockCancelText: { color: colors.inkSoft, fontSize: 15, fontWeight: '700' },
    pinField: {
      alignSelf: 'stretch',
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      fontSize: 18,
      letterSpacing: 4,
      paddingHorizontal: 14,
      paddingVertical: 10,
      textAlign: 'center',
    },
    lockConfirm: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    lockConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    frame: { flex: 1, flexDirection: 'row' },
    scroll: { flex: 1, minWidth: 0 },
    content: {
      paddingHorizontal: space.page,
      paddingTop: 14,
      paddingBottom: 28,
      gap: 16,
    },
    greetingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.gap,
    },
    greeting: { gap: 2, flexShrink: 1 },
    // Hinweise rechts der Begrüssung. Auf schmalen Geräten stapeln sie sich,
    // damit weder Türhinweis noch Haushalt abgeschnitten wird.
    greetingNotes: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
    },
    greetingLine: {
      color: colors.onGradient,
      fontSize: type.greeting,
      fontWeight: '300',
      letterSpacing: 0.2,
    },
    split: {
      flexDirection: 'row',
      gap: space.gap * 1.4,
      alignItems: 'flex-start',
    },
    stack: { gap: space.gap * 1.4 },
    // minWidth: 0 ist hier kein Zierrat. Ohne das kann eine Flex-Spalte
    // nicht unter die Breite ihres Inhalts schrumpfen: Ein zu breites Kind
    // macht die Spalte breiter, und die Nachbarspalte wandert aus dem Bild.
    // Genau so sieht der abgeschnittene rechte Rand auf dem iPad aus. Im
    // Browser bei 1180 Punkten liess er sich nicht nachstellen - die Zeile
    // kostet nichts und nimmt die wahrscheinlichste Ursache weg.
    main: { flex: 1, minWidth: 0 },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingRight: 10,
    },
    backText: { color: colors.onGradient, fontSize: 15, fontWeight: '600' },
    /** Die Zeile unter den Türknöpfen im Klingel-Vollbild. Klein und
     *  gedeckt: Sie erklärt, sie ist kein Knopf. */
    doorbellHinweis: {
      color: '#8A94A6',
      fontSize: 12,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
    doorbellRoot: {
      flex: 1,
      backgroundColor: '#10141B',
      padding: 22,
      paddingTop: 64,
      gap: 18,
    },
    doorbellTitle: {
      color: '#FFFFFF',
      fontSize: 28,
      fontWeight: '700',
      textAlign: 'center',
    },
    // Das Erinnerungs-Vollbild teilt den Grund mit der Klingel - beides
    // sind die zwei Momente, in denen die App von sich aus laut wird.
    erinnerungListe: { gap: 16, paddingVertical: 12, justifyContent: 'center', flexGrow: 1 },
    erinnerungKarte: {
      backgroundColor: '#1B2230',
      borderRadius: radius.card,
      padding: 26,
      gap: 10,
      alignItems: 'center',
    },
    erinnerungText: {
      color: '#FFFFFF',
      fontSize: 34,
      fontWeight: '700',
      textAlign: 'center',
      lineHeight: 42,
    },
    erinnerungZeit: { color: '#8A94A6', fontSize: 17 },
    erinnerungKnoepfe: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
      marginTop: 8,
    },
    erinnerungKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.on,
      borderRadius: radius.control,
      paddingVertical: 14,
      paddingHorizontal: 34,
    },
    erinnerungKnopfText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    // Der leise Bruder von erinnerungKnopf: nur Rahmen statt Fläche -
    // «für alle» soll der Knopf sein, zu dem die Hand zuerst will.
    erinnerungKnopfLeise: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#3A4358',
      borderRadius: radius.control,
      paddingVertical: 14,
      paddingHorizontal: 34,
    },
    erinnerungKnopfLeiseText: { color: '#C6CDDB', fontSize: 18, fontWeight: '600' },
    erinnerungHinweis: { color: '#8A94A6', fontSize: 13, textAlign: 'center' },
    doorbellImage: {
      flex: 1,
      borderRadius: radius.card,
      backgroundColor: '#1C2430',
      width: '100%',
    },
    doorbellOhneBild: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 26,
      borderRadius: radius.card,
      backgroundColor: '#1C2430',
      width: '100%',
    },
    doorbellButtons: { gap: 10 },
    doorbellTalk: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 14,
      borderRadius: radius.control,
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.35)',
    },
    // Live-Video: 16:9 einpassen statt es in die Bildschirmhöhe zu strecken –
    // gestreckt schneidet der Player links und rechts ab.
    videoBox: { flex: 1, justifyContent: 'center' },
    videoFrame: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: radius.card,
      backgroundColor: '#000000',
    },
    doorbellOpen: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.on,
      borderRadius: radius.control,
      paddingVertical: 18,
    },
    doorbellOpenText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    doorbellClose: { alignItems: 'center', paddingVertical: 12 },
    doorbellCloseText: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '600' },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.gap,
      marginTop: space.gap,
    },
    // Nur zum Messen der Breite, ohne eigenen Abstand.
    measure: { height: 0 },
    group: { marginTop: space.gap * 1.2 },
    groupLabel: {
      color: colors.onGradient,
      fontSize: 19,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    editToggle: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    editToggleText: {
      color: colors.onGradientSoft,
      fontSize: 13,
      fontWeight: '600',
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    searchInput: { flex: 1, paddingVertical: 11, color: colors.ink, fontSize: 15 },
    searchCount: { color: colors.onGradientSoft, fontSize: 12, fontWeight: '600' },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    filterChipOn: { backgroundColor: colors.surfaceStrong },
    // Dunkle Tinte auch im ausgeschalteten Zustand. Der Chip hat in
    // beiden Themen einen hellen, durchscheinenden Grund; `onGradientSoft`
    // darauf misst sich zu 1.86:1 - «Ohne Raum · 91» stand als heller
    // Schatten da, während der eingeschaltete Chip daneben scharf war.
    // Mit `ink` sind es 6.4:1 hell und 9.9:1 dunkel. Ein und aus
    // unterscheidet weiterhin der Grund, und der tut es deutlich
    // genug: durchscheinend gegen fast deckend.
    filterChipText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    filterChipTextOn: { color: colors.ink, fontWeight: '700' },
    /** Der Raumname über den Kacheln – so gross wie eine Seitenüberschrift,
     *  denn genau das ist er. */
    raumTitel: {
      color: colors.onGradient,
      fontSize: 24,
      fontWeight: '700',
      marginTop: 2,
    },
    raumKopf: { gap: 8 },
    raumKopfText: { color: colors.onGradient, fontSize: 15, fontWeight: '600' },
    /** Die Bühne des Raums: trägt Schein und Wasserzeichen, deshalb
     *  relative – absolute Kinder messen sich an ihr. */
    raumBuehne: { position: 'relative', gap: 4 },
    /** Der warme Schein, solange Licht brennt. Über die Seitenränder
     *  hinaus (negative Ränder), damit er wie Raumlicht wirkt und nicht
     *  wie eine Karte. */
    raumSchein: {
      position: 'absolute',
      top: -10,
      left: -space.page,
      right: -space.page,
      height: 200,
    },
    /** Das Raumsymbol als Wasserzeichen – blass genug, dass Temperatur
     *  und Menüknopf darüber lesbar bleiben. */
    raumWasserzeichen: {
      position: 'absolute',
      top: -4,
      right: -14,
      opacity: 0.08,
    },
    raumKopfzeile: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    raumMenueKnopf: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    raumHeld: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
    },
    raumKlimaBlock: { alignItems: 'flex-end' },
    raumKlimaTemp: { color: colors.onGradient, fontSize: 30, fontWeight: '300' },
    raumKlimaSub: { color: colors.onGradientSoft, fontSize: 12 },
    raumFakten: { color: colors.onGradientSoft, fontSize: 14, marginTop: 2 },
    reorderButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    reorderText: { color: colors.onGradient, fontSize: 13, fontWeight: '600' },
    // Der Kamera-Schalter: Symbol, zwei Zeilen Text, Schieber - breit
    // genug, dass die Erklärung darunter passt.
    kameraSort: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    kameraSortHint: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17 },
    reorderSheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60 },
    alphabetKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    alphabetText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    reorderHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    reorderTitle: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    reorderHint: { color: colors.inkFaint, fontSize: 13, lineHeight: 18, marginBottom: 14 },
    // Ohne die beiden Überschreibungen bleibt die Karte auf der
    // Mindesthöhe einer Gerätekachel stehen und schiebt ihre Knöpfe mit
    // `space-between` an den unteren Rand - bei einer Gruppe mit einem
    // Namen und zwei Knöpfen war die halbe Karte leer.
    groupCard: { gap: 12, minHeight: 0, justifyContent: 'flex-start' },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    groupName: { color: colors.ink, fontSize: 16, fontWeight: '700', flex: 1 },
    groupCount: { color: colors.inkFaint, fontSize: 12 },
    groupButtons: { flexDirection: 'row', gap: 8 },
    groupButton: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    groupButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    sectionLabel: {
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: space.gap * 1.5,
    },
    // Einstellungen auf dem iPad: schmales Menü links, Inhalt rechts.
    settingsSplit: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
    settingsRail: { width: 230, gap: 2 },
    settingsRailItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.control,
    },
    settingsRailActive: { backgroundColor: colors.surface },
    settingsRailText: { color: colors.inkSoft, fontSize: 14, fontWeight: '600', flex: 1 },
    /** Die Überschrift über der Einrichtung in der iPad-Spalte. Klein und
     *  gedeckt: Sie trennt, sie ist kein Knopf. */
    settingsRailGruppe: {
      color: colors.inkFaint,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      paddingHorizontal: 12,
      paddingTop: 14,
      paddingBottom: 4,
    },
    empty: {
      color: colors.onGradientSoft,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 24,
      maxWidth: 460,
    },
  });

/** Die fertige Stiltafel – als Typ, damit die Vollbilder sie annehmen können. */
export type DashboardStile = ReturnType<typeof makeStyles>;
