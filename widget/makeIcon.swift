// Draws the app icon (a fish on reef water) into an .iconset folder.
// Used by build.sh: swift makeIcon.swift <out.iconset>
import AppKit

let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
  let s = CGFloat(px)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  // rounded square with the reef's water colours
  let inset = s * 0.1, r = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
  let shape = NSBezierPath(roundedRect: r, xRadius: r.width * 0.23, yRadius: r.width * 0.23)
  NSGradient(colors: [NSColor(red: 0.62, green: 0.80, blue: 0.72, alpha: 1), NSColor(red: 0.27, green: 0.55, blue: 0.52, alpha: 1)])!.draw(in: shape, angle: -90)
  // bubbles
  NSColor(white: 1, alpha: 0.55).setStroke()
  for (x, y, d) in [(0.72, 0.70, 0.07), (0.78, 0.80, 0.05), (0.69, 0.84, 0.035)] {
    let b = NSBezierPath(ovalIn: NSRect(x: s * x, y: s * y, width: s * d, height: s * d))
    b.lineWidth = max(1, s * 0.012)
    b.stroke()
  }
  // the fish, in the "working" amber
  let cfg = NSImage.SymbolConfiguration(pointSize: s * 0.42, weight: .regular)
    .applying(.init(paletteColors: [NSColor(red: 0.94, green: 0.64, blue: 0.23, alpha: 1)]))
  if let fish = NSImage(systemSymbolName: "fish.fill", accessibilityDescription: nil)?.withSymbolConfiguration(cfg) {
    let fs = fish.size
    fish.draw(in: NSRect(x: (s - fs.width) / 2, y: (s - fs.height) / 2 - s * 0.03, width: fs.width, height: fs.height))
  }
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
  try! draw(base).write(to: URL(fileURLWithPath: "\(out)/icon_\(base)x\(base).png"))
  try! draw(base * 2).write(to: URL(fileURLWithPath: "\(out)/icon_\(base)x\(base)@2x.png"))
}
