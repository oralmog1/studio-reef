// Reef Widget: shows Studio Reef in a small rounded panel on the Mac desktop.
//
// - Sits just above the desktop icons and behind normal windows, on every
//   Space (menu → "Keep above windows" to float it over everything instead).
// - A bar fades in at the top when the pointer is over the widget:
//     drag the bar to move · red: close (hide; bring back from the menu bar)
//     yellow: minimize to a small pill with the counts (click it to restore)
//     green: full screen with the studio's main view (green again to go back)
//   Option-drag anywhere also moves it; drag an edge to resize.
// - The reef's server (port 5199) is run by Reef Helper (widget/ReefHelper.swift),
//   which the widget starts and stops. It lives in that helper because macOS
//   asks each app for Desktop-folder access, again after every rebuild; the
//   helper rarely changes, so you're only asked once.
// - No Dock icon: use the fish in the menu bar.
// Build with ./build.sh (no Xcode needed).

import AppKit
import WebKit

let info = Bundle.main.infoDictionary ?? [:]
let projectPath = info["ReefProjectPath"] as? String ?? NSHomeDirectory() + "/Desktop/TinyWorld"
let nodePath = info["ReefNodePath"] as? String ?? "/usr/local/bin/node"
let port = 5199
let base = "http://127.0.0.1:\(port)/"
let widgetURL = URL(string: base + "?widget")!
let mainURL = URL(string: base)!
let fishURL = URL(string: base + "?widget&fish")! // "Fish only": just the items waiting on you
let fishSlot = NSSize(width: 120, height: 150) // strip size per fish
let logPath = NSHomeDirectory() + "/Library/Logs/ReefWidget.log"
// the helper: runs the server and follows chats in the Claude app (widget/ReefHelper.swift)
let helperURL = URL(fileURLWithPath: NSHomeDirectory() + "/Applications/Reef Helper.app")
let helperBundleID = "local.studio-reef.helper"
let appChatsOffFlag = NSHomeDirectory() + "/.claude/reef/.app-chats-off"

let sizes: [(String, NSSize)] = [("Small", NSSize(width: 340, height: 250)), ("Medium", NSSize(width: 460, height: 330)), ("Large", NSSize(width: 660, height: 470))]
let barHeight: CGFloat = 30
let pillHeight: CGFloat = 34
let widgetRadius: CGFloat = 18

// a Try again link (handled in decidePolicyFor below)
let tryAgain = "<br><a href='reef:retry' style='display:inline-block;margin-top:14px;padding:6px 14px;border-radius:8px;background:#fff;color:#1f3b33;text-decoration:none;font-weight:600'>Try again</a>"

func page(_ text: String) -> String {
  """
  <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#7fb8a8;
  font:13px -apple-system,system-ui;color:#1f3b33;text-align:center;padding:0 24px;box-sizing:border-box">\(text)</body></html>
  """
}

final class WidgetWindow: NSWindow {
  override var canBecomeKey: Bool { true } // so keyboard shortcuts and clicks work
  override var canBecomeMain: Bool { true }
}

// A view you can drag to move the window; a click without dragging calls onClick.
final class DragView: NSVisualEffectView {
  var onClick: (() -> Void)?
  private var start = NSPoint.zero, origin = NSPoint.zero, moved = false
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with event: NSEvent) {
    start = NSEvent.mouseLocation
    origin = window?.frame.origin ?? .zero
    moved = false
  }
  override func mouseDragged(with event: NSEvent) {
    let p = NSEvent.mouseLocation
    let dx = p.x - start.x, dy = p.y - start.y
    if abs(dx) + abs(dy) > 3 { moved = true }
    window?.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy))
  }
  override func mouseUp(with event: NSEvent) {
    if !moved { onClick?() }
  }
}

// The widget's content view: tells us when the pointer comes and goes.
final class HoverView: NSView {
  var onHover: ((NSPoint?) -> Void)? // pointer position in this view, or nil when it leaves
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self))
  }
  override func mouseEntered(with event: NSEvent) { onHover?(convert(event.locationInWindow, from: nil)) }
  override func mouseMoved(with event: NSEvent) { onHover?(convert(event.locationInWindow, from: nil)) }
  override func mouseExited(with event: NSEvent) { onHover?(nil) }
}

