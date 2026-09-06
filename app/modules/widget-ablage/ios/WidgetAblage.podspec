Pod::Spec.new do |s|
  s.name           = 'WidgetAblage'
  s.version        = '1.0.0'
  s.summary        = 'Geteilte App-Gruppen-Ablage fuer das HomePilot-Widget'
  s.description    = 'Schreibt und liest die App-Gruppe, aus der das Widget seine Knoepfe und den Hausstand bezieht.'
  s.author         = 'HomePilot'
  s.homepage       = 'https://github.com/stibe881/Homepilot-Pro-neu'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
