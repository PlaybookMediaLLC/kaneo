import { describe, expect, it } from "vite-plus/test";
import { apiOrigin } from "./api-origin";

describe("apiOrigin", () => {
  it("strips a trailing /api suffix from VITE_API_URL", () => {
    expect(apiOrigin("https://api.example.com/api")).toBe(
      "https://api.example.com",
    );
    expect(apiOrigin("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
  });

  it("falls back to the default API origin when unset", () => {
    expect(apiOrigin(undefined)).toBe("http://localhost:1337");
  });
});
