/**
 * Unit tests for cli/src/commands/generate.ts — parseAndValidateLine()
 *
 * Covers:
 *   - Happy-path parsing of valid CSV lines
 *   - Address validation (empty, invalid strkey)
 *   - Amount validation:
 *       - empty / whitespace-only
 *       - non-numeric characters (rejects before BigInt)
 *       - zero and negative values
 *       - values at or above 2^127 (max i128)
 *       - values at 2^127 - 1 (boundary — must pass)
 *   - Line-length limit (> 200 chars rejected)
 *
 * Relates to Issue #99.
 */

import { describe, it, expect } from "vitest";
import { parseAndValidateLine, MAX_LINE_LENGTH, MAX_AMOUNT } from "./generate.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Valid G... Ed25519 account key used in happy-path tests.
 * Derived from Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)) for
 * determinism — verified valid by StrKey.isValidEd25519PublicKey().
 */
const VALID_ADDR = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";

/**
 * Valid G... Ed25519 account key (second fixture).
 * Derived from Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).
 */
const VALID_ADDR2 = "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U";

/** Valid C... contract address used in happy-path tests. */
const VALID_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

/** Build a CSV line that is exactly `len` characters long. */
function lineOfLength(len: number): string {
  // address,<padding to reach target length>
  const prefix = `${VALID_ADDR},100`;
  if (len <= prefix.length) return prefix.slice(0, len);
  return prefix + "x".repeat(len - prefix.length);
}

// ─── Happy paths ──────────────────────────────────────────────────────────────

describe("parseAndValidateLine — valid input", () => {
  it("parses a basic address,amount line", () => {
    const entry = parseAndValidateLine(`${VALID_ADDR},1000`, 1);
    expect(entry.address).toBe(VALID_ADDR);
    expect(entry.amount).toBe(1000n);
  });

  it("trims surrounding whitespace from address and amount", () => {
    const entry = parseAndValidateLine(`  ${VALID_ADDR}  ,  500  `, 2);
    expect(entry.address).toBe(VALID_ADDR);
    expect(entry.amount).toBe(500n);
  });

  it("accepts a valid C... contract address", () => {
    const entry = parseAndValidateLine(`${VALID_CONTRACT},250`, 3);
    expect(entry.address).toBe(VALID_CONTRACT);
    expect(entry.amount).toBe(250n);
  });

  it("accepts amount equal to MAX_AMOUNT (2^127 - 1) — boundary", () => {
    const entry = parseAndValidateLine(`${VALID_ADDR},${MAX_AMOUNT}`, 4);
    expect(entry.amount).toBe(MAX_AMOUNT);
  });

  it("accepts a line exactly at MAX_LINE_LENGTH characters", () => {
    // Build a line that is exactly 200 chars with valid content
    const base = `${VALID_ADDR},1`;
    // Pad with extra digits on the amount side up to exactly 200 chars
    const padding = "0".repeat(MAX_LINE_LENGTH - base.length);
    const line = `${VALID_ADDR},1${padding}`;
    expect(line.length).toBe(MAX_LINE_LENGTH);
    // The amount here will be astronomically large — that's fine for the
    // length check; it will fail the MAX_AMOUNT check instead, which means
    // the length check itself did NOT fire.
    expect(() => parseAndValidateLine(line, 5)).toThrow(/exceeds the maximum/);
  });
});

// ─── Line-length limit ────────────────────────────────────────────────────────

describe("parseAndValidateLine — line length", () => {
  it("rejects a line longer than MAX_LINE_LENGTH", () => {
    const longLine = lineOfLength(MAX_LINE_LENGTH + 1);
    expect(longLine.length).toBeGreaterThan(MAX_LINE_LENGTH);
    expect(() => parseAndValidateLine(longLine, 1)).toThrow(
      `Line 1: line too long (${longLine.length} chars, max ${MAX_LINE_LENGTH})`
    );
  });

  it("includes the actual character count in the error message", () => {
    const longLine = lineOfLength(300);
    expect(() => parseAndValidateLine(longLine, 7)).toThrow(/300 chars/);
  });
});

// ─── Address validation ───────────────────────────────────────────────────────

describe("parseAndValidateLine — address validation", () => {
  it("rejects an empty address", () => {
    expect(() => parseAndValidateLine(",100", 1)).toThrow("Line 1: address is empty");
  });

  it("rejects a whitespace-only address", () => {
    expect(() => parseAndValidateLine("   ,100", 2)).toThrow("Line 2: address is empty");
  });

  it("rejects a truncated / malformed Stellar key", () => {
    expect(() => parseAndValidateLine("GABC123,100", 3)).toThrow(
      `Line 3: invalid Stellar address "GABC123"`
    );
  });

  it("rejects an arbitrary non-key string as the address", () => {
    expect(() => parseAndValidateLine("not-an-address,100", 4)).toThrow(
      "Line 4: invalid Stellar address"
    );
  });
});

