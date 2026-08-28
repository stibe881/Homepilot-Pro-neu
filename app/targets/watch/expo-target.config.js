/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  // Eine echte watchOS-App, keine Erweiterung: Haustüre öffnen, der
  // «alles zu?»-Blick und die Küchen-Timer - die drei Griffe, für die
  // man das Telefon nicht aus der Tasche holen will.
  type: 'watch',
  name: 'HomePilotWatch',
  // Muss unter der Kennung der Haupt-App hängen, sonst gilt die Uhr
  // nicht als Begleit-App. Der führende Punkt heisst: anhängen.
  bundleIdentifier: '.watch',
  displayName: 'HomePilot',
  // watchOS-Version, nicht iOS: 9.4 ist der Boden des Plugins und
  // reicht - nichts hier braucht Neueres, und ältere Uhren bleiben dabei.
  deploymentTarget: '9.4',
  // Ohne Symbol weist Apple den Upload der Uhr-App ab - es ist dasselbe
  // wie das der Haupt-App, relativ zu diesem Ordner.
  icon: '../../assets/icon.png',
};
