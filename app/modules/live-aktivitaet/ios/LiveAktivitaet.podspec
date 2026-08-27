Pod::Spec.new do |s|
  s.name           = 'LiveAktivitaet'
  s.version        = '1.0.0'
  s.summary        = 'Haustuer-Live-Aktivitaet fuer HomePilot'
  s.description    = 'ActivityKit-Anbindung: Tokens beobachten und an den Hub melden.'
  s.author         = 'HomePilot'
  s.homepage       = 'https://github.com/stibe881/Homepilot-Pro-neu'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
