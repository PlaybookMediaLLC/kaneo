import { describe, expect, it } from "vite-plus/test";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("removes the markup and keeps the words", () => {
    expect(
      plainText(
        "## Export fails\n\nThe **CSV** export *stops* at `row 100`.\n\n- see [the log](https://example.com/log)\n> ![chart](x.png)",
      ),
    ).toBe("Export fails The CSV export stops at row 100. see the log chart");
  });

  it("leaves out code blocks, tags and rules", () => {
    expect(
      plainText("Before\n```js\nconst a = 1;\n```\n<br/>after\n\n---\n1. one"),
    ).toBe("Before after one");
  });

  it("keeps underscores inside words and plain numbers", () => {
    expect(plainText("Use snake_case_names and 2 * 3 items")).toBe(
      "Use snake_case_names and 2 * 3 items",
    );
  });

  it("returns an empty string for no text", () => {
    expect(plainText(null)).toBe("");
    expect(plainText("  \n ")).toBe("");
  });
});
