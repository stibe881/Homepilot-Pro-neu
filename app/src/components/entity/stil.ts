/**
 * Die geteilten Styles aller Kachel-Komponenten.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import { StyleSheet } from 'react-native';

import { Colors, radius, type } from '../../theme';


export const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  body: { gap: 8 },
  stack: { gap: 8 },
  nowPlayingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverArt: {
    width: 48,
    height: 48,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
  },
  // Der Fortschritt: schmal, wenn er nur anzeigt, und griffig, wenn man
  // ihn anfassen darf - ein Balken, der aussieht wie ein Regler, aber
  // keiner ist, ist ein Versprechen, das die Kachel nicht hält.
  fortschrittBox: { gap: 2 },
  fortschrittZeile: { flexDirection: 'row', justifyContent: 'space-between' },
  fortschrittZeit: { color: colors.inkFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  // Die Gruppen-Marke: Eine Kachel, die in Wahrheit vier Boxen ist,
  // sagt das - sonst wundert man sich, warum es überall spielt.
  gruppenChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
  },
  gruppenChipText: { color: colors.inkSoft, fontSize: 11, fontWeight: '600' },
  boxZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  boxName: { color: colors.ink, fontSize: 14, width: 110 },
  naechsterRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  naechsterText: { color: colors.inkFaint, fontSize: 11, flex: 1 },
  schlummerChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  schlummerChipText: { color: colors.inkSoft, fontSize: 11, fontWeight: '700' },
  schlummerAktiv: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  schlummerAktivText: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  coverGrund: {
    ...StyleSheet.absoluteFillObject,
    // Blass genug, dass jeder Text darüber lesbar bleibt - das ist die
    // Grenze, an der ein Bild Schmuck bleibt statt Störung zu werden.
    opacity: 0.16,
    borderRadius: radius.card,
  },
  editBox: { gap: 8 },
  editChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  editButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  roomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    // Kräftige Fläche statt der fast durchsichtigen: auf hellen wie dunklen
    // Kacheln muss der Chip lesbar bleiben.
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    flexShrink: 1,
    maxWidth: '100%',
  },
  roomChipText: { fontSize: 12, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  roomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  roomSheet: {
    width: 320,
    maxWidth: '100%',
    maxHeight: '80%',
    borderRadius: 24,
    padding: 18,
    gap: 6,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  roomSheetTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  /** Das Anpassen-Blatt: Kopf mit Name und Schliessen, darunter eine
   *  Zeile je Einstellung – über die ganze Breite, denn dafür ist es da. */
  /** Die Anpassen-Zeile auf der Kachel: was eingestellt ist, und ein
   *  Symbol, das sagt, dass sich das ändern lässt. */
  editZeile: {
    flexDirection: 'row',
    alignItems: 'center',
    // Eng gerechnet: Auf einer halbbreiten Telefonkachel bleiben nach
    // Kachelrand, Griff und Pfeil rund siebzig Punkte für den Text.
    // «Kein Raum» braucht sechzig - mit den ursprünglichen acht Punkten
    // Abstand und einem 17er Symbol brach es auf zwei Zeilen um.
    gap: 4,
    paddingVertical: 8,
    paddingRight: 8,
    // Links Platz für den Griff: Der sitzt absolut acht Punkte vom
    // Kachelrand und ist 32 breit, liegt also über allem, was oben links
    // beginnt. Vorher war das der Raum-Chip - das Symbol lag mitten im
    // Wort «Kein Raum». Statt die Zeile nach unten zu schieben, fängt
    // ihr Text rechts vom Griff an; der sitzt dann sauber in ihr drin.
    paddingLeft: 36,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  editStand: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', flex: 1 },
  blattKopf: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  blattZeile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceBorder,
  },
  blattLabel: { fontSize: 15, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  blattWert: {
    fontSize: 14,
    color: colors.inkSoft,
    flex: 1,
    textAlign: 'right',
  },
  // Unter dem Namen: seit wann und wodurch. Klein und ruhig - es ist
  // eine Auskunft, kein Knopf.
  menueUrsache: { fontSize: 13, color: colors.inkSoft, marginTop: -4, marginBottom: 4 },
  // Die Kette darunter, eine Spur leiser: Sie erklärt die Zeile
  // darüber und drängt sich nicht vor sie.
  menueKette: { fontSize: 12, color: colors.inkFaint, marginTop: -2, marginBottom: 6 },
  roomOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.control,
  },
  roomOptionActive: { backgroundColor: colors.surfaceSoft },
  roomOptionText: { fontSize: 15, color: colors.ink },
  renameInput: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  renameGhost: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  renameGhostText: { color: colors.inkSoft, fontSize: 15, fontWeight: '600' },
  renameSave: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  renameSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  mediaRow: { flexDirection: 'row', gap: 10 },
  partOfRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  partOfText: { color: colors.inkFaint, fontSize: 11, fontWeight: '600', flex: 1 },
  // Grill: Störung nach vorne – ein leerer Pelletbehälter lässt das
  // Fleisch kalt werden, während man drinnen sitzt.
  grillProblem: { color: colors.warn, fontSize: 13, fontWeight: '700' },
  grillRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grillStep: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.track,
  },
  mediaLabel: {
    color: colors.inkFaint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  // Eingeschaltet heisst Kante und Schrift in Akzentfarbe, nicht volle
  // Füllung: Zufall und Wiederholen sind Nebenschalter - satt gefüllt
  // riefen sie lauter als die Wiedergabeknöpfe darüber.
  modeButtonOn: { borderColor: colors.accent },
  modeButtonText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
  playlistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  playlistButtonText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  playlistNow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60, gap: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sheetTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', flex: 1 },
  sheetAction: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  playlistTap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingVertical: 10 },
  playlistName: { color: colors.ink, fontSize: 15, flex: 1 },
  playlistIcon: { padding: 8 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volumeBar: { flex: 1 },
  spotifyCount: { color: colors.inkFaint, fontSize: 12, fontWeight: '700' },
  spotifySearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.control,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  spotifySearchInput: { flex: 1, paddingVertical: 8, color: colors.ink, fontSize: 14 },
  deviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  deviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    maxWidth: '100%',
  },
  deviceChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  deviceChipText: { fontSize: 12, color: colors.inkSoft, flexShrink: 1 },
  deviceChipTextActive: { color: '#FFFFFF' },
  privacyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  privacyButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  privacyText: { fontSize: 12, fontWeight: '700', color: colors.inkSoft },
  cleanRoomsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  cleanRoomsText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  sceneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  sceneButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  lockButtonArmed: { backgroundColor: colors.danger },
  lockButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  mediaButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  // Der ganze Knopf: Symbol oben, Wort darunter. Die Fläche zum Antippen
  // ist die Spalte, nicht nur der Kreis – das Wort trifft man sonst und es
  // passiert nichts.
  editItem: { alignItems: 'center', gap: 3, maxWidth: 76 },
  editCaption: {
    color: colors.inkSoft,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Wie beim Chip: deckende Fläche, sonst verschwindet das Symbol auf
    // hellen Kachelbildern (Kamera, Sauger) fast vollständig.
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  value: {
    color: colors.ink,
    fontSize: type.value,
    fontWeight: '600',
  },
  hint: {
    color: colors.inkSoft,
    fontSize: type.cardSub,
  },
  // Wie hint, nur nicht zu übersehen: Er steht dort, wo sonst ein
  // Bedienelement wäre, und erklärt, warum es fehlt.
  warnHint: { color: colors.warn, fontSize: 12, lineHeight: 17 },
  detail: {
    color: colors.inkSoft,
    fontSize: 12,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
