// ConvertPicker — the "Convert to…" window for the Finder Quick Action.
//
// Built on the user's Mac by install.sh (`swiftc`, from Xcode Command Line Tools).
// Usage:   ConvertPicker '<json payload>'
// Output:  prints the chosen extension and exits 0; exits 1 if cancelled.
//
// Payload: { "path", "name", "subtitle", "targets": [{ "ext", "label", "group" }] }

import Cocoa
import SwiftUI

struct Target: Decodable, Identifiable, Hashable {
    let ext: String
    let label: String
    let group: String
    var id: String { ext }
}

struct FormatGroup: Identifiable {
    let name: String
    let targets: [Target]
    var id: String { name }
}

struct Payload: Decodable {
    let path: String
    let name: String
    let subtitle: String
    let targets: [Target]
}

func finish(_ ext: String?) {
    if let ext = ext {
        print(ext)
        fflush(stdout)
        exit(0)
    }
    exit(1)
}

guard CommandLine.arguments.count > 1,
      let data = CommandLine.arguments[1].data(using: .utf8),
      let payload = try? JSONDecoder().decode(Payload.self, from: data),
      !payload.targets.isEmpty
else {
    FileHandle.standardError.write("ConvertPicker: invalid payload\n".data(using: .utf8)!)
    exit(2)
}

// MARK: - Look

func rgb(_ r: Double, _ g: Double, _ b: Double) -> Color {
    Color(red: r / 255, green: g / 255, blue: b / 255)
}

let groupColors: [String: [Color]] = [
    "Video": [rgb(179, 108, 240), rgb(125, 59, 220)],
    "Audio": [rgb(255, 107, 139), rgb(242, 48, 79)],
    "Image": [rgb(79, 178, 255), rgb(20, 116, 240)],
    "Document": [rgb(142, 155, 176), rgb(94, 107, 128)],
    "Data & Sheets": [rgb(76, 211, 122), rgb(34, 162, 76)],
]

func colors(for group: String) -> [Color] {
    groupColors[group] ?? [rgb(199, 199, 204), rgb(154, 154, 160)]
}

struct VisualEffect: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .sidebar
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

// MARK: - Format tile

struct FormatTile: View {
    let target: Target
    let selected: Bool
    @State private var hovering = false

    var body: some View {
        let tint = colors(for: target.group)
        VStack(spacing: 6) {
            Text(target.ext.uppercased())
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
                .frame(width: 62, height: 42)
                .background(
                    LinearGradient(gradient: Gradient(colors: tint), startPoint: .top, endPoint: .bottom)
                )
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                .shadow(color: tint[1].opacity(hovering || selected ? 0.45 : 0.25),
                        radius: hovering || selected ? 7 : 3, x: 0, y: 2)
            Text(target.label)
                .font(.system(size: 10.5))
                .foregroundColor(.secondary)
                .lineLimit(1)
                .padding(.horizontal, 4)
        }
        .frame(width: 100, height: 86)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(selected ? Color.accentColor.opacity(0.16)
                               : (hovering ? Color.primary.opacity(0.06) : Color.clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(selected ? Color.accentColor : Color.clear, lineWidth: 2)
        )
        .scaleEffect(hovering ? 1.05 : 1.0)
        .contentShape(Rectangle())
        .onHover { inside in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.65)) { hovering = inside }
        }
    }
}

// MARK: - Window content

struct PickerView: View {
    let payload: Payload
    @State private var selected: String
    @State private var appeared = false

    init(payload: Payload) {
        self.payload = payload
        _selected = State(initialValue: payload.targets[0].ext)
    }

    var groups: [FormatGroup] {
        var order: [String] = []
        var map: [String: [Target]] = [:]
        for t in payload.targets {
            if map[t.group] == nil { order.append(t.group); map[t.group] = [] }
            map[t.group]!.append(t)
        }
        return order.map { FormatGroup(name: $0, targets: map[$0]!) }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header: the file's real Finder icon + name
            HStack(spacing: 14) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: payload.path))
                    .resizable()
                    .frame(width: 64, height: 64)
                    .shadow(color: Color.black.opacity(0.15), radius: 4, x: 0, y: 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Convert")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                    Text(payload.name)
                        .font(.system(size: 17, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(payload.subtitle)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24)
            .padding(.top, 36)
            .padding(.bottom, 18)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(groups) { group in
                        Text(group.name.uppercased())
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundColor(.secondary)
                            .padding(.leading, 6)
                            .padding(.top, 6)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100, maximum: 110), spacing: 6)],
                                  alignment: .leading, spacing: 6) {
                            ForEach(group.targets) { target in
                                FormatTile(target: target, selected: selected == target.ext)
                                    .onTapGesture(count: 2) { finish(target.ext) }
                                    .onTapGesture {
                                        withAnimation(.easeOut(duration: 0.15)) { selected = target.ext }
                                    }
                            }
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
            }

            Divider()

            // Footer
            HStack(spacing: 10) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Text("Converted on this Mac. Nothing is uploaded.")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Spacer()
                Button("Cancel") { finish(nil) }
                    .keyboardShortcut(.cancelAction)
                Button("Convert to \(selected.uppercased())") { finish(selected) }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        .background(VisualEffect())
        .opacity(appeared ? 1 : 0)
        .scaleEffect(appeared ? 1 : 0.97)
        .onAppear {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { appeared = true }
        }
    }
}

// MARK: - Window

func windowHeight(for payload: Payload) -> CGFloat {
    var groupCounts: [String: Int] = [:]
    var order: [String] = []
    for t in payload.targets {
        if groupCounts[t.group] == nil { order.append(t.group) }
        groupCounts[t.group, default: 0] += 1
    }
    let perRow = 5
    var grid: CGFloat = 24
    for g in order {
        let rows = (groupCounts[g]! + perRow - 1) / perRow
        grid += 26 + CGFloat(rows) * 92
    }
    let height = 118 + grid + 58
    return min(max(height, 320), 680)
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let width: CGFloat = 580
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: windowHeight(for: payload)),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.delegate = self
        window.contentView = NSHostingView(rootView: PickerView(payload: payload))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        finish(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
