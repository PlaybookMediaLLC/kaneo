import { describe, expect, it } from "vite-plus/test";
import {
  extractDataUriImages,
  normalizeContentId,
  renderOutboundMessageHtml,
  rewriteCidToQuillsFiles,
  sanitizeInboundHtml,
} from "./html-media";

describe("html-media (#326)", () => {
  it("sanitizes dangerous tags, nested tags, slash-separated event handlers, and encoded javascript URIs while preserving inline images", () => {
    const dirty =
      '<p>Look here</p><scr<script></script>ipt>alert(1)</script><svg/onload=alert(1)><img/onerror=alert(1) src="cid:img001@gmail" alt="bug" /><a href="&#106;avascript:evil()">x</a>';
    const clean = sanitizeInboundHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<svg");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain('src="cid:img001@gmail"');
  });

  it("rewrites cid: img sources to quills-file:// references and tolerates malformed % sequences", () => {
    const map = new Map([
      [normalizeContentId("<img001@gmail>")!, "file_01abc"],
    ]);
    const { html, matchedFileIds } = rewriteCidToQuillsFiles(
      '<p>Screenshot:</p><img src="cid:img001@gmail" alt="err" /><img src="cid:%ZZ" />',
      map,
    );
    expect(html).toContain('src="quills-file://file_01abc"');
    expect(html).toContain('src="cid:%ZZ"');
    expect(matchedFileIds).toEqual(["file_01abc"]);
  });

  it("extracts base64 data:image URIs into uploadable buffers", () => {
    const tinyPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).toString("base64");
    const { text, images } = extractDataUriImages(
      `<p>Hi</p><img src="data:image/png;base64,${tinyPng}" />`,
    );
    expect(images).toHaveLength(1);
    expect(images[0]!.contentType).toBe("image/png");
    expect(images[0]!.bytes.byteLength).toBe(8);
    expect(text).toContain(images[0]!.placeholder);
  });

  it("renders outbound HTML with inline images in place and appended extras", () => {
    const html = renderOutboundMessageHtml(
      "Here is the screenshot:\n![err](quills-file://file_1)\nLet me know!",
      [
        { fileId: "file_1", filename: "err.png", src: "cid:file_1@quills" },
        {
          fileId: "file_2",
          filename: "extra.png",
          src: "https://app.example/api/quills-public/ws/media/tok",
        },
      ],
    );
    expect(html).toContain('src="cid:file_1@quills"');
    expect(html).toContain(
      'src="https://app.example/api/quills-public/ws/media/tok"',
    );
    expect(html).toContain("Let me know!");
  });
});
