import { test, describe, mock } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  BPS_DIVISOR,
  QUOTE_EXPIRY_WARNING_THRESHOLD_SEC,
  QUOTE_SAFETY_MARGIN_SEC,
  MAX_SAFE_DEPOSIT_TOKENS,
  DEMO_ANCHOR_PLACEHOLDER_RATES,
  getAssetDecimals,
  formatMinorUnits,
  parseAndValidateTokenAmount,
  calculatePlatformFee,
  calculateClockSkewMs,
  getQuoteRemainingSeconds,
  getQuoteExpiryDetails,
  validateAnchorQuoteResponse,
  computeRateBreakdown,
  QuoteSequenceController,
  createDefaultQuoteFetcher,
  Sep38Quote,
} from "./rate-calculator";

describe("Rate Calculator - Money Math & Platform Fee Calculations", () => {
  test("exports protocol constants matching contract specifications", () => {
    assert.strictEqual(DEFAULT_PLATFORM_FEE_BPS, 200);
    assert.strictEqual(BPS_DIVISOR, 10_000n);
    assert.strictEqual(QUOTE_EXPIRY_WARNING_THRESHOLD_SEC, 30);
    assert.strictEqual(QUOTE_SAFETY_MARGIN_SEC, 5);
  });

  test("calculates platform fee using truncating integer floor matching contracts/src/lib.rs", () => {
    // 100 USDC (100_0000000 stroops) at 200 BPS (2.0%) = 2_0000000 stroops fee
    const gross = 100_0000000n;
    const { platformFeeMinor, amountSentToAnchorMinor } = calculatePlatformFee(gross, 200);
    assert.strictEqual(platformFeeMinor, 2_0000000n);
    assert.strictEqual(amountSentToAnchorMinor, 98_0000000n);
    assert.strictEqual(gross, platformFeeMinor + amountSentToAnchorMinor);
  });

  test("mirrors boundary test in contracts/src/test.rs (9,999 stroops at 1000 BPS)", () => {
    // contracts/src/test.rs#L440: 9,999 stroops at 1000 bps = 999 fee, 9,000 remainder
    const { platformFeeMinor, amountSentToAnchorMinor } = calculatePlatformFee(9_999n, 1000);
    assert.strictEqual(platformFeeMinor, 999n);
    assert.strictEqual(amountSentToAnchorMinor, 9_000n);
  });

  test("truncates towards zero for odd division without rounding up", () => {
    // 1001 stroops at 200 BPS: 1001 * 200 / 10000 = 200200 / 10000 = 20 (truncated)
    const { platformFeeMinor, amountSentToAnchorMinor } = calculatePlatformFee(1001n, 200);
    assert.strictEqual(platformFeeMinor, 20n);
    assert.strictEqual(amountSentToAnchorMinor, 981n);
  });

  test("supports zero fee BPS and rejects out-of-range fee BPS", () => {
    const { platformFeeMinor, amountSentToAnchorMinor } = calculatePlatformFee(500n, 0);
    assert.strictEqual(platformFeeMinor, 0n);
    assert.strictEqual(amountSentToAnchorMinor, 500n);

    assert.throws(() => calculatePlatformFee(500n, -1), /feeBps must be between 0 and 1000/);
    assert.throws(() => calculatePlatformFee(500n, 1001), /feeBps must be between 0 and 1000/);
  });
});

