Pod::Spec.new do |s|
  s.name           = 'WatchVerbindung'
  s.version        = '1.0.0'
  s.summary        = 'Zugangsdaten fuer die Apple-Watch-App'
  s.description    = 'WatchConnectivity-Anbindung: Hub-Adresse, Token und Haustuere zur Uhr schicken.'
  s.author         = 'HomePilot'
  s.homepage       = 'https://github.com/stibe881/Homepilot-Pro-neu'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.frameworks     = 'WatchConnectivity'
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
