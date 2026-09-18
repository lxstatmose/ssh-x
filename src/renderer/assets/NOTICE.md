# Bundled fonts

`JetBrainsMono-Regular.ttf`, `JetBrainsMono-Medium.ttf` and
`JetBrainsMono-Bold.ttf` are JetBrains Mono.

- Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- Licensed under the SIL Open Font License, Version 1.1
- License text: https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt

The font is bundled (rather than loaded from a CDN) so that the terminal renders
identically offline and in packaged builds — see the `@font-face` rules at the
top of `src/renderer/style.css`.
