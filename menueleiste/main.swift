// bijoubijou Server – kleines Programm für die Menüleiste (macOS).
// Servermodus: Mac bleibt wach (der Bildschirm darf ausgehen), bijoubijou und der Online-Link (Cloudflare-Tunnel)
// laufen und werden nach einem Absturz neu gestartet; der aktuelle Link steht im Menü.
// Normalmodus: alles wie gewohnt, der Mac darf schlafen; Server und Link, die dieses Programm gestartet hat, werden beendet.
// Gebaut wird es mit „bijoubijou Menueleiste einrichten.command“; das fertige Programm liegt im Projektordner.
import Cocoa

final class Controller: NSObject, NSApplicationDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  let dir: URL = Bundle.main.bundleURL.deletingLastPathComponent() // Projektordner (dort liegt server.js)
  let port = 3080
  let defaults = UserDefaults.standard

  var serverMode = false
  var activity: NSObjectProtocol?
  var server: Process?
  var tunnel: Process?
  var stopping = false
  var link = ""
  var serverUp = false
  var onBattery = false
  var note = ""
  var lidAwake: Bool { get { defaults.bool(forKey: "lidAwake") } set { defaults.set(newValue, forKey: "lidAwake") } }

  func applicationDidFinishLaunching(_ n: Notification) {
    if !FileManager.default.fileExists(atPath: dir.appendingPathComponent("server.js").path) {
      note = "server.js nicht gefunden – Programm muss im bijoubijou-Ordner liegen"
    }
    _ = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in self?.check() }
    if defaults.bool(forKey: "serverMode") { enterServer() } else { check() }
    rebuild()
  }

  func applicationWillTerminate(_ n: Notification) { leaveServer(keepSetting: true) }

  // ---------- Modi ----------
  func enterServer() {
    serverMode = true; stopping = false; defaults.set(true, forKey: "serverMode")
    // Ruhezustand bei Untätigkeit verhindern (Bildschirm darf aus), App Nap verhindern
    if activity == nil {
      activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled, .suddenTerminationDisabled], reason: "bijoubijou Servermodus")
    }
    note = "Starte …"; rebuild()
    DispatchQueue.global().async { [weak self] in
      guard let self = self else { return }
      self.update()
      DispatchQueue.main.async { self.startServer(); self.startTunnel(); self.check() }
    }
  }

  func leaveServer(keepSetting: Bool = false) {
    serverMode = false; stopping = true
    if !keepSetting { defaults.set(false, forKey: "serverMode") }
    if let a = activity { ProcessInfo.processInfo.endActivity(a); activity = nil }
    tunnel?.terminate(); tunnel = nil
    server?.terminate(); server = nil
    link = ""
    if lidAwake { setLidAwake(false) }
    note = ""; rebuild()
  }

  // ---------- Prozesse ----------
  func findExec(_ name: String, extra: [String] = []) -> String? {
    let paths = extra + ["/opt/homebrew/bin/\(name)", "/usr/local/bin/\(name)", "/usr/bin/\(name)"]
    return paths.first { FileManager.default.isExecutableFile(atPath: $0) }
  }

  @discardableResult
  func sh(_ cmd: String) -> Int32 {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/bash"); p.arguments = ["-c", cmd]
    p.currentDirectoryURL = dir
    var env = ProcessInfo.processInfo.environment; env["GIT_TERMINAL_PROMPT"] = "0"
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; p.environment = env
    p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
    do { try p.run(); p.waitUntilExit(); return p.terminationStatus } catch { return -1 }
  }

  // neueste Version holen, wenn der Ordner eine Git-Kopie ist (wie beim Doppelklick auf „bijoubijou starten“)
  func update() {
    if FileManager.default.fileExists(atPath: dir.appendingPathComponent(".git").path) && !portOpen() {
      sh("git fetch -q origin main && git checkout -q main && git merge -q --ff-only origin/main")
    }
  }

  func portOpen() -> Bool { sh("/usr/bin/curl -s -o /dev/null -m 2 http://localhost:\(port)/api/me") == 0 }

  func logHandle(_ name: String) -> FileHandle? {
    let tools = dir.appendingPathComponent(".tools"); try? FileManager.default.createDirectory(at: tools, withIntermediateDirectories: true)
    let f = tools.appendingPathComponent(name); FileManager.default.createFile(atPath: f.path, contents: nil)
    return try? FileHandle(forWritingTo: f)
  }

  func startServer() {
    guard serverMode, server == nil else { return }
    if portOpen() { serverUp = true; return } // läuft schon (z. B. über „bijoubijou starten“)
    guard let node = findExec("node") else { note = "Node.js nicht gefunden"; rebuild(); return }
    let p = Process(); p.executableURL = URL(fileURLWithPath: node); p.arguments = ["server.js"]; p.currentDirectoryURL = dir
    var env = ProcessInfo.processInfo.environment; env["PORT"] = String(port); p.environment = env
    if let h = logHandle("server.log") { p.standardOutput = h; p.standardError = h }
    p.terminationHandler = { [weak self] _ in DispatchQueue.main.async {
      guard let self = self else { return }
      self.server = nil; self.serverUp = false; self.rebuild()
      if self.serverMode && !self.stopping { DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.startServer() } }
    } }
    do { try p.run(); server = p } catch { note = "bijoubijou ließ sich nicht starten"; rebuild() }
  }

  func cloudflared() -> String? {
    let local = dir.appendingPathComponent(".tools/cloudflared").path
    if let c = findExec("cloudflared", extra: [local]) { return c }
    var arch = "amd64"
    #if arch(arm64)
    arch = "arm64"
    #endif
    let ok = sh("mkdir -p .tools && curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-\(arch).tgz | tar -xz -C .tools && chmod +x .tools/cloudflared") == 0
    return ok ? local : nil
  }

  func startTunnel() {
    guard serverMode, tunnel == nil else { return }
    DispatchQueue.global().async { [weak self] in
      guard let self = self else { return }
      let cf = self.cloudflared()
      DispatchQueue.main.async {
        guard self.serverMode, self.tunnel == nil else { return }
        guard let cf = cf else {
          self.note = "Tunnel-Programm fehlt (kein Internet?) – neuer Versuch in 1 min"; self.rebuild()
          DispatchQueue.main.asyncAfter(deadline: .now() + 60) { self.startTunnel() }; return
        }
        let p = Process(); p.executableURL = URL(fileURLWithPath: cf)
        p.arguments = ["tunnel", "--no-autoupdate", "--url", "http://localhost:\(self.port)"]; p.currentDirectoryURL = self.dir
        let pipe = Pipe(); p.standardError = pipe; p.standardOutput = pipe
        let log = self.logHandle("tunnel.log")
        pipe.fileHandleForReading.readabilityHandler = { h in
          let data = h.availableData; if data.isEmpty { return }
          log?.write(data)
          if let s = String(data: data, encoding: .utf8), let r = s.range(of: "https://[a-z0-9-]+\\.trycloudflare\\.com", options: .regularExpression) {
            let url = String(s[r]); DispatchQueue.main.async { self.link = url; self.note = ""; self.rebuild() }
          }
        }
        p.terminationHandler = { _ in DispatchQueue.main.async {
          pipe.fileHandleForReading.readabilityHandler = nil
          self.tunnel = nil; self.link = ""; self.rebuild()
          if self.serverMode && !self.stopping { DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.startTunnel() } }
        } }
        do { try p.run(); self.tunnel = p } catch { self.note = "Tunnel ließ sich nicht starten"; self.rebuild() }
      }
    }
  }

  // regelmäßig: läuft der Server? Netzteil dran?
  func check() {
    DispatchQueue.global().async { [weak self] in
      guard let self = self else { return }
      let up = self.portOpen()
      let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/pmset"); p.arguments = ["-g", "batt"]
      let pipe = Pipe(); p.standardOutput = pipe; try? p.run(); p.waitUntilExit()
      let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      DispatchQueue.main.async {
        self.serverUp = up; self.onBattery = out.contains("Battery Power")
        if self.serverMode && !up && self.server == nil { self.startServer() }
        self.rebuild()
      }
    }
  }

  // Wach bleiben auch bei zugeklapptem Deckel (braucht Admin-Passwort; Wärme beachten)
  func setLidAwake(_ on: Bool) {
    let script = "do shell script \"/usr/bin/pmset -a disablesleep \(on ? 1 : 0)\" with administrator privileges"
    var err: NSDictionary?
    _ = NSAppleScript(source: script)?.executeAndReturnError(&err)
    if err == nil { lidAwake = on } else if on { note = "Deckel-Einstellung nicht geändert" }
    rebuild()
  }

  // ---------- Menü ----------
  func rebuild() {
    item.button?.title = serverMode ? (link.isEmpty ? "◐ bijou" : "● bijou") : "○ bijou"
    item.button?.toolTip = serverMode ? "bijoubijou: Servermodus" : "bijoubijou: Normalmodus"
    let m = NSMenu()
    func info(_ t: String) { let i = NSMenuItem(title: t, action: nil, keyEquivalent: ""); i.isEnabled = false; m.addItem(i) }
    func act(_ t: String, _ sel: Selector, on: Bool = false) { let i = NSMenuItem(title: t, action: sel, keyEquivalent: ""); i.target = self; i.state = on ? .on : .off; m.addItem(i) }

    info(serverMode ? "Servermodus – Mac bleibt wach, Bildschirm darf aus" : "Normalmodus – Mac schläft wie gewohnt")
    info(serverUp ? "bijoubijou läuft (localhost:\(port))" : "bijoubijou läuft nicht")
    if serverMode { info(link.isEmpty ? "Online-Link wird aufgebaut …" : "Online: \(link)") }
    if !note.isEmpty { info(note) }
    if !link.isEmpty {
      act("Link kopieren", #selector(copyLink))
      act("Link im Browser öffnen", #selector(openLink))
    }
    m.addItem(.separator())
    act("Servermodus", #selector(toServer), on: serverMode)
    act("Normalmodus", #selector(toNormal), on: !serverMode)
    m.addItem(.separator())
    if serverMode {
      if onBattery { info("⚠ Läuft auf Akku – bitte Netzteil anschließen") }
      if !lidAwake { info("Deckel offen lassen (sonst schläft der Mac)") }
      act("Auch bei zugeklapptem Deckel wach bleiben …", #selector(toggleLid), on: lidAwake)
      act("Bildschirm jetzt ausschalten", #selector(displayOff))
      m.addItem(.separator())
    }
    act("bijoubijou im Browser öffnen", #selector(openLocal))
    act("Beenden", #selector(quit))
    item.menu = m
  }

  @objc func toServer() { if !serverMode { enterServer() } }
  @objc func toNormal() { if serverMode { leaveServer() } }
  @objc func copyLink() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(link, forType: .string) }
  @objc func openLink() { if let u = URL(string: link) { NSWorkspace.shared.open(u) } }
  @objc func openLocal() { if let u = URL(string: "http://localhost:\(port)") { NSWorkspace.shared.open(u) } }
  @objc func displayOff() { sh("/usr/bin/pmset displaysleepnow") }
  @objc func toggleLid() {
    if !lidAwake {
      let a = NSAlert(); a.messageText = "Auch zugeklappt wach bleiben?"
      a.informativeText = "Der Mac schläft dann auch bei geschlossenem Deckel nicht. Nicht in eine Tasche stecken (Wärme) und Netzteil anschließen. Im Normalmodus oder beim Beenden wird das wieder ausgeschaltet. macOS fragt nach deinem Passwort."
      a.addButton(withTitle: "Einschalten"); a.addButton(withTitle: "Abbrechen")
      NSApp.activate(ignoringOtherApps: true)
      if a.runModal() == .alertFirstButtonReturn { setLidAwake(true) }
    } else { setLidAwake(false) }
  }
  @objc func quit() { leaveServer(keepSetting: true); NSApp.terminate(nil) }
}

let app = NSApplication.shared
let controller = Controller()
app.delegate = controller
app.setActivationPolicy(.accessory)
app.run()
