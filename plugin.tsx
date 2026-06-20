/** @jsxImportSource solid-js */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, onCleanup, Show, For } from "solid-js"
import { execFile } from "node:child_process"

interface NowPlaying {
  source: "Music" | "Spotify"
  state: "playing" | "paused"
  track: string
  artist: string
  album: string
  position: number
  duration: number
  art: string[]
}

const PY_SCRIPT = [
  "from PIL import Image",
  "import sys",
  "path = sys.argv[1]",
  "img = Image.open(path)",
  "w, h = 36, 18",
  "img = img.resize((w, h), Image.LANCZOS)",
  'img = img.convert("L")',
  'chars = " .-:=+*#%@"',
  "for y in range(h):",
  '  line = ""',
  "  for x in range(w):",
  "    v = img.getpixel((x, y))",
  "    line += chars[v * (len(chars) - 1) // 256]",
  "  print(line)",
].join("\n")

const JXA_QUERY = `
function getMusicInfo() {
  var app = Application("Music");
  if (!app.running()) return null;
  var state = app.playerState();
  if (state !== "playing" && state !== "paused") return null;
  var t = app.currentTrack;
  return {
    source: "Music",
    state: state,
    track: String(t.name()),
    artist: String(t.artist()),
    album: String(t.album()),
    position: Number(app.playerPosition()),
    duration: Number(t.duration()),
    id: String(t.persistentID())
  };
}
function getSpotifyInfo() {
  var app = Application("Spotify");
  if (!app.running()) return null;
  var state = app.playerState();
  if (state !== "playing" && state !== "paused") return null;
  var t = app.currentTrack;
  return {
    source: "Spotify",
    state: state,
    track: String(t.name()),
    artist: String(t.artist()),
    album: String(t.album()),
    position: Number(app.playerPosition()),
    duration: Number(t.duration()) / 1000,
    id: String(t.id()),
    artworkUrl: String(t.artworkUrl())
  };
}
var music = getMusicInfo();
var spotify = getSpotifyInfo();
var candidates = [music, spotify].filter(function(x) { return x !== null; });
var playing = candidates.filter(function(c) { return c.state === "playing"; });
var info = playing.length > 0 ? playing[0] : (candidates.length > 0 ? candidates[0] : null);
if (info) console.log(JSON.stringify(info));
`.trim()

const ART_PATH = "/tmp/album-art-tmp.jpg"

function jxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf-8", timeout: 5000 }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve((stderr || stdout).trim())
    })
  })
}

function osa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { encoding: "utf-8", timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

function py(code: string, arg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("python3", ["-c", code, arg], { encoding: "utf-8", timeout: 10000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

let lastId = ""
let cachedArt: string[] = []

async function fetchArtwork(source: string, artworkUrl?: string): Promise<string[]> {
  try {
    if (source === "Music") {
      const artScript = [
        'tell application "Music"',
        "  set art to artwork 1 of current track",
        "  set artData to raw data of art",
        `  set outFile to (POSIX file "${ART_PATH}")`,
        "  set fileRef to open for access outFile with write permission",
        "  write artData to fileRef",
        "  close access fileRef",
        "end tell",
      ].join("\n")
      await osa(artScript)
    } else if (source === "Spotify" && artworkUrl) {
      await new Promise<void>((resolve, reject) => {
        execFile("curl", ["-sL", artworkUrl, "-o", ART_PATH], { encoding: "utf-8", timeout: 10000 }, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
    const ascii = await py(PY_SCRIPT, ART_PATH)
    return ascii.split("\n")
  } catch {
    return []
  }
}

async function fetchNowPlaying(): Promise<NowPlaying | null> {
  try {
    const out = await jxa(JXA_QUERY)
    if (!out) return null
    const raw = JSON.parse(out)
    if (!raw.source || (raw.state !== "playing" && raw.state !== "paused")) return null

    const trackId = raw.id as string
    if (trackId !== lastId) {
      lastId = trackId
      cachedArt = []
      cachedArt = await fetchArtwork(raw.source, raw.artworkUrl)
    }

    return {
      source: raw.source,
      state: raw.state,
      track: String(raw.track),
      artist: String(raw.artist),
      album: String(raw.album),
      position: Number(raw.position) || 0,
      duration: Number(raw.duration) || 0,
      art: cachedArt,
    }
  } catch {
    return null
  }
}

function fmt(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

const SOURCE_ICON: Record<string, string> = { Music: "♫", Spotify: "◉" }

function View(props: { api: TuiPluginApi }) {
  const [np, setNp] = createSignal<NowPlaying | null>(null)
  const theme = () => props.api.theme.current

  fetchNowPlaying().then(setNp)
  const timer = setInterval(() => {
    fetchNowPlaying().then(setNp)
  }, 2000)
  onCleanup(() => clearInterval(timer))

  const cur = () => np()?.source ?? "Music"
  const playpause = () => osa(`tell application "${cur()}" to playpause`).catch(() => {})
  const next = () => osa(`tell application "${cur()}" to next track`).catch(() => {})
  const prev = () => osa(`tell application "${cur()}" to previous track`).catch(() => {})

  return (
    <box>
      <text fg={theme().text}>
        <Show when={np()} fallback={<><b>▶ Now Playing</b></>}>
          {(data) => <><b>▶ {SOURCE_ICON[data().source] ?? "♫"} Now Playing</b></>}
        </Show>
      </text>
      <Show when={np()}>
        {(data) => (
          <>
            <Show when={data().art.length > 0}>
              <box>
                <For each={data().art}>
                  {(line) => <text fg={theme().textMuted}>{line}</text>}
                </For>
              </box>
            </Show>
            <text fg={theme().textMuted}>{data().track}</text>
            <text fg={theme().textMuted}>{data().artist}</text>
            <box marginTop={1}>
              <ProgressBar pos={data().position} dur={data().duration} fg={theme().textMuted} />
            </box>
            <box flexDirection="row" gap={2} marginTop={1}>
              <text fg={theme().text} onMouseDown={prev}>⏮</text>
              <text fg={theme().text} onMouseDown={playpause}>
                {data().state === "playing" ? "⏸" : "▶"}
              </text>
              <text fg={theme().text} onMouseDown={next}>⏭</text>
            </box>
          </>
        )}
      </Show>
      <Show when={!np()}>
        <text fg={theme().textMuted}>No music playing</text>
      </Show>
    </box>
  )
}

function ProgressBar(props: { pos: number; dur: number; fg: string }) {
  const pct = props.dur > 0 ? Math.min(Math.max(props.pos / props.dur, 0), 1) : 0
  const filled = Math.floor(pct * 12)
  const empty = 12 - filled
  const bar = (filled > 0 ? "━".repeat(filled) : "") + (empty > 0 ? "─".repeat(empty) : "")
  return (
    <text fg={props.fg}>
      {fmt(props.pos)} {bar} {fmt(props.dur)}
    </text>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

export default { id: "now-playing", tui }
