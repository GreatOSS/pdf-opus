import { describe, expect, it } from "vitest";
import { crc32, zip } from "../src/images";

describe("zip", () => {
  it("computes standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("writes local headers, a central directory and an end record", () => {
    const out = zip([{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "b – page 2.png", data: new Uint8Array([1, 2, 3]) }]);
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = out.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    expect(dv.getUint32(dv.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });
});