describe("Rate Calculator - Money Flow & SEP-38 Semantics", () => {
  const baseQuote: Sep38Quote = {
    id: "quote-123",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    price: "0.9950",
    total_price: "1.0000",
    sell_asset: "stellar:USDC",
    sell_amount: "98.0000000",
    buy_asset: "iso4217:USD",
    buy_amount: "97.50",
    fee: {
      total: "0.50",
      asset: "iso4217:USD",
    },
    isFallbackDemo: false,
  };

  test("does not subtract anchor fee twice (buy_amount is already net of anchor fees)", () => {
    const breakdown = computeRateBreakdown({
      grossTokens: "100.0000000",
      grossDecimals: 7,
      quote: baseQuote,
      platformFeeBps: 200,
    });

    assert.strictEqual(breakdown.grossTokens, "100.0000000");
    assert.strictEqual(breakdown.platformFeeTokens, "2.0000000");
    assert.strictEqual(breakdown.amountSentToAnchorTokens, "98.0000000");
    assert.strictEqual(breakdown.anchorFeeFormatted, "0.50");
    assert.strictEqual(breakdown.anchorFeeAsset, "iso4217:USD");
    assert.strictEqual(breakdown.guaranteedPayoutFiat, "97.50"); // Exact quote.buy_amount, not 97.00
    assert.strictEqual(breakdown.totalPrice, "1.0000");
    assert.strictEqual(breakdown.isFallbackDemo, false);
  });

  test("handles fee denominated in sell_asset without altering buy_amount", () => {
    const quoteWithTokenFee: Sep38Quote = {
      ...baseQuote,
      fee: {
        total: "0.5000000",
        asset: "stellar:USDC",
      },
    };

    const breakdown = computeRateBreakdown({
      grossTokens: "100.0000000",
      grossDecimals: 7,
      quote: quoteWithTokenFee,
    });

    assert.strictEqual(breakdown.anchorFeeFormatted, "0.5000000");
    assert.strictEqual(breakdown.anchorFeeAsset, "stellar:USDC");
    assert.strictEqual(breakdown.guaranteedPayoutFiat, "97.50");
  });
});

describe("Rate Calculator - Precision & Currency Decimals", () => {
  test("resolves decimals via SEP-38 significant_decimals if provided", () => {
    const infoMap = new Map([
      ["iso4217:USD", { asset: "iso4217:USD", significant_decimals: 4 }],
      ["stellar:USDC", { asset: "stellar:USDC", significant_decimals: 6 }],
    ]);

    assert.strictEqual(getAssetDecimals("iso4217:USD", infoMap), 4);
    assert.strictEqual(getAssetDecimals("stellar:USDC", infoMap), 6);
  });

  test("falls back to standard precision when not in infoMap", () => {
    assert.strictEqual(getAssetDecimals("stellar:native"), 7);
    assert.strictEqual(getAssetDecimals("CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT"), 7);
    assert.strictEqual(getAssetDecimals("iso4217:JPY"), 0);
    assert.strictEqual(getAssetDecimals("JPY"), 0);
    assert.strictEqual(getAssetDecimals("iso4217:EUR"), 2);
    assert.strictEqual(getAssetDecimals("USD"), 2);
  });

  test("formats minor units accurately without floats", () => {
    assert.strictEqual(formatMinorUnits(123456789n, 7), "12.3456789");
    assert.strictEqual(formatMinorUnits(100n, 2), "1.00");
    assert.strictEqual(formatMinorUnits(50n, 2), "0.50");
    assert.strictEqual(formatMinorUnits(5n, 2), "0.05");
    assert.strictEqual(formatMinorUnits(500n, 0), "500");
  });
});

describe("Rate Calculator - Input Validation & Edge Cases", () => {
  test("rejects empty, whitespace, and NaN inputs", () => {
    assert.throws(() => parseAndValidateTokenAmount("", 7), /Amount is required/);
    assert.throws(() => parseAndValidateTokenAmount("   ", 7), /Amount is required/);
    assert.throws(() => parseAndValidateTokenAmount("abc", 7), /Invalid numerical amount/);
    assert.throws(() => parseAndValidateTokenAmount("1.2.3", 7), /Invalid numerical amount/);
  });

  test("rejects zero and negative values", () => {
    assert.throws(() => parseAndValidateTokenAmount("0", 7), /Amount must be greater than zero/);
    assert.throws(() => parseAndValidateTokenAmount("0.0000000", 7), /Amount must be greater than zero/);
    assert.throws(() => parseAndValidateTokenAmount("-5", 7), /Amount must be greater than zero/);
  });

  test("accepts amount strings with trailing zeros beyond asset decimals", () => {
    // 7 decimals asset: 10.123456700 has 9 decimal places, but extra digits are all '0'
    const minor = parseAndValidateTokenAmount("10.123456700", 7);
    assert.strictEqual(minor, 10_1234567n);
  });

  test("rejects amount strings with non-zero extra digits beyond asset decimals", () => {
    // 7 decimals asset: 10.123456701 has non-zero 9th decimal digit
    assert.throws(
      () => parseAndValidateTokenAmount("10.123456701", 7),
      /Amount exceeds maximum precision of 7 decimals/
    );
    // 2 decimals fiat: 10.555 has non-zero 3rd decimal digit
    assert.throws(
      () => parseAndValidateTokenAmount("10.555", 2),
      /Amount exceeds maximum precision of 2 decimals/
    );
  });

  test("rejects absurdly large amounts exceeding 1 billion tokens", () => {
    const huge = (MAX_SAFE_DEPOSIT_TOKENS + 1n).toString();
    assert.throws(() => parseAndValidateTokenAmount(huge, 7), /maximum supported limit/);
  });
});

