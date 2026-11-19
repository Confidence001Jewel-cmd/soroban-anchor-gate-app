/**
 * Exact decimal conversion helpers for Stellar and Soroban token amounts.
 *
 * Stellar assets use fixed-point decimal representations while Soroban
 * contracts store token quantities as scaled integers (`i128`). Converting
 * between the two using JavaScript `number` arithmetic can silently lose
 * precision, so every operation in this module is performed with `bigint`
 * and decimal-string parsing.
 *
 * @packageDocumentation
 */

/**
 * Default number of decimal places used by Stellar token amounts.
 *
 * A single stroop is `10^-7` of the base unit, so one whole token equals
 * `10_000_000` stroops.
 */
export const DEFAULT_TOKEN_DECIMALS = 7;

/**
 * Maximum number of decimal places accepted by {@link toStroops} and
 * {@link fromStroops}.
 *
 * The limit keeps exponentiation bounded while remaining far above the
 * precision used by Stellar assets or common anchored fiat currencies.
 */
export const MAX_TOKEN_DECIMALS = 255;

/**
 * Maximum absolute decimal exponent accepted when parsing scientific notation.
 *
 * JavaScript renders very small or very large numbers using exponent notation
 * (for example `1e-7`). Supporting it is useful, but unbounded exponents could
 * force the allocation of enormous integers, so inputs are capped.
 */
const MAX_DECIMAL_EXPONENT = 10_000;

/**
 * Maximum length of a decimal input string.
 *
 * This guards against pathological inputs while comfortably exceeding the
 * 39-digit range of a signed 128-bit integer plus decimal places.
 */
const MAX_DECIMAL_INPUT_LENGTH = 4_096;

const DECIMAL_PATTERN =
  /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

function assertValidDecimals(decimals: number): void {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_TOKEN_DECIMALS
  ) {
    throw new Error(
      `decimals must be an integer between 0 and ${MAX_TOKEN_DECIMALS}`
    );
  }
}

/**
 * Converts a human-readable token amount into its scaled integer
 * representation.
 *
 * The conversion is exact: the input is parsed as a decimal string and scaled
 * with `bigint` arithmetic, never through binary floating-point math. Strings
 * are the safest input for large values or values with many decimal places.
 * Numbers are accepted for convenience, but integers outside
 * `Number.MAX_SAFE_INTEGER` and values with excessively large scientific
 * notation exponents are rejected to avoid silent precision loss.
 *
 * Fractional digits beyond `decimals` are allowed only when they are trailing
 * zeroes. Any value that cannot be represented without losing precision (a
 * sub-stroop amount) throws an error.
 *
 * @param amount - Non-negative decimal amount, such as `"10.50"`, `10.5`, or
 *   `"10500000"`.
 * @param decimals - Number of decimal places used by the token. Defaults to
 *   {@link DEFAULT_TOKEN_DECIMALS} (`7`).
 * @returns The amount scaled by `10^decimals` as a `bigint`.
 * @throws {Error} If the amount is negative, malformed, not finite, or has
 *   non-zero precision below the requested number of decimal places.
 * @throws {Error} If `decimals` is not an integer between `0` and
 *   {@link MAX_TOKEN_DECIMALS}.
 *
 * @example
 * ```ts
 * toStroops("10.50"); // 105_000_000n
 * toStroops(10.5, 7); // 105_000_000n
 * toStroops("0.0000001"); // 1n
 * toStroops("1.2345678", 7); // 12_345_678n
 * ```
 */
export function toStroops(
  amount: string | number,
  decimals: number = DEFAULT_TOKEN_DECIMALS
): bigint {
  assertValidDecimals(decimals);

  let text: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new Error(`Token amount must be a finite number: ${amount}`);
    }
    if (Number.isInteger(amount) && !Number.isSafeInteger(amount)) {
      throw new Error(
        "Unsafe integer token amount; pass large values as strings to preserve precision"
      );
    }
    text = String(amount).trim();
  } else if (typeof amount === "string") {
    text = amount.trim();
  } else {
    throw new Error("Token amount must be a string or number");
  }

  if (text === "") {
    throw new Error("Invalid token amount: amount cannot be empty");
  }
  if (text.length > MAX_DECIMAL_INPUT_LENGTH) {
    throw new Error("Token amount is too long to convert safely");
  }

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new Error(`Invalid token amount: ${amount}`);
  }

  const sign = match[1];
  const integerDigits = match[2] ?? "0";
  const fractionalDigits = match[3] ?? match[4] ?? "";
  const exponent = match[5] === undefined ? 0 : Number(match[5]);

  if (
    !Number.isSafeInteger(exponent) ||
    Math.abs(exponent) > MAX_DECIMAL_EXPONENT
  ) {
    throw new Error(`Token amount exponent is out of range: ${match[5]}`);
  }

  const coefficient = BigInt(integerDigits + fractionalDigits);
  if (sign === "-" && coefficient !== 0n) {
    throw new Error("Token amount cannot be negative");
  }
  if (coefficient === 0n) {
    return 0n;
  }

  const scale = fractionalDigits.length - exponent;
  if (scale <= decimals) {
    return coefficient * 10n ** BigInt(decimals - scale);
  }

  const excessPlaces = scale - decimals;
  if (excessPlaces > MAX_DECIMAL_INPUT_LENGTH + MAX_DECIMAL_EXPONENT) {
    throw new Error("Token amount exponent is out of range");
  }
  const divisor = 10n ** BigInt(excessPlaces);
  if (coefficient % divisor !== 0n) {
    throw new Error(
      `Token amount has more than ${decimals} decimal places (sub-stroop precision)`
    );
  }
  return coefficient / divisor;
}

/**
 * Formats a scaled integer token amount as an exact, human-readable decimal
 * string.
 *
 * Trailing fractional zeroes are removed, so `10_500_000n` becomes `"10.5"` at
 * the default seven decimal places. The output can be passed back to
 * {@link toStroops} without losing precision.
 *
 * @param amount - Non-negative scaled integer amount, typically a Soroban
 *   `i128` value or a stroop count.
 * @param decimals - Number of decimal places used by the token. Defaults to
 *   {@link DEFAULT_TOKEN_DECIMALS} (`7`).
 * @returns The decimal string representation of `amount`.
 * @throws {Error} If `amount` is not a `bigint`, is negative, or if `decimals`
 *   is not an integer between `0` and {@link MAX_TOKEN_DECIMALS}.
 *
 * @example
 * ```ts
 * fromStroops(105_000_000n); // "10.5"
 * fromStroops(1n); // "0.0000001"
 * fromStroops(1_050n, 2); // "10.5"
 * ```
 */
export function fromStroops(
  amount: bigint,
  decimals: number = DEFAULT_TOKEN_DECIMALS
): string {
  if (typeof amount !== "bigint") {
    throw new Error("Scaled token amount must be a bigint");
  }
  if (amount < 0n) {
    throw new Error("Scaled token amount cannot be negative");
  }
  assertValidDecimals(decimals);

  const digits = amount.toString().padStart(decimals + 1, "0");
  const integerPart = digits.slice(0, digits.length - decimals);
  const fractionalPart = digits
    .slice(digits.length - decimals)
    .replace(/0+$/, "");

  return fractionalPart === ""
    ? integerPart
    : `${integerPart}.${fractionalPart}`;
}