// ─── Amount — empty / whitespace ─────────────────────────────────────────────

describe("parseAndValidateLine — amount empty", () => {
  it("rejects a missing amount field", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR}`, 1)).toThrow(
      "Line 1: amount is empty or whitespace-only"
    );
  });

  it("rejects an empty amount after the comma", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},`, 2)).toThrow(
      "Line 2: amount is empty or whitespace-only"
    );
  });

  it("rejects a whitespace-only amount", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},   `, 3)).toThrow(
      "Line 3: amount is empty or whitespace-only"
    );
  });
});

// ─── Amount — non-numeric ─────────────────────────────────────────────────────

describe("parseAndValidateLine — non-numeric amount (sanitization)", () => {
  it("rejects an amount with alphabetic characters", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},100abc`, 1)).toThrow(
      /Line 1: amount "100abc" is not a valid integer/
    );
  });

  it("rejects a floating-point amount", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},1.5`, 2)).toThrow(
      /not a valid integer/
    );
  });

  it("rejects an amount with a leading '+' sign", () => {
    // BigInt('+100') is valid JS, but we want strict digit-only input
    expect(() => parseAndValidateLine(`${VALID_ADDR},+100`, 3)).toThrow(
      /not a valid integer/
    );
  });

  it("rejects an amount with an exponent notation", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},1e10`, 4)).toThrow(
      /not a valid integer/
    );
  });

  it("rejects an amount with underscores (BigInt numeric separators)", () => {
    // BigInt('1_000') is valid JS but should not be accepted from CSV
    expect(() => parseAndValidateLine(`${VALID_ADDR},1_000`, 5)).toThrow(
      /not a valid integer/
    );
  });

  it("rejects a hex-prefixed amount", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},0xff`, 6)).toThrow(
      /not a valid integer/
    );
  });

  it("rejects an amount that is just a minus sign", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},-`, 7)).toThrow(
      /not a valid integer/
    );
  });
});

// ─── Amount — zero / negative ─────────────────────────────────────────────────

describe("parseAndValidateLine — amount range (zero / negative)", () => {
  it("rejects zero", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},0`, 1)).toThrow(
      'Line 1: amount must be greater than zero, got "0"'
    );
  });

  it("rejects a negative amount", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},-1`, 2)).toThrow(
      'Line 2: amount must be greater than zero, got "-1"'
    );
  });

  it("rejects a large negative amount", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},-99999`, 3)).toThrow(
      /amount must be greater than zero/
    );
  });
});

// ─── Amount — upper-bound (2^127) ─────────────────────────────────────────────

describe("parseAndValidateLine — amount upper bound (< 2^127)", () => {
  it("rejects an amount equal to 2^127", () => {
    const tooLarge = (2n ** 127n).toString();
    expect(() => parseAndValidateLine(`${VALID_ADDR},${tooLarge}`, 1)).toThrow(
      /exceeds the maximum allowed value/
    );
  });

  it("rejects an amount greater than 2^127", () => {
    const wayTooLarge = (2n ** 128n).toString();
    expect(() => parseAndValidateLine(`${VALID_ADDR},${wayTooLarge}`, 2)).toThrow(
      /exceeds the maximum allowed value/
    );
  });

  it("accepts an amount of exactly 2^127 - 1 (MAX_AMOUNT)", () => {
    const boundary = MAX_AMOUNT.toString();
    const entry = parseAndValidateLine(`${VALID_ADDR},${boundary}`, 3);
    expect(entry.amount).toBe(MAX_AMOUNT);
  });

  it("accepts an amount of 1 (minimum valid positive)", () => {
    const entry = parseAndValidateLine(`${VALID_ADDR},1`, 4);
    expect(entry.amount).toBe(1n);
  });
});

// ─── Error message includes line number ──────────────────────────────────────

describe("parseAndValidateLine — line number in error messages", () => {
  it("includes the correct line number for address errors", () => {
    expect(() => parseAndValidateLine(",500", 42)).toThrow(/Line 42/);
  });

  it("includes the correct line number for amount errors", () => {
    expect(() => parseAndValidateLine(`${VALID_ADDR},abc`, 99)).toThrow(/Line 99/);
  });

  it("includes the correct line number for length errors", () => {
    const long = lineOfLength(250);
    expect(() => parseAndValidateLine(long, 7)).toThrow(/Line 7/);
  });
});