describe("Rate Calculator - Anchor Response Validation", () => {
  const validResponse = {
    id: "q-1",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    price: "0.9950",
    total_price: "1.0000",
    sell_asset: "stellar:USDC",
    sell_amount: "98.0000000",
    buy_asset: "iso4217:USD",
    buy_amount: "97.50",
    fee: { total: "0.50", asset: "iso4217:USD" },
  };

  const expectedReq = {
    sell_asset: "stellar:USDC",
    buy_asset: "iso4217:USD",
    expectedSellAmount: "98.0000000",
    sellDecimals: 7,
    buyDecimals: 2,
  };

  test("accepts valid anchor quote response", () => {
    const quote = validateAnchorQuoteResponse(validResponse, expectedReq);
    assert.strictEqual(quote.id, "q-1");
    assert.strictEqual(quote.buy_amount, "97.50");
  });

  test("rejects non-object or missing id", () => {
    assert.throws(() => validateAnchorQuoteResponse(null, expectedReq), /expected JSON object/);
    assert.throws(() => validateAnchorQuoteResponse({ ...validResponse, id: "" }, expectedReq), /missing quote id/);
  });

  test("rejects mismatched sell_asset or buy_asset", () => {
    assert.throws(
      () => validateAnchorQuoteResponse({ ...validResponse, sell_asset: "stellar:XLM" }, expectedReq),
      /sell_asset .* does not match requested/
    );
    assert.throws(
      () => validateAnchorQuoteResponse({ ...validResponse, buy_asset: "iso4217:EUR" }, expectedReq),
      /buy_asset .* does not match requested/
    );
  });

  test("rejects sell_amount that does not equal requested amountSentToAnchor", () => {
    assert.throws(
      () => validateAnchorQuoteResponse({ ...validResponse, sell_amount: "99.0000000" }, expectedReq),
      /sell_amount .* does not match required anchor disbursement/
    );
  });

  test("rejects non-positive buy_amount", () => {
    assert.throws(
      () => validateAnchorQuoteResponse({ ...validResponse, buy_amount: "0.00" }, expectedReq),
      /buy_amount must be a positive amount string/
    );
  });

  test("rejects invalid or past expires_at date", () => {
    assert.throws(
      () => validateAnchorQuoteResponse({ ...validResponse, expires_at: "not-a-date" }, expectedReq),
      /expires_at is not a valid date string/
    );
    const past = new Date(Date.now() - 10_000).toISOString();
    assert.throws(
      () => validateAnchorQuoteResponse({ ...validResponse, expires_at: past }, expectedReq),
      /expires_at must be a valid future timestamp/
    );
  });
});

