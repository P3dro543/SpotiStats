import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conflicting Tailwind classes", () => {
    expect(cn("px-2", "px-4", "text-white")).toBe("px-4 text-white");
  });
});
