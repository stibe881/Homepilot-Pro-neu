Pod::Spec.new do |s|
  s.name           = 'Aufnahme'
  s.version        = '1.0.0'
  s.summary        = 'Sprachaufnahme fuer Durchsagen'
  s.description    = 'AVAudioRecorder-Anbindung, die erst beim Druck auf den Aufnahmeknopf initialisiert.'
  s.author         = 'HomePilot'
  s.homepage       = 'https://github.com/stibe881/Homepilot-Pro-neu'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