describe("Rate Calculator - Expiry Warning, Safety Margin & Clock Skew", () => {
  test("calculates clock skew and falls back to 0 on missing/invalid Date header", () => {
    const now = 1700000000000;
    const serverHeader = new Date(now + 2000).toUTCString();
    assert.strictEqual(calculateClockSkewMs(serverHeader, now), 2000);

    // Fallback path
    assert.strictEqual(calculateClockSkewMs(undefined, now), 0);
    assert.strictEqual(calculateClockSkewMs(null, now), 0);
    assert.strictEqual(calculateClockSkewMs("invalid", now), 0);
  });

  test("evaluates three distinct UI states based on remaining time", () => {
    // 1. Expiring soon (5s < remaining <= 30s)
    const soon = getQuoteExpiryDetails(20);
    assert.strictEqual(soon.status, "expiring_soon");
    assert.strictEqual(soon.isConfirmable, true);
    assert.match(soon.message, /Quote expiring in 20s/);

    // 2. Too close to confirm (0s < remaining <= 5s)
    const tooClose = getQuoteExpiryDetails(4);
    assert.strictEqual(tooClose.status, "too_close_to_confirm");
    assert.strictEqual(tooClose.isConfirmable, false);
    assert.match(tooClose.message, /Quote too close to expiry to confirm deposit safely/);

    // 3. Expired (remaining <= 0s)
    const expired = getQuoteExpiryDetails(0);
    assert.strictEqual(expired.status, "expired");
    assert.strictEqual(expired.isConfirmable, false);
    assert.match(expired.message, /Quote has expired/);

    // 4. Normal active (> 30s)
    const active = getQuoteExpiryDetails(45);
    assert.strictEqual(active.status, "active");
    assert.strictEqual(active.isConfirmable, true);
  });

  test("uses fake timers to advance time through all expiry states", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      const startTime = 1700000000000;
      mock.timers.setTime(startTime);

      const expiresAtIso = new Date(startTime + 40_000).toISOString();

      // At t=0 (40s remaining) -> active
      let rem = getQuoteRemainingSeconds(expiresAtIso, Date.now());
      assert.strictEqual(getQuoteExpiryDetails(rem).status, "active");

      // Advance by 15s (25s remaining) -> expiring_soon
      mock.timers.tick(15_000);
      rem = getQuoteRemainingSeconds(expiresAtIso, Date.now());
      assert.strictEqual(getQuoteExpiryDetails(rem).status, "expiring_soon");

      // Advance by 21s (4s remaining) -> too_close_to_confirm
      mock.timers.tick(21_000);
      rem = getQuoteRemainingSeconds(expiresAtIso, Date.now());
      assert.strictEqual(getQuoteExpiryDetails(rem).status, "too_close_to_confirm");

      // Advance by 5s (-1s remaining) -> expired
      mock.timers.tick(5_000);
      rem = getQuoteRemainingSeconds(expiresAtIso, Date.now());
      assert.strictEqual(getQuoteExpiryDetails(rem).status, "expired");
    } finally {
      mock.timers.reset();
    }
  });
});

describe("Rate Calculator - Request Sequencing & Race Conditions", () => {
  test("aborts prior request when new request begins and drops outdated responses", () => {
    const controller = new QuoteSequenceController();

    const req1 = controller.startRequest();
    assert.strictEqual(req1.requestId, 1);
    assert.strictEqual(req1.signal.aborted, false);
    assert.strictEqual(controller.isLatest(req1.requestId), true);

    const req2 = controller.startRequest();
    assert.strictEqual(req2.requestId, 2);
    assert.strictEqual(req1.signal.aborted, true); // req1 aborted!
    assert.strictEqual(req2.signal.aborted, false);

    // Older request is no longer latest
    assert.strictEqual(controller.isLatest(req1.requestId), false);
    assert.strictEqual(controller.isLatest(req2.requestId), true);

    controller.cancelActive();
    assert.strictEqual(req2.signal.aborted, true);
  });
});

describe("Rate Calculator - Default & Fallback Quote Fetcher", () => {
  test("generates fallback quote marked as demo when no anchor URL is configured", async () => {
    const fetcher = createDefaultQuoteFetcher();
    const quote = await fetcher({
      sell_asset: "stellar:USDC",
      buy_asset: "iso4217:USD",
      sell_amount: "98.0000000",
    });

    assert.strictEqual(quote.isFallbackDemo, true);
    assert.strictEqual(quote.sell_amount, "98.0000000");
    assert.strictEqual(quote.buy_asset, "iso4217:USD");
    assert.ok(quote.buy_amount.length > 0);
    assert.strictEqual(quote.total_price, DEMO_ANCHOR_PLACEHOLDER_RATES.USD.total_price);
  });

  test("rejects non-https anchorBaseUrl", async () => {
    const fetcher = createDefaultQuoteFetcher("http://insecure-anchor.com");
    await assert.rejects(
      async () =>
        fetcher({
          sell_asset: "stellar:USDC",
          buy_asset: "iso4217:USD",
          sell_amount: "98.0000000",
        }),
      /Anchor quote URL must use https:\/\//
    );
  });
});
