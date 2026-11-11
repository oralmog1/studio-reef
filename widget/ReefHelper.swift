// Reef Helper: the background half of Reef Widget. It does two jobs:
//
// 1. Runs the reef's local server (port 5199) and keeps it running.
//    It lives here, not in the widget, because macOS asks each app for
//    permission to read your Desktop folder (where TinyWorld is) — and asks
//    again after every rebuild. This helper rarely changes, so you're asked once.
//
// 2. Follows the chats open in the Claude Mac app and records
//    their state for the reef, next to the Claude Code chats
//    (~/.claude/reef/sessions/app-*.json).
//
// It reads the apps' windows through macOS Accessibility (you grant that once
// in System Settings → Privacy & Security → Accessibility). It only looks at
// window/page titles and BUTTON labels, never at the text of your chats:
//   a "Stop" button showing        → working  ("Writing a reply…")
//   an "Allow…" button showing     → waiting  ("Needs your permission")
//   the Stop button went away      → waiting  ("Answered: your turn")
//   app in front for a few seconds after it answered → seen (idle)
// Each chat title becomes its own fish. Code sessions in the Claude app are
// skipped: the Claude Code hooks already track those.
//
// Chat tracking can be switched off from the widget's menu (it creates
// ~/.claude/reef/.app-chats-off). Writes a diagnostics summary (titles and
// button labels only) every 5 minutes to ~/Library/Logs/ReefChatWatcher.txt.
//
// Started and stopped by Reef Widget; exits by itself if the widget is gone.

import AppKit
import ApplicationServices

let info = Bundle.main.infoDictionary ?? [:]
let projectPath = info["ReefProjectPath"] as? String ?? NSHomeDirectory() + "/Desktop/TinyWorld"
let nodePath = info["ReefNodePath"] as? String ?? "/usr/local/bin/node"
let port = 5199
let logPath = NSHomeDirectory() + "/Library/Logs/ReefWidget.log"
let offFlag = NSHomeDirectory() + "/.claude/reef/.app-chats-off"
let sessionsDir = NSHomeDirectory() + "/.claude/reef/sessions"
let diagPath = NSHomeDirectory() + "/Library/Logs/ReefChatWatcher.txt"
let widgetBundleID = "local.studio-reef.widget"
let pollSeconds = 4.0
let seenAfterSeconds = 6.0

struct Target { let key: String; let name: String; let bundleIDs: [String] }
let targets = [
  Target(key: "claude", name: "Claude", bundleIDs: ["com.anthropic.claudefordesktop"]),
]

func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success, let v else { return nil }
  return v as? T
}

func matches(_ s: String, _ pattern: String) -> Bool {
  s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
}

struct Scan {
  var stop = false, allow = false
  var webTitle: String?, webURL: String?
  var buttons: [String] = []
  var nodes = 0
}

// Walk a window's accessibility tree (bounded). Text elements are never read.
func walk(_ el: AXUIElement, _ s: inout Scan, depth: Int) {
  if s.nodes > 6000 || depth > 60 { return }
  s.nodes += 1
  let role: String = attr(el, kAXRoleAttribute) ?? ""
  if role == "AXStaticText" || role == "AXTextArea" || role == "AXTextField" { return }
  if role == "AXWebArea", s.webTitle == nil {
    s.webTitle = attr(el, kAXTitleAttribute) ?? attr(el, kAXDescriptionAttribute)
    if let u: URL = attr(el, kAXURLAttribute) { s.webURL = u.absoluteString }
  }
  if role == "AXButton" {
    let parts: [String?] = [attr(el, kAXTitleAttribute), attr(el, kAXDescriptionAttribute), attr(el, kAXHelpAttribute)]
    let label = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " / ")
    if !label.isEmpty {
      if s.buttons.count < 300, !s.buttons.contains(label) { s.buttons.append(label) }
      if matches(label, #"\bstop\b"#) { s.stop = true }
      if matches(label, #"^(allow|always allow|approve)\b"#) { s.allow = true }
    }
  }
  guard let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) else { return }
  for k in kids { walk(k, &s, depth: depth + 1) }
}

func fnv(_ s: String) -> String {
  var h: UInt64 = 0xcbf29ce484222325
  for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
  return String(h, radix: 16)
}

