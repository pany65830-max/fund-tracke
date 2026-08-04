import { describe, it, expect } from "vitest";
import { isReadableSourceUrl } from "./sourceUrl";

describe("isReadableSourceUrl", () => {
  it("rejects empty and example.com", () => {
    expect(isReadableSourceUrl("")).toBe(false);
    expect(isReadableSourceUrl("https://example.com/x")).toBe(false);
    expect(isReadableSourceUrl("not-a-url")).toBe(false);
  });

  it("accepts real http(s) links", () => {
    expect(isReadableSourceUrl("https://www.sse.com.cn/")).toBe(true);
    expect(isReadableSourceUrl("https://www.huatai-pb.com/")).toBe(true);
  });
});
