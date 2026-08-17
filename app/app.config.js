/**
 * Ergänzt die app.json um die beiden Apple-Angaben, die nicht ins Repo
 * gehören.
 *
 * Warum überhaupt: Für das Bild in der Push-Nachricht baut EAS ein zweites
 * Ziel in die App (die Notification Service Extension in `targets/`). Dieses
 * Ziel braucht eine eigene Bundle-ID, die von der der App abgeleitet wird –
 * und beides muss zu dem passen, was in deinem Apple-Konto steht.
 *
 * Warum über Umgebungsvariablen und nicht direkt in der app.json: Die
 * app.json liegt im Repo. Stünden die Werte dort, müsste jeder sie lokal
 * ändern – und ab dann scheitert jedes `git pull` an den eigenen
 * Änderungen. So bleibt die verfolgte Datei in Ruhe.
 *
 * Einmalig im Ordner `app/` eine Datei `.env` anlegen (die ist bereits von
 * Git ausgenommen):
 *
 *   HOMEPILOT_IOS_BUNDLE_ID=me.deinname.homepilot
 *   HOMEPILOT_APPLE_TEAM_ID=ABCDE12345
 *
 * Die Team-ID steht auf https://developer.apple.com/account unter
 * «Membership». Für EAS-Builds gehören dieselben zwei Werte zusätzlich in
 * die `eas.json` unter `build.<profil>.env` – der Build läuft auf einem
 * fremden Rechner und sieht deine `.env` nicht.
 *
 * Ohne die Werte bleibt alles wie bisher; nur der iOS-Build meldet dann,
 * dass ihm die Angaben fehlen. Android und Expo Go sind nicht betroffen.
 */
module.exports = ({ config }) => {
  const bundleIdentifier = process.env.HOMEPILOT_IOS_BUNDLE_ID;
  const appleTeamId = process.env.HOMEPILOT_APPLE_TEAM_ID;
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(bundleIdentifier ? { bundleIdentifier } : {}),
      ...(appleTeamId ? { appleTeamId } : {}),
    },
  };
};
