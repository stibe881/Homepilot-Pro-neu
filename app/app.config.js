/**
 * Ergänzt die app.json um die eine Apple-Angabe, die nicht ins Repo gehört.
 *
 * Warum überhaupt: Für das Bild in der Push-Nachricht baut EAS ein zweites
 * Ziel in die App (die Notification Service Extension in `targets/`). Zum
 * Signieren braucht es die Team-ID des Apple-Kontos.
 *
 * Warum nur diese eine: Alles andere – Bundle-ID, Android-Paketname,
 * EAS-Projekt-Kennung, Kontoname – ist kein Geheimnis und für jeden Build
 * dieser App gleich. Das steht in der app.json und gehört dorthin: Ohne die
 * EAS-Projekt-Kennung stellt Expo gar keinen Push-Token aus, und ein
 * frischer Klon hätte dann stillschweigend keine Benachrichtigungen. Die
 * Team-ID dagegen ist eine Kontokennung und bleibt draussen.
 *
 * Einmalig im Ordner `app/` eine Datei `.env` anlegen (Git ignoriert sie):
 *
 *   HOMEPILOT_APPLE_TEAM_ID=ABCDE12345
 *
 * Sie steht auf https://developer.apple.com/account unter «Membership».
 * Für EAS-Builds gehört derselbe Wert zusätzlich in die `eas.json` unter
 * `build.<profil>.env` – der Build läuft auf einem fremden Rechner und
 * sieht deine `.env` nicht.
 *
 * Ohne den Wert bleibt alles wie bisher; nur der iOS-Build meldet dann,
 * dass ihm die Angabe fehlt. Android und Expo Go sind nicht betroffen.
 *
 * `HOMEPILOT_IOS_BUNDLE_ID` gibt es weiterhin als Notausgang, falls jemand
 * einen zweiten Build unter anderer Kennung braucht – gesetzt sticht sie
 * die app.json.
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
