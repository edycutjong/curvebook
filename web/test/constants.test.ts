import { describe, expect, it } from "vitest";
import * as core from "@curvebook/core/constants";
import * as local from "@/lib/constants";

describe("client constants", () => {
  it("match @curvebook/core", () => {
    expect(local.WINDOW_SLOTS).toBe(core.WINDOW_SLOTS);
    expect(local.MIN_WINDOWS).toBe(core.MIN_WINDOWS);
    expect(local.MIN_CREATORS).toBe(core.MIN_CREATORS);
    expect(local.WSOL_MINT).toBe(core.WSOL_MINT);
  });
});
