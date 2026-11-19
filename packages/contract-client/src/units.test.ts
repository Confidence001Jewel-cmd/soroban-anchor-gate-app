import assert from "node:assert";
import { test, describe } from "node:test";
import {
  DEFAULT_TOKEN_DECIMALS,
  MAX_TOKEN_DECIMALS,
  fromStroops,
  toStroops,
} from "./units";

describe("toStroops", () => {
  test("uses seven decimal places by default", () => {
    assert.strictEqual(DEFAULT_TOKEN_DECIMALS, 7);
    assert.strictEqual(toStroops("10.50"), 105_000_000n);
    assert.strictEqual(toStroops(10.5), 105_000_000n);
    assert.strictEqual(toStroops("1"), 10_000_000n);
    assert.strictEqual(toStroops("0"), 0n);
    assert.strictEqual(toStroops("0.0000001"), 1n);
    assert.strictEqual(toStroops("0.00000010"), 1n);
    assert.strictEqual(toStroops("1.23000000"), 12_300_000n);
  });

  test("supports custom decimal places", () => {
    assert.strictEqual(toStroops("10.50", 2), 1_050n);
    assert.strictEqual(toStroops("10", 0), 10n);
    assert.strictEqual(toStroops("10.0", 0), 10n);
    assert.throws(() => toStroops("10.5", 0), /sub-stroop/);
    assert.strictEqual(toStroops("1.234567890123456789", 18), 1_234_567_890_123_456_789n);
    assert.strictEqual(toStroops("1", MAX_TOKEN_DECIMALS), 10n ** 255n);
  });

  test("parses scientific notation emitted by JavaScript numbers", () => {
    assert.strictEqual(toStroops(1e-7), 1n);
    assert.strictEqual(toStroops("1e-7"), 1n);
    assert.strictEqual(toStroops("1.5e-6"), 15n);
    assert.strictEqual(toStroops("1.23e2"), 1_230_000_000n);
    assert.strictEqual(toStroops("123e-6"), 1_230n);
  });

  test("rejects sub-stroop precision and malformed amounts", () => {
    assert.throws(() => toStroops("0.00000001"), /sub-stroop/);
    assert.throws(() => toStroops("1.23456789"), /sub-stroop/);
    assert.throws(() => toStroops(0.00000001), /sub-stroop/);
    assert.throws(() => toStroops("1.5e-7"), /sub-stroop/);

    for (const invalid of ["", " ", "abc", "1.2.3", ".", "1e", "1e+", "0x10", "1,000", "--1"]) {
      assert.throws(() => toStroops(invalid), /Invalid token amount/);
    }
    assert.throws(() => toStroops("-1"), /negative/);
    assert.throws(() => toStroops(-1), /negative/);
    assert.throws(() => toStroops("-0.0000001"), /negative/);
  });

  test("rejects non-finite and unsafe numeric inputs", () => {
    assert.throws(() => toStroops(Number.NaN), /finite/);
    assert.throws(() => toStroops(Number.POSITIVE_INFINITY), /finite/);
    assert.throws(() => toStroops(Number.NEGATIVE_INFINITY), /finite/);
    assert.throws(() => toStroops(Number.MAX_SAFE_INTEGER + 1), /Unsafe integer/);
    assert.throws(() => toStroops("1e10001"), /exponent/);
  });

  test("rejects invalid decimal settings", () => {
    assert.throws(() => toStroops("1", -1), /decimals/);
    assert.throws(() => toStroops("1", 1.5), /decimals/);
    assert.throws(() => toStroops("1", MAX_TOKEN_DECIMALS + 1), /decimals/);
  });

  test("converts extreme values without precision loss", () => {
    const maxI128 = 170_141_183_460_469_231_731_687_303_715_884_105_727n;
    assert.strictEqual(toStroops(maxI128.toString()), maxI128 * 10_000_000n);

    const mixed = "123456789012345678901234567890.1234567";
    assert.strictEqual(
      toStroops(mixed),
      1_234_567_890_123_456_789_012_345_678_901_234_567n
    );
    assert.strictEqual(toStroops("000000000000000000000000000000001"), 10_000_000n);
  });
});

describe("fromStroops", () => {
  test("formats scaled integers with trailing zeroes removed", () => {
    assert.strictEqual(fromStroops(0n), "0");
    assert.strictEqual(fromStroops(1n), "0.0000001");
    assert.strictEqual(fromStroops(10n), "0.000001");
    assert.strictEqual(fromStroops(10_000_000n), "1");
    assert.strictEqual(fromStroops(105_000_000n), "10.5");
    assert.strictEqual(fromStroops(12_345_678n), "1.2345678");
    assert.strictEqual(fromStroops(10_000_001n), "1.0000001");
  });

  test("supports custom decimal places", () => {
    assert.strictEqual(fromStroops(1_050n, 2), "10.5");
    assert.strictEqual(fromStroops(42n, 0), "42");
    assert.strictEqual(fromStroops(1n, 18), "0.000000000000000001");
    assert.strictEqual(fromStroops(10n ** 255n, MAX_TOKEN_DECIMALS), "1");
  });

  test("round-trips extreme values exactly", () => {
    const vectors = [
      0n,
      1n,
      9n,
      10n,
      99_999_999n,
      100_000_001n,
      170_141_183_460_469_231_731_687_303_715_884_105_727n,
      10n ** 200n + 123_456_789n,
    ];
    for (const value of vectors) {
      assert.strictEqual(toStroops(fromStroops(value)), value);
    }
  });

  test("rejects negative or non-bigint values and invalid decimals", () => {
    assert.throws(() => fromStroops(-1n), /negative/);
    assert.throws(() => fromStroops(1 as never), /bigint/);
    assert.throws(() => fromStroops(1n, -1), /decimals/);
    assert.throws(() => fromStroops(1n, 1.5), /decimals/);
    assert.throws(() => fromStroops(1n, MAX_TOKEN_DECIMALS + 1), /decimals/);
  });
});
