/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  // Ein Widget für den Homescreen und den Sperrbildschirm: die drei
  // Handgriffe, für die man sonst die App öffnet.
  type: 'widget',
  name: 'HomePilotWidget',
  displayName: 'HomePilot',
  // Wie bei der Benachrichtigungs-Erweiterung bewusst niedriger als die
  // App – das Widget nutzt nichts Neueres.
  deploymentTarget: '16.1',
};
