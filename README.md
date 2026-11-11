# Studio Reef

A small living 3D reef: each client is a territory, each deliverable is a character.

## Getting started
Needs [Node.js](https://nodejs.org) 20 or newer.

    npm install
    cp -R Projects.example Projects   # start from the example, then put your own clients in
    npm run dev                        # then open http://localhost:5173

With no `Projects` folder you'll see demo data. Your `Projects` folder, and everything the reef records about your work, are listed in `.gitignore`, so they're never uploaded.

**Optional, macOS only:**
- **Desktop widget:** run `widget/build.sh` (needs the Xcode Command Line Tools: `xcode-select --install`). It installs *Reef Widget* and *Reef Helper* in `~/Applications`.
- **Claude Code chats as fish:** add hooks to `~/.claude/settings.json` that run `node "/path/to/this/folder/tools/reef-hook.mjs"` on these events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`, `TaskCreated`, `TaskCompleted` (see "Chats" below).

## Where things live
- `src/config.js`: every tweakable value (colours, camera, state thresholds)
- `Projects/`: your real projects (see "Your projects" below)
- `src/data/adapters/`: one file per data source, each turning its source into the common shape
- `tools/projectsFolder.js`: the dev-server helper that reads the Projects folder
- `src/data/schema.js`: the common shape `{ id, group, title, status, progress, lastActivity, link }`
- `src/data/state.js`: the state priority rules (working → done → waiting → stale → idle)
- `src/world/`: renderer, scene, camera. It only ever reads the common shape.
  - `terrain.js`: the gentle hills (the `WAVES` list sets their size)
  - `layout.js`: sticky layout rules, saved in the browser under `studio-reef.layout.v1`
  - `plots.js`, `scatter.js`: raised hex plots, scenery
  - `models.js`: the fish and their accessories, built from simple shapes
  - `reefModels.js`: the organic reef pieces: the four coral branch species, porous rocks, lettuce coral
  - `inhabitants.js`: draws the fish and animates each state (look for the `switch (e.state)` block)
  - `crowd.js`: who goes where: wandering, returning home, pushing apart, collision
  - `nav.js`: the walkable grid for each plot and A* pathfinding

- `src/world/life/`: what makes it feel alive
  - `events.js`: new items swimming in, celebrations, bubble trails from working fish
  - `traffic.js`: background schools of fish, the turtle, jellyfish (scenery)
  - `ambience.js`: the slow current (weather) and drifting marine snow
  - `particles.js`: the bubble/sparkle system
- `src/world/badges.js`: the "!" (waiting) and "✓" (done) badges
- `src/quality.js`: Low / Medium / High presets, frame-rate cap, idle mode
- `src/interaction.js`: clicking, hovering, shortcuts, screenshots
- `src/ui/`: the info card, counts, search, help and zone names (styles in `src/style.css`)

## Your projects
Three sources are read on every reload and merged (set up in `data.sources` in `src/config.js`):

1. **The Projects folder**: each folder is a client, and each file is a deliverable. Files with the same name and different extensions (`Board.html` + `Board.pdf`) count as one. "Open original" opens the file.
   **Working vs idle:** an island is *working* only while something real happened in the last 2 hours (`state.workingMinutes`): a file was saved, or its line in `_links.md` was edited (status, %, title or link). With no new event it falls back to *idle*, and to *asleep* after 7 days. Saving, moving or reorganising `_links.md` itself is not activity. The server remembers when each line last changed in `.reef-activity.json`, and a line it sees for the first time has no activity yet. Both views re-check states every minute and refresh when one changes. The main view waits until you've left it alone for a minute; the widget refreshes at once.
   Add a `_links.md` in a client folder (or one at the top of `Projects/` for all clients) for deliverables that live elsewhere, one per line:
   `https://figma.com/design/… | Landing page | in progress | 40%`
   or to set the status and % of a file:
   `Brand guidelines | in progress | 60%`
   In the top-level `Projects/_links.md`, link lines name their client in the third field: `url | title | client | status | %` (left empty, the client is the folder whose name appears in the title).
2. **A spreadsheet**: export it as `public/data/projects.csv` with columns `client, name, status, progress, updated, link` (other common names work too, e.g. `deliverable`, `stage`, `%`).
3. **Hand-written**: `public/data/my-projects.json`, in the same format as `mock-projects.json`. A row with just a `ref` (an item's id) and a few fields corrects that item, e.g. `{ "ref": "folder:Example Client/Brand guidelines", "percent": 60 }`.

Status words understood (any case): in progress / wip / doing · done / shipped / delivered / final · waiting on me / needs feedback / review · not started / todo / on hold. Add your own in `src/data/adapters/stages.js`.
If all three are empty you'll see the demo data from `mock-projects.json`. The Projects folder is only read by `npm run dev`; nothing in it is published by `npm run build`.

## Chats
Claude Code chats show up as fish too, in a territory per project (e.g. "Chats · TinyWorld"), named after the first thing you wrote:
- **working**: thinking or using tools (the card says which tool)
- **waiting on you** (badge "!"): it needs your permission, or it has answered and it's your turn; the card says which
- **done**: the chat ended
Click a chat's fish and **Go to chat** opens that conversation in the Claude app (chats run in a terminal have no button). Chats with nothing new for 3 days are left out (`showDays` in the `chats` source).

**Chats in the Claude Mac app** (the regular Chat tab) show up too, in "Chats · Claude". The widget's helper, **Reef Helper**, reads the app's window: a Stop button means *working*, an Allow button means *needs your permission*, and the Stop button going away means *answered: your turn*. Once you've had the app in front for a few seconds, the chat goes back to idle. It only sees the chat currently open in the app, and each chat you open becomes a fish. It reads window titles and button labels only, never your messages. It needs **Accessibility** permission once: System Settings → Privacy & Security → Accessibility → Reef Helper. Turn it off from the widget's 🐟 menu ("Track Claude app chats"). A summary of what it sees (titles and button labels) is written to `~/Library/Logs/ReefChatWatcher.txt` every 5 minutes.

How Claude Code chats are tracked: Claude Code runs `tools/reef-hook.mjs` at key moments of every chat (hooks in `~/.claude/settings.json`). The script writes each chat's latest state to `~/.claude/reef/sessions/`, and the reef reads it from there. The script never prints anything and always exits cleanly, so it can't disturb a chat. If you move the TinyWorld folder, update the hook paths in `~/.claude/settings.json`.

## Using it
Drag to grab the ground · scroll or pinch to zoom at the cursor · right-drag or Shift+drag to rotate and tilt.
Click a fish for its card; the camera follows it until you drag the map.

| Key | Does |
| --- | --- |
| W | Fly to the next one waiting on you |
| / | Search by name |
| H | Hide / show all panels |
| P | Save a screenshot |
| F | Photo mode (P to snap, Esc to leave) |
| Esc | Close card, stop following |
| ? | Shortcut list (and "Reset saved layout") |

## One big coral per client
Each client's project is one big coral in the middle of its first tile. Every deliverable is one branch of it, and its species (antler, Y-tube sponge, tube cluster, cup) is picked from the item id. The coral's rock grows a little with each item the client has.

**A branch's size**: the first rule that applies wins, and the item's card says which one it is:
1. **Set by hand**: drag the slider on the item's card. It's saved at once (in `.reef-overrides.json`) and stays until you press **Automatic**.
2. **Task list**: a Claude Code session that keeps a task list grows with it, e.g. 3 of 5 steps done = 60%. No input needed.
3. **Written in a file**: a % in `_links.md`, the CSV or `my-projects.json`, unless you pressed **Automatic** on the card.
4. **Time invested**: everything else grows with the working time that went into it, full size after `coral.fullAfterHours` (20 by default). It means "how much work went in", not "how close to done".

**Working time**: every file save, `_links.md` line edit and chat event is activity. Events closer together than `state.workingMinutes` form one working period, from its first event to its last; a lone event counts 5 minutes. The card shows **time today** and **total**. Claude Code sessions record their own time through the hook, even when the reef isn't open. File saves are noticed by the reef's server (widget or `npm run dev`), so saves made while neither runs count only their latest save. Times are kept in `.reef-time.json`.
Sizes and times update on screen without reloading the page.

## Seeing arrivals and celebrations
The world remembers what it saw on your last visit (in the browser). On reload:
- an item that wasn't there before swims in from the edge of the map;
- an item that became "shipped" since last time celebrates.

Try it: add a file to a client folder in `Projects/`, or mark one `shipped` in its `_links.md`, then reload.
Open `http://localhost:5173/?replay` to replay every arrival and celebration.

## Performance
Pick Low / Medium / High in the ? panel (remembered in the browser; Medium by default). The panel also shows live fps, draw calls and triangles.

| Preset | Resolution | Frame cap | Scenery | Background traffic |
| --- | --- | --- | --- | --- |
| Low | 1× | 30 fps | light | 1 school, 2 jellyfish, no turtle |
| Medium | 1.5× | 60 fps | medium | 2 schools, 3 jellyfish, turtle |
| High | 2× (retina) | screen rate | full | 3 schools, 5 jellyfish, turtle |

Fish, corals, badges, bubbles and celebrations are identical on every preset: presets only trim scenery.
For a screen left open all day: after 2 minutes without mouse or keyboard input the world drops to 20 fps, and any input restores full speed (`quality.idleAfterSeconds`, `quality.idleFps` in the config).

## Desktop widget
**Reef Widget** shows the reef in a small rounded panel on your Mac desktop, above the desktop icons and behind your windows, on every Space.
- **Start it:** click the **Reef Widget** shortcut on your Desktop, or find it in Launchpad or Spotlight (it's installed in `~/Applications`). Drag it to the Dock for a one-click Dock icon. Clicking it while it runs brings the widget back if it was closed or minimized.
- **Start it at login:** System Settings → General → Login Items → add `Reef Widget.app`.
- **Controls:** point at the widget and a bar fades in at the top:
  - drag the bar to **move** it (Option-drag anywhere works too); drag an edge to resize
  - 🔴 **close**: hides it (bring it back with 🐟 → Show widget)
  - 🟡 **minimize**: shrinks it to a small pill with the counts; click the pill to open it again, drag it to move
  - 🟢 **full screen**: the studio's main view (search, help, shortcuts) filling the screen; 🟢 again goes back to the widget. In full screen the bar appears when you point near the top edge.
  It remembers its position, and whether it was minimized, between launches.
- **Fish only:** the teal fish button on the hover bar, or 🐟 → *Fish only*, turns the widget into a transparent strip with **one fish per item waiting on you**: no water, plots or scenery. When nothing is waiting, it's empty and clicks pass through to your desktop. Each fish has the "!" badge and its name; point at it to see what it's waiting for. Click a fish and the widget switches back to the reef, flies to that item and opens its card. The strip resizes to the number of fish and remembers where you put it. The same button on its hover bar brings the reef back.
- **Menu bar fish:** Show widget · Minimize · Full screen · Fish only · Open main view in browser · Reload · Size · Keep above windows · Bring to front · Show log · Quit.
- **Reef Helper:** the widget starts a small background app, Reef Helper, which runs the reef's server on port 5199 (separate from `npm run dev`) and follows your Claude app chats. The first time, macOS asks two things about **Reef Helper**. Click **Allow** to let it use your **Desktop** folder, where TinyWorld lives. Then switch it on under System Settings → Privacy & Security → **Accessibility**; that one is only needed for app chats. Because the helper rarely changes, you're asked once, and rebuilding the widget doesn't ask again.
- **If it says the reef is taking a while:** check for a macOS permission dialog about Reef Helper and click Allow, then press **Try again**. The widget also restarts the server by itself if it stops (for example after sleep), and clicking the shortcut does the same. What happened is logged in `~/Library/Logs/ReefWidget.log` (🐟 → Show log).
- **Staying current:** It checks everything every 15 seconds (`liveness.checkSeconds`) and refreshes when something you'd see changed.
- **Rebuilding:** after changing `widget/ReefWidget.swift`, or if you move the TinyWorld folder, run `widget/build.sh`. It needs only the Xcode Command Line Tools; it quits the running widget, rebuilds and installs it in `~/Applications`, and starts it again.