func cleanTitle(_ raw: String?, _ app: String) -> String {
  var t = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  for suffix in [" - \(app)", " | \(app)", " – \(app)", " — \(app)"] where t.hasSuffix(suffix) {
    t = String(t.dropLast(suffix.count))
  }
  if t.isEmpty || t == app { return "\(app) chat" }
  return t.count > 60 ? String(t.prefix(57)) + "…" : t
}

final class Watcher {
  struct Memory { var state: String; var note: String; var title: String; var link: String; var at: Date; var frontSince: Date? }
  var memory: [String: Memory] = [:]
  var lastDiag = Date.distantPast
  let iso = ISO8601DateFormatter()

  func tick() {
    guard AXIsProcessTrusted(), !FileManager.default.fileExists(atPath: offFlag) else { return }
    var diag: [String] = []
    for t in targets {
      guard let app = t.bundleIDs.lazy.compactMap({ NSRunningApplication.runningApplications(withBundleIdentifier: $0).first }).first else {
        diag.append("\(t.name): not running")
        continue
      }
      let ax = AXUIElementCreateApplication(app.processIdentifier)
      AXUIElementSetMessagingTimeout(ax, 0.6)
      // Claude's app is built on web tech; this asks it to expose its page to Accessibility
      if t.key == "claude" { AXUIElementSetAttributeValue(ax, "AXManualAccessibility" as CFString, kCFBooleanTrue) }
      let windows: [AXUIElement] = attr(ax, kAXWindowsAttribute) ?? []
      diag.append("\(t.name): running (\(app.bundleIdentifier ?? "?")), \(windows.count) window(s), frontmost: \(app.isActive)")
      for w in windows.prefix(4) {
        var s = Scan()
        walk(w, &s, depth: 0)
        let winTitle: String = attr(w, kAXTitleAttribute) ?? ""
        diag.append("  window \"\(winTitle)\" · page \"\(s.webTitle ?? "-")\" · url \(s.webURL ?? "-") · \(s.nodes) nodes · stop=\(s.stop) allow=\(s.allow)")
        diag.append("    buttons: " + s.buttons.prefix(80).joined(separator: " | "))
        // Code sessions in the Claude app are tracked by the Claude Code hooks
        if t.key == "claude", let u = s.webURL, u.contains("/epitaxy") || u.contains("/code") { continue }
        let title = cleanTitle(s.webTitle ?? winTitle, t.name)
        var link = "/api/open-app?app=\(t.key)"
        if let u = s.webURL, u.hasPrefix("https://claude.ai/") { link = "claude://" + u.dropFirst("https://".count) }
        update(t, title: title, link: link, scan: s, frontmost: app.isActive)
      }
    }
    if Date().timeIntervalSince(lastDiag) > 300 {
      lastDiag = Date()
      let text = "Reef Helper · \(iso.string(from: Date())) · accessibility: \(AXIsProcessTrusted())\n" + diag.joined(separator: "\n") + "\n"
      try? text.write(toFile: diagPath, atomically: true, encoding: .utf8)
    }
  }

  func update(_ t: Target, title: String, link: String, scan: Scan, frontmost: Bool) {
    let id = "app-\(t.key)-\(fnv(title))"
    let now = Date()
    var m = memory[id] ?? Memory(state: "", note: "", title: title, link: link, at: now, frontSince: nil)
    var state = m.state, note = m.note
    if scan.allow { (state, note) = ("permission", "Needs your permission") }
    else if scan.stop { (state, note) = ("working", "Writing a reply…") }
    else if m.state == "working" || m.state == "permission" { (state, note) = ("answered", "Answered: your turn") }
    else if m.state.isEmpty { (state, note) = ("seen", "Open in \(t.name)") } // first sight: nothing happening
    // you've been looking at the app since it answered → it's no longer waiting on you
    if state == "answered" && frontmost {
      if let since = m.frontSince, now.timeIntervalSince(since) >= seenAfterSeconds { (state, note) = ("seen", "Seen") }
      else if m.frontSince == nil { m.frontSince = now }
    } else { m.frontSince = nil }

    let changed = state != m.state || title != m.title || link != m.link
    m.state = state; m.note = note; m.title = title; m.link = link
    if changed {
      m.at = now
      write(id: id, t: t, m: m)
    }
    memory[id] = m
  }

