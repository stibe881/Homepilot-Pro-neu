/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  // Eine Notification Service Extension: ein eigenes kleines Programm, das
  // iOS zwischen dem Eintreffen einer Push-Nachricht und ihrer Anzeige
  // laufen lässt. Nur dort darf ein Bild nachgeladen und angehängt werden –
  // die App selbst läuft zu diesem Zeitpunkt nicht.
  type: 'notification-service',
  name: 'NotificationImage',
  displayName: 'HomePilot Bilder',
  // Bewusst niedriger als die App: Die Extension nutzt nichts Neueres, und
  // ein höheres Ziel als das der App liesse den Build scheitern.
  deploymentTarget: '15.1',
};
