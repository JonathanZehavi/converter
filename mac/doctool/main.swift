// DocTool — document ↔ PDF conversions for the Converter Quick Action.
// Built on the user's Mac by install.sh. Uses only Apple frameworks (AppKit, PDFKit).
//
//   DocTool topdf    <input> <output.pdf>             docx/doc/odt/rtf/html/txt → paginated A4 PDF
//   DocTool pdftext  <input.pdf> <output> <docx|rtf|html|txt>
//   DocTool pdfimages <input.pdf> <output-base> <png|jpg>   prints each written path
//
// Exits 0 on success; on failure prints a short reason to stderr and exits 1.

import Cocoa
import PDFKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 4 else { fail("usage: DocTool topdf|pdftext|pdfimages <input> <output> [format]") }
let mode = args[1]
let inputURL = URL(fileURLWithPath: args[2])
let output = args[3]
_ = NSApplication.shared  // AppKit text and printing need an application object

// MARK: - document → PDF

func readAttributed(_ url: URL) -> NSAttributedString {
    var options: [NSAttributedString.DocumentReadingOptionKey: Any] = [:]
    switch url.pathExtension.lowercased() {
    case "txt", "text", "md":
        options[.documentType] = NSAttributedString.DocumentType.plain
        options[.characterEncoding] = String.Encoding.utf8.rawValue
    case "html", "htm":
        options[.documentType] = NSAttributedString.DocumentType.html
        options[.characterEncoding] = String.Encoding.utf8.rawValue
    default:
        break  // docx, doc, odt, rtf: detected automatically
    }
    do {
        return try NSAttributedString(url: url, options: options, documentAttributes: nil)
    } catch {
        fail("Could not read \(url.lastPathComponent)")
    }
}

func toPDF() {
    let text = readAttributed(inputURL)
    let paper = NSSize(width: 595.28, height: 841.89)  // A4 in points
    let margin: CGFloat = 54

    let printInfo = NSPrintInfo()
    printInfo.paperSize = paper
    printInfo.topMargin = margin
    printInfo.bottomMargin = margin
    printInfo.leftMargin = margin
    printInfo.rightMargin = margin
    printInfo.horizontalPagination = .fit
    printInfo.verticalPagination = .automatic
    printInfo.isHorizontallyCentered = false
    printInfo.isVerticallyCentered = false
    printInfo.jobDisposition = .save
    printInfo.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL.rawValue] = URL(fileURLWithPath: output)

    let width = paper.width - margin * 2
    let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: paper.height))
    textView.isVerticallyResizable = true
    textView.isHorizontallyResizable = false
    textView.textContainer?.widthTracksTextView = true
    textView.textContainerInset = .zero
    textView.textContainer?.lineFragmentPadding = 0
    textView.backgroundColor = .white
    textView.drawsBackground = true
    textView.textStorage?.setAttributedString(text)
    if let layout = textView.layoutManager, let container = textView.textContainer {
        layout.ensureLayout(for: container)
        let used = layout.usedRect(for: container)
        textView.setFrameSize(NSSize(width: width, height: max(used.height, 10)))
    }

    let operation = NSPrintOperation(view: textView, printInfo: printInfo)
    operation.showsPrintPanel = false
    operation.showsProgressPanel = false
    guard operation.run(), FileManager.default.fileExists(atPath: output) else {
        fail("Could not create the PDF")
    }
}

// MARK: - PDF → text formats

func openPDF() -> PDFDocument {
    guard let doc = PDFDocument(url: inputURL) else { fail("\(inputURL.lastPathComponent) is damaged or isn’t a real PDF") }
    if doc.isLocked { fail("\(inputURL.lastPathComponent) is password-protected") }
    return doc
}

func pdfText(format: String) {
    let doc = openPDF()
    let result = NSMutableAttributedString()
    for i in 0..<doc.pageCount {
        guard let page = doc.page(at: i), let pageText = page.attributedString else { continue }
        if result.length > 0 { result.append(NSAttributedString(string: "\n\n")) }
        result.append(pageText)
    }
    let plain = result.string.trimmingCharacters(in: .whitespacesAndNewlines)
    if plain.isEmpty { fail("This PDF has no text layer (it’s probably a scan). Convert it to JPG or PNG instead.") }

    let url = URL(fileURLWithPath: output)
    do {
        if format == "txt" {
            try result.string.write(to: url, atomically: true, encoding: .utf8)
            return
        }
        let types: [String: NSAttributedString.DocumentType] = [
            "docx": .officeOpenXML, "rtf": .rtf, "html": .html,
        ]
        guard let type = types[format] else { fail("Unsupported format \(format)") }
        let data = try result.data(from: NSRange(location: 0, length: result.length),
                                   documentAttributes: [.documentType: type])
        try data.write(to: url)
    } catch {
        fail("Could not write \(url.lastPathComponent)")
    }
}

// MARK: - PDF → images

func pdfImages(format: String) {
    let doc = openPDF()
    let count = doc.pageCount
    if count == 0 { fail("The PDF has no pages") }
    for i in 0..<count {
        guard let page = doc.page(at: i) else { continue }
        let box = page.bounds(for: .mediaBox)
        let scale = min(2.0, 4000.0 / max(box.width, box.height))
        let w = Int(box.width * scale), h = Int(box.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                         isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: rep)
        else { fail("Could not render page \(i + 1)") }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        let cg = context.cgContext
        cg.setFillColor(NSColor.white.cgColor)
        cg.fill(CGRect(x: 0, y: 0, width: w, height: h))
        cg.scaleBy(x: scale, y: scale)
        cg.translateBy(x: -box.origin.x, y: -box.origin.y)
        page.draw(with: .mediaBox, to: cg)
        NSGraphicsContext.restoreGraphicsState()

        let type: NSBitmapImageRep.FileType = format == "jpg" ? .jpeg : .png
        let props: [NSBitmapImageRep.PropertyKey: Any] = format == "jpg" ? [.compressionFactor: 0.9] : [:]
        guard let data = rep.representation(using: type, properties: props) else { fail("Could not encode page \(i + 1)") }
        let path = count == 1 ? "\(output).\(format)" : "\(output) - page \(i + 1).\(format)"
        do { try data.write(to: URL(fileURLWithPath: path)) } catch { fail("Could not write \(path)") }
        print(path)
    }
}

// MARK: - main

switch mode {
case "topdf": toPDF()
case "pdftext": pdfText(format: args.count > 4 ? args[4] : "txt")
case "pdfimages": pdfImages(format: args.count > 4 ? args[4] : "png")
default: fail("Unknown mode \(mode)")
}
exit(0)