enum Mode: String { case widget, mini, full, fish }

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  var window: WidgetWindow!
  var content: HoverView!
  var web: WKWebView!
  var bar: DragView!
  var fullButton: NSButton!
  var pill: DragView!
  var pillLabel: NSTextField!
  var statusItem: NSStatusItem!
  var aboveItem, showItem, miniItem, fullItem, watchItem, fishItem: NSMenuItem!
  var fishButton: NSButton!
  var fishCount = 1
  var countsTimer: Timer?
  var mode = Mode.widget
  var serverReady = false
  var waitGeneration = 0 // bumps on every (re)start, so old waits stop
  var healthTimer: Timer?
  var healthFailures = 0

  func applicationDidFinishLaunching(_ note: Notification) {
    // only one widget at a time
    let me = Bundle.main.bundleIdentifier ?? ""
    if NSRunningApplication.runningApplications(withBundleIdentifier: me).count > 1 {
      NSApp.terminate(nil)
      return
    }
    buildWindow()
    buildMenu()
    startHelper()
    waitForServer(tries: 0)
    switch UserDefaults.standard.string(forKey: "mode") {
    case Mode.mini.rawValue: minimize()
    case Mode.fish.rawValue: enterFish()
    default: break
    }
  }

  func applicationWillTerminate(_ note: Notification) {
    NSRunningApplication.runningApplications(withBundleIdentifier: helperBundleID).forEach { $0.terminate() }
  }

  // ---- Claude app chats (helper app) ---------------------------------

  // chat tracking in the Claude app: on unless the flag file exists
  var trackChatApps: Bool {
    get { !FileManager.default.fileExists(atPath: appChatsOffFlag) }
    set {
      if newValue { try? FileManager.default.removeItem(atPath: appChatsOffFlag) }
      else {
        try? FileManager.default.createDirectory(atPath: (appChatsOffFlag as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: appChatsOffFlag, contents: nil)
      }
    }
  }

  // Start Reef Helper if it isn't running (it runs the server).
  func startHelper() {
    guard NSRunningApplication.runningApplications(withBundleIdentifier: helperBundleID).isEmpty else { return }
    guard FileManager.default.fileExists(atPath: helperURL.path) else {
      log("Reef Helper isn't installed; run widget/build.sh")
      return
    }
    let cfg = NSWorkspace.OpenConfiguration()
    cfg.activates = false
    NSWorkspace.shared.openApplication(at: helperURL, configuration: cfg)
    log("started Reef Helper")
  }

  @objc func toggleWatcher() {
    trackChatApps.toggle()
    watchItem.state = trackChatApps ? .on : .off
  }

  // Clicking the app (Dock, Desktop shortcut, Spotlight) while it's already
  // running brings the widget back, even if it was closed or minimized.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if mode == .mini { restore() }
    bringToFront()
    // clicked while the reef isn't showing: start it again
    if serverReady { checkHealth(force: true) } else { restartServer(reason: "opened from the shortcut while not running") }
    return false
  }

  // ---- window --------------------------------------------------------

  // The widget's own frame (normal mode), remembered between launches.
  var widgetFrame: NSRect {
    get {
      if let s = UserDefaults.standard.string(forKey: "widgetFrame") { return NSRectFromString(s) }
      // older builds let AppKit remember the frame; reuse it once
      if let old = UserDefaults.standard.string(forKey: "NSWindow Frame ReefWidget") {
        let n = old.split(separator: " ").prefix(4).compactMap { Double($0) }
        if n.count == 4 { return NSRect(x: n[0], y: n[1], width: n[2], height: n[3]) }
      }
      return NSRect(origin: NSPoint(x: 60, y: 80), size: sizes[1].1)
    }
    set { UserDefaults.standard.set(NSStringFromRect(newValue), forKey: "widgetFrame") }
  }

  func onScreen(_ r: NSRect) -> NSRect {
    NSScreen.screens.contains { $0.visibleFrame.intersects(r) } ? r : NSRect(origin: NSPoint(x: 60, y: 80), size: r.size)
  }

  func buildWindow() {
    let frame = onScreen(widgetFrame)
    window = WidgetWindow(contentRect: frame, styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.minSize = NSSize(width: 260, height: 190)
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
    window.delegate = self
    applyLevel()

    content = HoverView(frame: NSRect(origin: .zero, size: frame.size))
    content.wantsLayer = true
    content.layer?.cornerRadius = widgetRadius
    content.layer?.masksToBounds = true
    content.onHover = { [weak self] p in self?.hover(p) }

    let webConfig = WKWebViewConfiguration()
    webConfig.userContentController.add(self, name: "reef") // messages from the page (fish mode)
    web = WKWebView(frame: content.bounds, configuration: webConfig)
    web.setValue(false, forKey: "drawsBackground") // transparent where the page is (fish mode)
    web.autoresizingMask = [.width, .height]
    web.uiDelegate = self
    web.navigationDelegate = self
    content.addSubview(web)

    buildBar()
    buildPill()
    window.contentView = content
    web.loadHTMLString(page("Waking the reef…"), baseURL: nil)
    window.orderFront(nil)

    // Option-drag anywhere on the widget moves it
    NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
      guard let self, event.window === self.window, self.mode == .widget, event.modifierFlags.contains(.option) else { return event }
      self.window.performDrag(with: event)
      return nil
    }
  }

  func symbolButton(_ symbol: String, _ color: NSColor, _ tip: String, _ action: Selector) -> NSButton {
    let img = NSImage(systemSymbolName: symbol, accessibilityDescription: tip) ?? NSImage()
    let b = NSButton(image: img.withSymbolConfiguration(.init(pointSize: 14, weight: .regular)) ?? img, target: self, action: action)
    b.isBordered = false
    b.contentTintColor = color
    b.toolTip = tip
    b.setButtonType(.momentaryChange)
    return b
  }

  func buildBar() {
    bar = DragView(frame: NSRect(x: 0, y: content.bounds.height - barHeight, width: content.bounds.width, height: barHeight))
    bar.autoresizingMask = [.width, .minYMargin]
    bar.material = .hudWindow
    bar.blendingMode = .withinWindow
    bar.state = .active
    bar.alphaValue = 0
    bar.appearance = NSAppearance(named: .darkAqua) // readable in light and dark mode
    bar.toolTip = "Drag to move"

    let close = symbolButton("xmark.circle.fill", .systemRed, "Close (bring it back from the fish in the menu bar)", #selector(closeWidget))
    let mini = symbolButton("minus.circle.fill", .systemYellow, "Minimize", #selector(minimize))
    fullButton = symbolButton("arrow.up.left.and.arrow.down.right.circle.fill", .systemGreen, "Full screen: the studio's main view", #selector(toggleFull))
    fishButton = symbolButton("fish.circle.fill", .systemTeal, "Fish only: just what's waiting on you", #selector(toggleFish))
    for (i, b) in [close, mini, fullButton!, fishButton!].enumerated() {
      b.frame = NSRect(x: 8 + CGFloat(i) * 22, y: (barHeight - 18) / 2, width: 18, height: 18)
      bar.addSubview(b)
    }
    let title = NSTextField(labelWithString: "Studio Reef")
    title.font = .systemFont(ofSize: 11, weight: .semibold)
    title.textColor = .secondaryLabelColor
    title.alignment = .center
    title.frame = NSRect(x: 100, y: (barHeight - 15) / 2, width: bar.bounds.width - 200, height: 15)
    title.autoresizingMask = [.width]
    bar.addSubview(title)
    if let grip = NSImage(systemSymbolName: "arrow.up.and.down.and.arrow.left.and.right", accessibilityDescription: "Move") {
      let gv = NSImageView(image: grip)
      gv.contentTintColor = .tertiaryLabelColor
      gv.frame = NSRect(x: bar.bounds.width - 26, y: (barHeight - 14) / 2, width: 14, height: 14)
      gv.autoresizingMask = [.minXMargin]
      bar.addSubview(gv)
    }
    content.addSubview(bar)
  }

  func buildPill() {
    pill = DragView(frame: content.bounds)
    pill.autoresizingMask = [.width, .height]
    pill.material = .hudWindow
    pill.blendingMode = .behindWindow
    pill.state = .active
    pill.isHidden = true
    pill.appearance = NSAppearance(named: .darkAqua)
    pill.toolTip = "Click to open · drag to move"
    pill.onClick = { [weak self] in self?.restore() }
    if let fish = NSImage(systemSymbolName: "fish.fill", accessibilityDescription: "Reef") {
      let iv = NSImageView(image: fish)
      iv.contentTintColor = NSColor(red: 0.94, green: 0.64, blue: 0.23, alpha: 1)
      iv.frame = NSRect(x: 12, y: (pillHeight - 16) / 2, width: 18, height: 16)
      pill.addSubview(iv)
    }
    pillLabel = NSTextField(labelWithString: "Studio Reef")
    pillLabel.font = .systemFont(ofSize: 12, weight: .medium)
    pillLabel.frame = NSRect(x: 36, y: (pillHeight - 16) / 2, width: 260, height: 16)
    pill.addSubview(pillLabel)
    content.addSubview(pill)
  }

  // Show the bar: anywhere over the widget; in full screen only near the top edge.
  func hover(_ p: NSPoint?) {
    guard mode != .mini else { return }
    var show = p != nil
    if mode == .full, let p { show = p.y > content.bounds.height - 48 }
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = 0.18
      bar.animator().alphaValue = show ? 1 : 0
    }
  }

  var keepAbove: Bool {
    get { UserDefaults.standard.bool(forKey: "keepAbove") }
    set { UserDefaults.standard.set(newValue, forKey: "keepAbove") }
  }

  func applyLevel() {
    // desktop: just above the desktop icons, below every normal window
    window.level = keepAbove ? .floating : NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
  }

  // remember where the widget is (only its normal size/position)
  func windowDidMove(_ note: Notification) { rememberFrame() }
  func windowDidResize(_ note: Notification) { rememberFrame() }
  func rememberFrame() {
    if mode == .widget { widgetFrame = window.frame }
    if mode == .fish { UserDefaults.standard.set(NSStringFromPoint(NSPoint(x: window.frame.minX, y: window.frame.maxY)), forKey: "fishTopLeft") }
    if mode == .mini {
      // the pill's top-left corner is the widget's top-left corner
      var f = widgetFrame
      f.origin = NSPoint(x: window.frame.minX, y: window.frame.maxY - f.height)
      widgetFrame = f
    }
  }

  func setMode(_ m: Mode) {
    mode = m
    UserDefaults.standard.set(m == .full ? Mode.widget.rawValue : m.rawValue, forKey: "mode")
    fishItem?.state = m == .fish ? .on : .off
    fishButton.image = NSImage(systemSymbolName: m == .fish ? "water.waves.and.arrow.up" : "fish.circle.fill", accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: 14, weight: .regular))
    fishButton.toolTip = m == .fish ? "Back to the reef" : "Fish only: just what's waiting on you"
    miniItem?.title = m == .mini ? "Restore" : "Minimize"
    fullItem?.title = m == .full ? "Exit full screen" : "Full screen (main view)"
    let full = m == .full
    fullButton.image = NSImage(systemSymbolName: full ? "arrow.down.right.and.arrow.up.left.circle.fill" : "arrow.up.left.and.arrow.down.right.circle.fill", accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: 14, weight: .regular))
    fullButton.toolTip = full ? "Back to the widget" : "Full screen: the studio's main view"
  }

  // ---- close / minimize / full screen --------------------------------

  @objc func closeWidget() {
    if mode == .full { exitFull() }
    window.orderOut(nil) // the page pauses while hidden
    showItem.isEnabled = true
  }

  @objc func showWidget() {
    window.orderFront(nil)
    showItem.isEnabled = false
  }

  @objc func minimize() {
    if mode == .mini { return restore() }
    if mode == .full { exitFull() }
    if mode == .fish { exitFish(focus: nil) }
    setMode(.mini)
    bar.alphaValue = 0
    web.isHidden = true
    pill.isHidden = false
    content.layer?.cornerRadius = pillHeight / 2
    window.hasShadow = true
    let top = NSPoint(x: widgetFrame.minX, y: widgetFrame.maxY)
    resizePill(anchorTopLeft: top)
    refreshCounts()
    countsTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.refreshCounts() }
  }

  func resizePill(anchorTopLeft top: NSPoint) {
    pillLabel.sizeToFit()
    let w = min(360, max(130, pillLabel.frame.width + 50))
    window.minSize = NSSize(width: 100, height: pillHeight)
    window.setFrame(NSRect(x: top.x, y: top.y - pillHeight, width: w, height: pillHeight), display: true)
  }

  // the counts, as the page shows them (only the non-zero ones)
  func refreshCounts() {
    guard serverReady else { return }
    let js = "Array.from(document.querySelectorAll('.counts .count')).filter(e => getComputedStyle(e).display !== 'none').map(e => e.innerText.trim()).join('  ·  ')"
    web.evaluateJavaScript(js) { [weak self] result, _ in
      guard let self, self.mode == .mini else { return }
      let text = (result as? String) ?? ""
      self.pillLabel.stringValue = text.isEmpty ? "Studio Reef" : text
      self.resizePill(anchorTopLeft: NSPoint(x: self.window.frame.minX, y: self.window.frame.maxY))
    }
  }

  @objc func restore() {
    guard mode == .mini else { return }
    countsTimer?.invalidate()
    let f = widgetFrame
    setMode(.widget)
    pill.isHidden = true
    web.isHidden = false
    content.layer?.cornerRadius = widgetRadius
    window.minSize = NSSize(width: 260, height: 190)
    window.setFrame(f, display: true, animate: true)
  }

  @objc func toggleFull() {
    mode == .full ? exitFull() : enterFull()
  }

  func enterFull() {
    if mode == .mini { restore() }
    if mode == .fish { exitFish(focus: nil) }
    widgetFrame = window.frame
    setMode(.full)
    let screen = window.screen ?? NSScreen.main!
    window.level = .normal
    content.layer?.cornerRadius = 10
    window.setFrame(screen.visibleFrame, display: true, animate: true)
    if serverReady { web.load(URLRequest(url: mainURL)) }
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    bar.alphaValue = 0
  }

  // ---- "Fish only" ------------------------------------------------------
  // A transparent strip with one fish per item waiting on you (src/fishMode.js).
  // It sizes itself to the number of fish; clicking one opens the reef there.

  @objc func toggleFish() {
    mode == .fish ? exitFish(focus: nil) : enterFish()
  }

  var fishTopLeft: NSPoint {
    if let s = UserDefaults.standard.string(forKey: "fishTopLeft") { return NSPointFromString(s) }
    return NSPoint(x: widgetFrame.minX, y: widgetFrame.maxY) // first time: where the widget is
  }

  func fishFrame(anchor top: NSPoint) -> NSRect {
    let w = fishSlot.width * CGFloat(max(fishCount, 1))
    return onScreen(NSRect(x: top.x, y: top.y - fishSlot.height, width: w, height: fishSlot.height))
  }

  func enterFish() {
    if mode == .mini { restore() }
    if mode == .full { exitFull() }
    if mode == .widget { widgetFrame = window.frame }
    setMode(.fish)
    applyLevel()
    bar.alphaValue = 0
    content.layer?.cornerRadius = 0
    window.hasShadow = false
    window.minSize = NSSize(width: 100, height: 120)
    window.setFrame(fishFrame(anchor: fishTopLeft), display: true)
    if serverReady { web.load(URLRequest(url: fishURL)) }
  }

  func exitFish(focus: String?) {
    guard mode == .fish else { return }
    setMode(.widget)
    window.hasShadow = true
    content.layer?.cornerRadius = widgetRadius
    window.minSize = NSSize(width: 260, height: 190)
    window.setFrame(widgetFrame, display: true, animate: true)
    var url = widgetURL
    if let focus, let q = focus.addingPercentEncoding(withAllowedCharacters: .alphanumerics) {
      url = URL(string: base + "?widget&focus=" + q) ?? widgetURL
    }
    if serverReady { web.load(URLRequest(url: url)) }
  }

  // the page talks back: how many fish there are; which fish was clicked
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let msg = message.body as? [String: Any] else { return }
    if let n = msg["fishCount"] as? Int, mode == .fish {
      fishCount = n
      window.setFrame(fishFrame(anchor: NSPoint(x: window.frame.minX, y: window.frame.maxY)), display: true)
    }
    if let id = msg["openReef"] as? String, mode == .fish {
      exitFish(focus: id)
      bringToFront()
    }
  }

  // the page for the current mode
  var currentURL: URL {
    switch mode {
    case .full: return mainURL
    case .fish: return fishURL
    default: return widgetURL
    }
  }

  func exitFull() {
    setMode(.widget)
    applyLevel()
    content.layer?.cornerRadius = widgetRadius
    window.setFrame(widgetFrame, display: true, animate: true)
    if serverReady { web.load(URLRequest(url: widgetURL)) }
  }

  // ---- menu bar ------------------------------------------------------

  func buildMenu() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    if let img = NSImage(systemSymbolName: "fish", accessibilityDescription: "Reef Widget") {
      img.isTemplate = true
      statusItem.button?.image = img
    } else {
      statusItem.button?.title = "🐟"
    }
    let menu = NSMenu()
    menu.autoenablesItems = false
    func add(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
      item.target = self
      menu.addItem(item)
      return item
    }
    showItem = add("Show widget", #selector(showWidget))
    showItem.isEnabled = false
    miniItem = add("Minimize", #selector(minimize), "m")
    fullItem = add("Full screen (main view)", #selector(toggleFull), "f")
    fishItem = add("Fish only (what's waiting on you)", #selector(toggleFish))
    _ = add("Open main view in browser", #selector(openInBrowser), "o")
    _ = add("Reload", #selector(reload), "r")
    menu.addItem(.separator())
    let sizeMenu = NSMenu()
    for (i, (name, _)) in sizes.enumerated() {
      let item = NSMenuItem(title: name, action: #selector(setSize(_:)), keyEquivalent: "")
      item.target = self
      item.tag = i
      sizeMenu.addItem(item)
    }
    let sizeItem = NSMenuItem(title: "Size", action: nil, keyEquivalent: "")
    sizeItem.submenu = sizeMenu
    menu.addItem(sizeItem)
    aboveItem = add("Keep above windows", #selector(toggleAbove))
    aboveItem.state = keepAbove ? .on : .off
    _ = add("Bring to front", #selector(bringToFront))
    watchItem = add("Track Claude app chats", #selector(toggleWatcher))
    watchItem.state = trackChatApps ? .on : .off
    menu.addItem(.separator())
    _ = add("Show log", #selector(showLog))
    _ = add("Quit Reef Widget", #selector(quit), "q")
    statusItem.menu = menu
  }

  @objc func reload() {
    if serverReady { web.load(URLRequest(url: currentURL)) } else { restartServer(reason: "Reload chosen") }
  }
  @objc func openInBrowser() { NSWorkspace.shared.open(mainURL) }
  @objc func setSize(_ sender: NSMenuItem) {
    if mode == .fish { exitFish(focus: nil) }
    if mode != .widget { mode == .mini ? restore() : exitFull() }
    var f = window.frame
    let s = sizes[sender.tag].1
    f.origin.y += f.height - s.height // keep the top edge where it is
    f.size = s
    window.setFrame(f, display: true, animate: true)
  }
  @objc func toggleAbove() {
    keepAbove.toggle()
    aboveItem.state = keepAbove ? .on : .off
    if mode != .full { applyLevel() }
  }
  @objc func bringToFront() {
    showWidget()
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }
  @objc func showLog() { NSWorkspace.shared.open(URL(fileURLWithPath: logPath)) }
  @objc func quit() { NSApp.terminate(nil) }

  // ---- the reef's server --------------------------------------------

  // Log lines go to ~/Library/Logs/ReefWidget.log (kept between launches, trimmed at 1 MB).
  func log(_ line: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    let text = "[\(stamp)] widget: \(line)\n"
    if let h = FileHandle(forWritingAtPath: logPath) {
      h.seekToEndOfFile()
      h.write(text.data(using: .utf8)!)
      try? h.close()
    } else {
      try? text.write(toFile: logPath, atomically: true, encoding: .utf8)
    }
  }

  // Stop the server; Reef Helper starts it again by itself. Then wait for it.
  func restartServer(reason: String) {
    log("restarting the server: \(reason)")
    serverReady = false
    healthFailures = 0
    startHelper()
    let kill = Process()
    kill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
    kill.arguments = ["-f", "vite.js --port \(port)"]
    try? kill.run()
    kill.waitUntilExit()
    web.loadHTMLString(page("Waking the reef…"), baseURL: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.waitForServer(tries: 0) }
  }

  // Ask the server whether it's up (2 s limit).
  func ping(_ done: @escaping (Bool, String) -> Void) {
    var req = URLRequest(url: mainURL)
    req.timeoutInterval = 2
    req.cachePolicy = .reloadIgnoringLocalCacheData
    URLSession.shared.dataTask(with: req) { _, response, error in
      let code = (response as? HTTPURLResponse)?.statusCode ?? 0
      DispatchQueue.main.async { done(code == 200, error?.localizedDescription ?? "HTTP \(code)") }
    }.resume()
  }

  // Waits for the server, never giving up. Shows "Try again" if it's slow,
  // and starts the server again if its process has gone.
  func waitForServer(tries: Int) {
    if tries == 0 { waitGeneration += 1 }
    let gen = waitGeneration
    ping { [weak self] ok, why in
      guard let self, gen == self.waitGeneration else { return }
      if ok {
        self.log("server ready" + (tries > 0 ? " after \(tries) check(s)" : ""))
        self.serverReady = true
        self.web.load(URLRequest(url: self.currentURL))
        if self.mode == .mini { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.refreshCounts() } }
        self.startHealthChecks()
        return
      }
      if tries % 10 == 0 { self.log("server not answering yet (check \(tries + 1)): \(why)") }
      if tries == 20 {
        self.web.loadHTMLString(page("The reef is taking a while to start…<br><br><span style='font-size:12px;opacity:.75'>If macOS asked whether <b>Reef Helper</b> may access your <b>Desktop</b> folder, click <b>Allow</b>.</span>" + tryAgain), baseURL: nil)
      }
      if tries > 0, tries % 10 == 0 { self.startHelper() } // helper quit? start it again
      let delay = tries < 20 ? 0.5 : 2.0
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.waitForServer(tries: tries + 1) }
    }
  }

  // Every 20 s: still there? Two misses in a row (e.g. after sleep) → restart.
  func startHealthChecks() {
    healthTimer?.invalidate()
    healthTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in self?.checkHealth(force: false) }
  }

  func checkHealth(force: Bool) {
    guard serverReady else { return }
    ping { [weak self] ok, why in
      guard let self, self.serverReady else { return }
      if ok { self.healthFailures = 0; return }
      self.healthFailures += 1
      self.log("server check failed (\(self.healthFailures)): \(why)")
      if force || self.healthFailures >= 2 { self.restartServer(reason: "server stopped answering") }
    }
  }

  // ---- links open in your normal browser ------------------------------

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  // the reef page itself failed to load: check the server (restarts it if needed)
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    guard serverReady else { return }
    log("page failed to load: \(error.localizedDescription)")
    checkHealth(force: true)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.request.url?.scheme == "reef" { // the Try again button
      restartServer(reason: "Try again clicked")
      return decisionHandler(.cancel)
    }
    // only the widget and main-view pages load in here; every other link opens in your browser
    if action.navigationType == .linkActivated, let url = action.request.url, url != widgetURL, url != mainURL {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // no Dock icon

// build.sh restarts the widget with a plain "terminate" signal; quit
// properly on it, so the reef's server is stopped too.
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()

app.run()
