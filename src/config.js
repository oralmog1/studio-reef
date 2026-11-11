// Studio Reef — every value you might want to tweak lives here.
// Change a number, save, and Vite reloads the page.

export const config = {
  // ---- Data ----------------------------------------------------------
  // Every source is read on page load and merged into one world. Later
  // sources can correct earlier ones (same id → their fields win).
  // Adapters live in src/data/adapters/.
  data: {
    sources: [
      // Projects/ on disk: folder = client, file = deliverable, _links.md = extra ones
      { name: 'folder', adapter: 'folder', url: '/api/projects' },
      // a spreadsheet exported as CSV (optional; see README for the columns)
      { name: 'sheet', adapter: 'csv', url: '/data/projects.csv' },
      // Claude Code chats, recorded by tools/reef-hook.mjs (see README → Chats)
      { name: 'chats', adapter: 'chats', url: '/api/chats', showDays: 3 },
      // hand-written projects and corrections (optional), applied last
      { name: 'mine', adapter: 'simpleJson', url: '/data/my-projects.json' },
    ],
    // shown only when every source above is empty
    demo: { name: 'demo', adapter: 'simpleJson', url: '/data/mock-projects.json' },
  },

  // ---- State rules (see src/data/state.js) ---------------------------
  state: {
    // "Working now" = in progress AND a real event (file saved, status or %
    // edited) within this many minutes. With no new event it falls back to idle.
    workingMinutes: 120,
    // No activity for this many days = stale / asleep.
    staleAfterDays: 7,
  },

  // ---- Look ----------------------------------------------------------
  colors: {
    // Water / background. Calm, green-leaning sea.
    background: '#7fb8a8',
    fog: '#7fb8a8',
    seabed: '#d9cfa3', // sand in the dips
    seabedHigh: '#9dbd84', // seagrass-green on the crests
    plotTop: '#ece6d6', // plots are neutral: colour is for state
    plotSide: '#b7ab91',
    // reef scenery (muted on purpose: colour belongs to state)
    seagrass: '#6f9e5c',
    kelp: '#5d7f45',
    kelpLeaf: '#6f9150',
    sponge: '#8aa38a',
    lettuce: '#5e8a57', // lettuce coral (scenery), base → tip
    lettuceTip: '#a9c995',
    rock: '#a9a497',
    rockPit: '#837e72',
    // corals: one colour family (mauve → pale lilac tips), so only SIZE carries data.
    // (Warm oranges/reds are avoided on purpose: on the fish they mean working/waiting.)
    coral: '#7d4fa6',
    coralTip: '#d9b8ea',
    coralInside: '#4d3460', // inside the open tubes and cups
    coralBase: '#8f8aa6', // the porous rock each client's coral grows on
    coralBasePit: '#625c7c',
  },

  // What each state looks like. Colour means state, and nothing else.
  stateColors: {
    working: '#f0a23b', // amber
    done: '#58b4ee', // sky blue
    waiting: '#ef6461', // coral red: needs you
    stale: '#8d95a3', // slate grey
    idle: '#f3eee2', // cream
  },

  // ---- Ground --------------------------------------------------------
  plots: {
    tileSize: 5, // centre-to-corner of one hex tile
    clearance: 0.35, // how far plots rise above the bumpiest possible hill
    inset: 0.12, // hairline gap between tiles of the same zone
  },
  layout: {
    itemsPerExtraTile: 5, // a zone gets 1 tile + 1 more per this many items
  },
  scatter: {
    spacing: 2.2, // grid step for scenery; smaller = denser
    fill: 0.55, // chance each grid cell gets something (0..1)
    radius: 85, // how far out scenery goes
    plotMargin: 0.6, // keep this much clear around plots
  },

  // ---- Inhabitants ---------------------------------------------------
  inhabitants: {
    scale: 1.7, // overall fish size
    hover: 0.9, // how high fish float above the plot
    coralMin: 0.2, // branch size at 0% progress, as a fraction of full size
    coralScale: 1.75, // full-size branch (100% progress)
  },
  fog: { near: 70, far: 190 },

  // The world is a disc of this radius (metres-ish). Plots live inside it.
  worldRadius: 60,

  // ---- Camera (Google Earth style) -----------------------------------
  camera: {
    fov: 40,
    startDistance: 70, // how far the camera starts from the ground point
    minDistance: 8, // closest zoom
    maxDistance: 160, // furthest zoom
    startPitchDeg: 50, // 90 = looking straight down
    minPitchDeg: 20,
    maxPitchDeg: 85,
    startYawDeg: 30,
    zoomSpeed: 0.0015, // per wheel "pixel"; bigger = faster zoom
    rotateSpeed: 0.005, // radians per pixel of right-drag
  },

  // ---- The big coral (one per client; one branch per item) ------------
  coral: {
    // Coral size, when there's no task list and you haven't set it by hand:
    // working time invested, full size after this many hours. It means "how
    // much work went in", not "how close to done".
    fullAfterHours: 20,
    baseRadius: 0.7, // base size for a client with no items…
    basePerItem: 0.05, // …plus this much per item
    baseMax: 1.5,
    branchLean: 0.28, // how far branches lean outward (radians)
    fishDistance: 2.5, // gap between the coral and the ring of fish
    ringSpacing: 2.0, // gap between rings when a client has many items
    fishSpacing: 1.8, // space between neighbouring fish on a ring
  },

  // ---- Signals & interaction --------------------------------------
  badges: {
    size: 0.028, // on-screen size (fraction of the window height, roughly)
    height: 3.0, // how high above the plot they float
  },
  interaction: {
    flyDistance: 22, // how close the camera comes when flying to a fish
  },

  // ---- Movement (src/world/crowd.js, src/world/nav.js) -------------
  movement: {
    cellSize: 0.5, // pathfinding grid resolution
    edgeMargin: 1.0, // how close to a plot's edge fish may swim
    wanderSpeed: 0.9, // idle pottering speed (units per second)
    returnSpeed: 1.4, // speed when heading back to their spot
    minWander: 1.5, // shortest trip worth making
    pauseMin: 2, // seconds idle fish rest between trips
    pauseMax: 7,
    arriveDistance: 0.25,
    personalSpace: 1.5, // fish closer than this get pushed apart
    pushStrength: 2.5, // how firmly
    turnRate: 5, // radians per second
    stuckAfter: 2.5, // seconds without progress before rethinking a path
    coralClearance: 0.5, // keep-out radius around a full-size coral
    sleeperClearance: 1.1, // keep-out radius around a sleeping fish
  },

  // ---- Feeling alive (src/world/life/) ------------------------------
  life: {
    // new items swimming in
    arrivalSpeed: 7, // units per second
    arrivalHeight: 8, // how high they come in
    arrivalDelay: 1.2, // seconds after load before the first one appears
    arrivalStagger: 0.8, // seconds between each newcomer
    // corals growing when progress rose since last visit
    growSeconds: 3,
    // celebrations
    celebrateSeconds: 6, // extra-high hops for this long
    burstSize: 40, // sparkles per burst (3 bursts)
    // busy zones: seconds between bubbles from each working fish
    bubbleEvery: 0.9,
    maxParticles: 600,
    // background traffic (scenery)
    schools: 3,
    fishPerSchool: 12,
    turtle: true,
    jellies: 5,
    // weather: the current
    currentPeriod: 240, // seconds for one calm → strong → calm cycle (roughly)
    snowCount: 700, // drifting marine-snow specks
    snowHeight: 16,
    // photo mode (F)
    photoOrbitSpeed: 0.05, // radians per second
    photoPitchDeg: 24,
  },

  // ---- Quality (src/quality.js) --------------------------------------
  // Pick one in the ? panel; your choice is remembered in the browser.
  quality: {
    default: 'medium',
    presets: {
      low: { pixelRatio: 1, fps: 30, scatterFill: 0.3, snow: 200, schools: 1, jellies: 2, turtle: false },
      medium: { pixelRatio: 1.5, fps: 60, scatterFill: 0.45, snow: 450, schools: 2, jellies: 3, turtle: true },
      high: { pixelRatio: 2, fps: 0, scatterFill: 0.55, snow: 700, schools: 3, jellies: 5, turtle: true }, // fps 0 = as fast as the screen
      // used by the desktop widget: small window, so full sharpness is cheap; calm frame rate
      widget: { pixelRatio: 2, fps: 30, scatterFill: 0.45, snow: 300, schools: 2, jellies: 3, turtle: true },
    },
    // For a screen left open all day: with no mouse/keyboard input for this
    // long, drop to idleFps. Any input brings full speed straight back.
    idleAfterSeconds: 120,
    idleFps: 20,
  },

  // ---- Keeping states current (src/liveness.js) -------------------------
  liveness: {
    checkSeconds: 15, // re-read the sources and re-check every state this often
    calmSeconds: 60, // main view: only refresh after this long without mouse/keyboard input (the widget refreshes at once)
  },

  // ---- Renderer ------------------------------------------------------
  renderer: {
    maxPixelRatio: 2, // hard cap for retina screens (presets choose within this)
  },
};
