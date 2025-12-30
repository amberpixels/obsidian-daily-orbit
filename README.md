# Daily Orbit

Adds a bar at the top of daily notes to quickly navigate between them.

TODO: images of demo

## Getting Started

This plugin replaces the view header in daily notes files with a navbar called Orbit. The normal view header is still displayed for other files, and you can still rename daily note files both in the tab bar and in the file explorer.

### Settings Tab

With the settings tab you can customize how the dates are formatted.

TODO: image demo

## Inspiration

I saw a navbar at the top of daily notes in RemNote and thought it was neat.

<-- TODO: Use our local image in here -->
![daily note navbar in RemNote](https://github.com/karstenpedersen/obsidian-daily-note-navbar/assets/53978294/025f8cb8-9b5c-4114-a1c3-8b95486f1841)

## Installation

1.  Open Settings.
2.  Go to "Community Plugins".
3.  Enable community plugins by pressing "Turn on community plugins".
4.  Click "Browse" to browse available community plugins.
5.  Search for "Daily Orbit".
6.  Click "Install" and enable the plugin.
7.  Close the community plugins window.

## Styling

- `daily-orbit`: The actual bar.
- `daily-orbit__default`: The default daily note elements.
- `daily-orbit__active`: The currently active daily note.
- `daily-orbit__not-exists`: The daily note elements that don't exists.
- `daily-orbit__current`: The daily note element for the current date.
- `daily-orbit__change-week`: The left and right buttons for changing weeks.

## Attribution

This project is a substantial fork of [Daily Note Navbar](https://github.com/karstenpedersen/obsidian-daily-note-navbar) by Karsten Finderup Pedersen.

The original concept and initial implementation are credited to Karsten. This fork (Daily Orbit) includes extensive modifications and new features:
- Complete architectural rewrite with Timewalk-based navigation
- Global timeline view mode with scrollable navigation
- Auto-metadata features for daily notes
- Document navigation with prev/next buttons
- Renamed branding and UI improvements

## Contact

-   Get in contact on the plugin's [GitHub page](https://github.com/amberpixels/obsidian-orbit).
