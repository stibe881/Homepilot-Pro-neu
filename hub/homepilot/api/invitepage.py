"""Die Seite, auf der eine eingeladene Person ihr Passwort setzt.

Warum eine eigene Seite und nicht die App: Die Einladung kommt per
E-Mail, und der Link wird im Browser geöffnet – oft auf einem Gerät, auf
dem die App noch gar nicht installiert ist. Genau das ist ja der Fall,
für den es die Einladung gibt.

Warum bewusst eine einzelne, eingebettete Seite ohne Bilder, Schriften
und Skripte von aussen: Sie muss auch dann funktionieren, wenn sonst
nichts vom Hub erreichbar ist, und sie soll nichts nachladen, was jemand
mitlesen könnte.

Das Ticket steht im Fragment der Adresse (``#access_token=…``). Das
schickt der Browser nie an den Server – es bleibt im Gerät, bis diese
Seite es bewusst an den Hub weitergibt. Der Hub spricht dann mit
Supabase; die Seite selbst kennt weder Projekt noch Schlüssel.
"""

from __future__ import annotations

PAGE = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HomePilot – Passwort setzen</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 22px;
    background: #101318; color: #EDF0F5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; background: #191D24;
    border: 1px solid #2A303A; border-radius: 18px; padding: 24px;
  }
  h1 { font-size: 21px; margin: 0 0 6px; }
  p  { font-size: 14px; line-height: 21px; color: #A8B0BD; margin: 0 0 16px; }
  label { display: block; font-size: 13px; font-weight: 600; color: #A8B0BD; margin: 12px 0 6px; }
  input {
    width: 100%; padding: 13px 14px; font-size: 16px;
    background: #12161C; color: #EDF0F5;
    border: 1px solid #2A303A; border-radius: 12px;
  }
  button {
    width: 100%; margin-top: 18px; padding: 14px; font-size: 16px; font-weight: 700;
    color: #FFF; background: #3B82F6; border: 0; border-radius: 12px; cursor: pointer;
  }
  button[disabled] { opacity: .6; cursor: default; }
  .msg { margin-top: 14px; font-size: 14px; line-height: 21px; font-weight: 600; }
  .bad { color: #F87171; }
  .good { color: #4ADE80; }
  .hint { font-size: 12px; color: #6B7280; margin-top: 14px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Passwort setzen</h1>
    <p id="lead">Noch ein Schritt: Wähle ein Passwort, dann kannst du dich in
      der HomePilot-App anmelden.</p>
    <form id="form">
      <label for="pw">Neues Passwort</label>
      <input id="pw" type="password" autocomplete="new-password" minlength="8"
             placeholder="mindestens acht Zeichen">
      <label for="pw2">Noch einmal</label>
      <input id="pw2" type="password" autocomplete="new-password" minlength="8">
      <button id="go" type="submit">Passwort speichern</button>
    </form>
    <div id="msg" class="msg"></div>
    <p class="hint">Dieser Link gilt nur einmal und nur eine begrenzte Zeit.
      Ist er abgelaufen, bitte um eine neue Einladung.</p>
  </div>
<script>
(function () {
  // Supabase haengt das Ticket ans Fragment. Das kommt nie beim Server an -
  // deshalb liest es hier der Browser und schickt es nur an den Hub weiter.
  var raw = (location.hash || '').replace(/^#/, '') || location.search.replace(/^\\?/, '');
  var params = new URLSearchParams(raw);
  var token = params.get('access_token') || '';
  var form = document.getElementById('form');
  var msg = document.getElementById('msg');
  var go = document.getElementById('go');

  function fail(text) { msg.className = 'msg bad'; msg.textContent = text; }
  function done(text) { msg.className = 'msg good'; msg.textContent = text; }

  if (params.get('error') || !token) {
    form.style.display = 'none';
    document.getElementById('lead').textContent = '';
    var code = params.get('error_code') || '';
    fail(code.indexOf('expired') >= 0 || !token
      ? 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte jemanden im Haus um eine neue Einladung.'
      : (params.get('error_description') || 'Der Link ist nicht gueltig.'));
    return;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var pw = document.getElementById('pw').value;
    var pw2 = document.getElementById('pw2').value;
    if (pw.length < 8) { fail('Das Passwort braucht mindestens acht Zeichen.'); return; }
    if (pw !== pw2) { fail('Die beiden Passwoerter sind nicht gleich.'); return; }
    go.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Einen Moment ...';
    fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, password: pw })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.detail || ('Hub antwortet mit ' + response.status));
        return body;
      });
    }).then(function (body) {
      form.style.display = 'none';
      history.replaceState(null, '', location.pathname);
      done(body.message || 'Passwort gesetzt.');
    }).catch(function (err) {
      go.disabled = false;
      fail(String(err.message || err));
    });
  });
})();
</script>
</body>
</html>
"""
