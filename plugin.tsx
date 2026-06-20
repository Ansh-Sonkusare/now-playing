/** @jsxImportSource solid-js */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, onCleanup, Show, For } from "solid-js"
import { execFile } from "node:child_process"

interface NowPlaying {
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

const ART_PATH = "/tmp/album-art-tmp.jpg"
let lastTrack = ""
let cachedArt: string[] = []

async function fetchNowPlaying(): Promise<NowPlaying | null> {
  try {
    const script = [
      'tell application "Music"',
      "  if it is running then",
      "    set playerState to player state as string",
      '    if playerState is "playing" or playerState is "paused" then',
      "      set t to name of current track",
      "      set a to artist of current track",
      "      set al to album of current track",
      "      set pos to player position",
      "      set dur to duration of current track",
      "      return playerState & return & t & return & a & return & al & return & pos & return & dur",
      "    end if",
      "  end if",
      "end tell",
      'return ""',
    ].join("\n")

    const out = await osa(script)
    if (!out) return null
    const [state, track, artist, album, pos, dur] = out.split("\r")
    if (state !== "playing" && state !== "paused") return null

    if (track !== lastTrack) {
      lastTrack = track
      cachedArt = []
      try {
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
        const ascii = await py(PY_SCRIPT, ART_PATH)
        cachedArt = ascii.split("\n")
      } catch {}
    }

    return {
      state: state as NowPlaying["state"],
      track,
      artist,
      album,
      position: Number(pos) || 0,
      duration: Number(dur) || 0,
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

function View(props: { api: TuiPluginApi }) {
  const [np, setNp] = createSignal<NowPlaying | null>(null)
  const theme = () => props.api.theme.current

  fetchNowPlaying().then(setNp)
  const timer = setInterval(() => {
    fetchNowPlaying().then(setNp)
  }, 2000)
  onCleanup(() => clearInterval(timer))

  const playpause = () => { osa('tell application "Music" to playpause').catch(() => {}) }
  const next = () => { osa('tell application "Music" to next track').catch(() => {}) }
  const prev = () => { osa('tell application "Music" to previous track').catch(() => {}) }

  return (
    <box>
      <text fg={theme().text}>
        <b>▶ Now Playing</b>
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

export default { id: "apple-music", tui }
