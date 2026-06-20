# Apple Music Now Playing

An OpenCode TUI plugin that shows your currently playing Apple Music track in the sidebar.

## Features

- Shows now-playing info (track, artist) from Apple Music
- Displays album art as ASCII in the sidebar
- Progress bar with elapsed/total time
- Playback controls (⏮ play/pause ⏭)
- Polls every 2 seconds
- Album art cached per track (only re-converts on track change)

## Requirements

- macOS with Apple Music app
- [OpenCode](https://opencode.ai) with TUI enabled
- Python 3 with [Pillow](https://python-pillow.org/) (`pip3 install Pillow`)

## Installation

```sh
opencode plugin add apple-music-now-playing
```

Or add manually to `~/.config/opencode/tui.json`:

```json
{
  "plugin": ["file:///path/to/apple-music-now-playing/plugin.tsx"]
}
```

## License

MIT
