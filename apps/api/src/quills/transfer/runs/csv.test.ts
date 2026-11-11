import { describe, expect, it } from "vite-plus/test";
import { csvLines, parseCsv } from "./csv";
import { readRecords } from "./import-posts";

describe("CSV for transfer runs", () => {
  it("quotes special characters and neutralizes formulas", () => {
    expect(
      csvLines([
        ["a", "b", "c"],
        ['He said "hi", then left', "=SUM(A1)", 3],
        ["line\nbreak", null, new Date("2026-01-02T03:04:05.000Z")],
      ]),
    ).toBe(
      'a,b,c\r\n"He said ""hi"", then left",\'=SUM(A1),3\r\n"line\nbreak",,2026-01-02T03:04:05.000Z\r\n',
    );
  });

  it("parses what it writes, with CRLF, LF, BOM and blank lines", () => {
    const rows = [["x,y", 'quote "q"', "multi\r\nline"]];
    expect(parseCsv(csvLines([["one", "two", "three"], ...rows]))).toEqual([
      ["one", "two", "three"],
      ...rows,
    ]);
    expect(parseCsv("﻿a,b\n\n1,2\n3,")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", ""],
    ]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a\n"open')).toThrow("not closed");
  });

  it("reads import records by normalized header, within the file limits", () => {
    expect(readRecords("Title,Content,Author Email\nA,B\n")).toEqual({
      records: [{ title: "A", content: "B", author_email: "" }],
    });
    expect(readRecords('title,content\n"open')).toEqual({
      error: "The file is not valid CSV",
    });
    expect(readRecords("title,status\nA,B\n")).toEqual({
      error: "Missing required columns: content",
    });
    expect(readRecords("title,content\n")).toEqual({
      error: "The file has no rows",
    });
    expect(readRecords(`title,content\n${"a,b\n".repeat(10_001)}`)).toEqual({
      error: "The file has more than 10,000 rows",
    });
  });
});
