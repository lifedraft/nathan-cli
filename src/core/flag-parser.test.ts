import { describe, test, expect } from "bun:test";
import { parseFlags, parseFlagsAsStrings } from "./flag-parser.js";

describe("parseFlags", () => {
  test("parses --key=value pairs", () => {
    const result = parseFlags(["--name=hello", "--count=42"]);
    expect(result).toEqual({ name: "hello", count: 42 });
  });

  test("parses --key value pairs", () => {
    const result = parseFlags(["--name", "hello", "--count", "42"]);
    expect(result).toEqual({ name: "hello", count: 42 });
  });

  test("parses bare flags as true", () => {
    const result = parseFlags(["--verbose", "--dry-run"]);
    expect(result).toEqual({ verbose: true, "dry-run": true });
  });

  test("coerces booleans", () => {
    const result = parseFlags(["--flag=true", "--other=false"]);
    expect(result).toEqual({ flag: true, other: false });
  });

  test("coerces strictly decimal numbers only", () => {
    const result = parseFlags(["--port=8080", "--ratio=3.14"]);
    expect(result).toEqual({ port: 8080, ratio: 3.14 });
  });

  test("does NOT coerce hex strings to numbers", () => {
    const result = parseFlags(["--id=0x1F"]);
    expect(result).toEqual({ id: "0x1F" });
  });

  test("does NOT coerce Infinity", () => {
    const result = parseFlags(["--val=Infinity"]);
    expect(result).toEqual({ val: "Infinity" });
  });

  test("preserves strings that look like tokens", () => {
    const result = parseFlags(["--token=ghp_abc123XYZ"]);
    expect(result).toEqual({ token: "ghp_abc123XYZ" });
  });

  test("handles empty args", () => {
    expect(parseFlags([])).toEqual({});
  });

  test("ignores non-flag args", () => {
    const result = parseFlags(["positional", "--flag=val", "another"]);
    expect(result).toEqual({ flag: "val" });
  });
});

describe("parseFlagsAsStrings", () => {
  test("returns all values as strings", () => {
    const result = parseFlagsAsStrings(["--port=8080", "--flag=true", "--token=ghp_xxx"]);
    expect(result).toEqual({ port: "8080", flag: "true", token: "ghp_xxx" });
  });

  test("handles --key value pairs", () => {
    const result = parseFlagsAsStrings(["--name", "hello"]);
    expect(result).toEqual({ name: "hello" });
  });

  test("handles empty args", () => {
    expect(parseFlagsAsStrings([])).toEqual({});
  });
});
