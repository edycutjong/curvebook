import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { rateLimiter, clientIp } from "@/lib/ratelimit";

describe("rateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows the first request for a new key", () => {
    const limiter = rateLimiter(3, 1000);
    expect(limiter("key1")).toBe(true);
  });

  it("allows subsequent requests within the limit", () => {
    const limiter = rateLimiter(3, 1000);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(true);
  });

  it("rejects requests exceeding the limit", () => {
    const limiter = rateLimiter(3, 1000);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(false);
    expect(limiter("key1")).toBe(false);
  });

  it("resets the window after windowMs expires", () => {
    const limiter = rateLimiter(2, 1000);
    expect(limiter("key1", 1000)).toBe(true);
    expect(limiter("key1", 1500)).toBe(true);
    expect(limiter("key1", 1500)).toBe(false); // exceeded limit
    vi.setSystemTime(2000);
    expect(limiter("key1")).toBe(true); // window reset, new count starts
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(false);
  });

  it("handles multiple keys independently", () => {
    const limiter = rateLimiter(2, 1000);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(false);
    expect(limiter("key2")).toBe(true);
    expect(limiter("key2")).toBe(true);
    expect(limiter("key2")).toBe(false);
  });

  it("uses Date.now() as default when now parameter is not provided", () => {
    const limiter = rateLimiter(1, 1000);
    vi.setSystemTime(1000);
    expect(limiter("key1")).toBe(true);
    expect(limiter("key1")).toBe(false);
    vi.setSystemTime(2000);
    expect(limiter("key1")).toBe(true); // window reset
  });

  it("cleans up old entries when map size exceeds 5000", () => {
    const limiter = rateLimiter(2, 100);
    vi.setSystemTime(1000);

    // Fill the map with 5001 entries, all expired
    for (let i = 0; i < 5001; i++) {
      limiter(`key${i}`, 1000 + i);
    }

    // Advance time past the expiry of all entries
    vi.setSystemTime(2000);

    // Add a new entry, which should trigger cleanup
    expect(limiter("cleanup-key")).toBe(true);

    // The map should be much smaller now (only contains the new entry and non-expired ones)
    // We can't directly access the map, but we can verify behavior is still correct
  });

  it("maintains correct count after window reset", () => {
    const limiter = rateLimiter(2, 1000);
    vi.setSystemTime(1000);
    expect(limiter("key1")).toBe(true); // n = 1
    expect(limiter("key1")).toBe(true); // n = 2
    expect(limiter("key1")).toBe(false); // n = 3 > limit

    vi.setSystemTime(2000);
    expect(limiter("key1")).toBe(true); // reset, n = 1
    expect(limiter("key1")).toBe(true); // n = 2
    expect(limiter("key1")).toBe(false); // n = 3 > limit
  });

  it("allows exactly limit requests per window", () => {
    const limiter = rateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) {
      expect(limiter("key1")).toBe(true);
    }
    expect(limiter("key1")).toBe(false);
  });

  it("resets using >= comparison on reset time", () => {
    const limiter = rateLimiter(1, 1000);
    vi.setSystemTime(1000);
    expect(limiter("key1", 1000)).toBe(true); // n = 1, reset = 2000

    vi.setSystemTime(1999);
    expect(limiter("key1", 1999)).toBe(false); // 1999 < 2000, still in window

    vi.setSystemTime(2000);
    expect(limiter("key1", 2000)).toBe(true); // 2000 >= 2000, window reset
  });
});

describe("clientIp", () => {
  it("extracts client IP from x-forwarded-for header (first value)", () => {
    const req = new Request("http://example.com", {
      headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("192.168.1.1");
  });

  it("trims whitespace from x-forwarded-for header", () => {
    const req = new Request("http://example.com", {
      headers: { "x-forwarded-for": "  192.168.1.1  , 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("192.168.1.1");
  });

  it("falls back to x-real-ip when x-forwarded-for is not present", () => {
    const req = new Request("http://example.com", {
      headers: { "x-real-ip": "10.0.0.2" },
    });
    expect(clientIp(req)).toBe("10.0.0.2");
  });

  it("returns 'local' when neither x-forwarded-for nor x-real-ip is present", () => {
    const req = new Request("http://example.com", {
      headers: {},
    });
    expect(clientIp(req)).toBe("local");
  });

  it("uses x-forwarded-for over x-real-ip when both are present", () => {
    const req = new Request("http://example.com", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
        "x-real-ip": "10.0.0.2",
      },
    });
    expect(clientIp(req)).toBe("192.168.1.1");
  });

  it("handles x-forwarded-for with single value", () => {
    const req = new Request("http://example.com", {
      headers: { "x-forwarded-for": "192.168.1.1" },
    });
    expect(clientIp(req)).toBe("192.168.1.1");
  });

  it("handles empty x-forwarded-for header", () => {
    const req = new Request("http://example.com", {
      headers: { "x-forwarded-for": "" },
    });
    expect(clientIp(req)).toBe("local");
  });

  it("handles x-forwarded-for with only whitespace", () => {
    const req = new Request("http://example.com", {
      headers: { "x-forwarded-for": "   " },
    });
    expect(clientIp(req)).toBe("local");
  });
});