  func write(id: String, t: Target, m: Memory) {
    let record: [String: Any] = [
      "session_id": id, "source": t.key, "cwd": "", "title": m.title, "state": m.state,
      "note": m.note, "event": "app", "link": m.link, "host_session_id": "", "at": iso.string(from: m.at),
    ]
    try? FileManager.default.createDirectory(atPath: sessionsDir, withIntermediateDirectories: true)
    if let data = try? JSONSerialization.data(withJSONObject: record) {
      try? data.write(to: URL(fileURLWithPath: "\(sessionsDir)/\(id).json"), options: .atomic)
    }
  }
}

// ---- the reef's server --------------------------------------------------

func log(_ line: String) {
  let text = "[\(ISO8601DateFormatter().string(from: Date()))] helper: \(line)\n"
  if let h = FileHandle(forWritingAtPath: logPath) {
    h.seekToEndOfFile()
    h.write(text.data(using: .utf8)!)
    try? h.close()
  } else {
    try? text.write(toFile: logPath, atomically: true, encoding: .utf8)
  }
}

final class ServerKeeper {
  var proc: Process?
  var stopping = false

  func start() {
    // Touch the project folder first, off the main thread: this is the moment
    // macOS asks (once) whether Reef Helper may use your Desktop folder.
    DispatchQueue.global().async {
      _ = try? FileManager.default.contentsOfDirectory(atPath: projectPath)
      DispatchQueue.main.async { self.launch() }
    }
  }

  func launch() {
    guard !stopping else { return }
    let attrs = try? FileManager.default.attributesOfItem(atPath: logPath)
    if attrs == nil || (attrs?[.size] as? Int ?? 0) > 1_000_000 { FileManager.default.createFile(atPath: logPath, contents: nil) }
    // append mode: the server's output and the log lines never overwrite each other
    let fd = open(logPath, O_WRONLY | O_APPEND | O_CREAT, 0o644)
    let out = fd >= 0 ? FileHandle(fileDescriptor: fd, closeOnDealloc: true) : nil
    let p = Process()
    p.executableURL = URL(fileURLWithPath: nodePath)
    p.arguments = ["node_modules/vite/bin/vite.js", "--port", "\(port)", "--strictPort", "--host", "127.0.0.1"]
    p.currentDirectoryURL = URL(fileURLWithPath: projectPath)
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = (nodePath as NSString).deletingLastPathComponent + ":/usr/bin:/bin"
    env["REEF_VITE_CACHE"] = "node_modules/.vite-widget" // its own cache, apart from `npm run dev`
    p.environment = env
    p.standardOutput = out
    p.standardError = out
    p.terminationHandler = { [weak self] proc in
      DispatchQueue.main.async {
        guard let self, !self.stopping else { return }
        log("server stopped (exit \(proc.terminationStatus)); starting it again")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.launch() }
      }
    }
    do {
      try p.run()
      proc = p
      log("server starting (pid \(p.processIdentifier))")
    } catch {
      log("couldn't start the server: \(error.localizedDescription) (node at \(nodePath)?)")
    }
  }

  func stop() {
    stopping = true
    proc?.terminate()
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let keeper = ServerKeeper()
keeper.start()

// Ask for Accessibility once (macOS shows its own dialog); keeps checking until granted.
let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
_ = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)

let watcher = Watcher()
let queue = DispatchQueue(label: "reef.chatwatcher")
let timer = DispatchSource.makeTimerSource(queue: queue)
timer.schedule(deadline: .now() + 1, repeating: pollSeconds)
timer.setEventHandler { watcher.tick() }
timer.resume()

// quit when the widget is gone, or when asked to
let parentCheck = DispatchSource.makeTimerSource(queue: .main)
parentCheck.schedule(deadline: .now() + 30, repeating: 30)
parentCheck.setEventHandler {
  if NSRunningApplication.runningApplications(withBundleIdentifier: widgetBundleID).isEmpty {
    keeper.stop()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
  }
}
parentCheck.resume()
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler {
  keeper.stop()
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
}
sigterm.resume()

app.run()
