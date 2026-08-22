"""Die API-Routen, ein Modul je Sachgebiet.

Herausgelöst aus server.py (Punkt 16 der Werkbank): Dort stehen noch die
Authentifizierung, der WebSocket und die Web-Auslieferung; alles andere
hängt sich hier über register(app, ctx) an. Der Kontext (api/context.py)
reicht die geteilten Closures - hub, require, current_user … - weiter.
"""
