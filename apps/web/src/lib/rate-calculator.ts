import { parseTokenAmount } from "./crypto";

/**
 * Platform fee in basis points (200 BPS = 2.0%).
 * Configured during contract initialization; see contracts/src/lib.rs#L41 and contracts/src/lib.rs#L149-L160.
 * In the on-chain Soroban contract, fee_bps is configurable up to 1000 BPS (10%).
 */
export const DEFAULT_PLATFORM_FEE_BPS = 200;

/**
 * Division constant for basis points from contracts/src/lib.rs#L13 (const BPS_DIVISOR: i128 = 10_000;).
 */
export const BPS_DIVISOR = 10_000n;

/**
 * Threshold (in seconds) under which a quote expiration warning is displayed.
 */
export const QUOTE_EXPIRY_WARNING_THRESHOLD_SEC = 30;

/**
 * Safety margin (in seconds) under which deposit confirmation is blocked to prevent on-chain submission race conditions.
 */
export const QUOTE_SAFETY_MARGIN_SEC = 5;

/**
 * Upper bound for deposit amounts to prevent arithmetic overflows and unreasonable numbers (1 billion tokens).
 */
export const MAX_SAFE_DEPOSIT_TOKENS = 1_000_000_000n;

/**
 * Named constant containing fallback exchange rates and fee configurations.
 * MARKED AS PLACEHOLDER DATA: Used strictly when no live anchor SEP-38 endpoint is connected.
 */
export const DEMO_ANCHOR_PLACEHOLDER_RATES: Record<
  string,
  { price: string; total_price: string; feeTotal: string; feeAsset: string }
> = {
  USD: {
    price: "0.9950",
    total_price: "1.0000",
    feeTotal: "0.50",
    feeAsset: "iso4217:USD",
  },
  EUR: {
    price: "0.9150",
    total_price: "0.9200",
    feeTotal: "0.50",
    feeAsset: "iso4217:EUR",
  },
  GBP: {
    price: "0.7850",
    total_price: "0.7900",
    feeTotal: "0.40",
    feeAsset: "iso4217:GBP",
  },
  NGN: {
    price: "1550.00",
    total_price: "1560.00",
    feeTotal: "500.00",
    feeAsset: "iso4217:NGN",
  },
  BRL: {
    price: "5.45",
    total_price: "5.50",
    feeTotal: "2.50",
    feeAsset: "iso4217:BRL",
  },
};

export interface Sep38Fee {
  total: string;
  asset: string;
  details?: Array<{ name: string; amount: string; description?: string }>;
}

export interface Sep38Quote {
  id: string;
  expires_at: string;
  price: string;
  total_price: string;
  sell_asset: string;
  sell_amount: string;
  buy_asset: string;
  buy_amount: string;
  fee: Sep38Fee;
  isFallbackDemo?: boolean;
}

export interface Sep38QuoteRequest {
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  context?: "sep31" | "sep6";
}

export interface AssetInfo {
  asset: string;
  significant_decimals: number;
}

export interface RateBreakdown {
  grossTokens: string;
  platformFeeTokens: string;
  amountSentToAnchorTokens: string;
  anchorFeeFormatted: string;
  anchorFeeAsset: string;
  guaranteedPayoutFiat: string;
  fiatAsset: string;
  totalPrice: string;
  isFallbackDemo: boolean;
}

export type QuoteExpiryStatus =
  | "active"
  | "expiring_soon"
  | "too_close_to_confirm"
  | "expired";

export interface QuoteExpiryDetails {
  status: QuoteExpiryStatus;
  remainingSeconds: number;
  isConfirmable: boolean;
  message: string;
}

/**
 * Determines asset decimal precision.
 * Prioritizes SEP-38 /info significant_decimals if provided.
 */
export function getAssetDecimals(
  assetId: string,
  infoMap?: Map<string, AssetInfo> | Record<string, AssetInfo>
): number {
  if (infoMap) {
    const entry =
      infoMap instanceof Map ? infoMap.get(assetId) : infoMap[assetId];
    if (entry && typeof entry.significant_decimals === "number") {
      return entry.significant_decimals;
    }
  }

  // Common standard defaults
  const upper = assetId.toUpperCase();
  if (upper.startsWith("STELLAR:") || upper.startsWith("C") || upper === "XLM" || upper === "USDC") {
    return 7;
  }
  if (upper.endsWith(":JPY") || upper === "JPY") {
    return 0;
  }
  return 2;
}

/**
 * Formats a BigInt amount in minor units to a decimal string without floating-point conversion.
 */
export function formatMinorUnits(minor: bigint, decimals: number): string {
  if (decimals === 0) {
    return minor.toString();
  }
  const divisor = 10n ** BigInt(decimals);
  const intPart = minor / divisor;
  const rem = minor % divisor;
  const posRem = rem < 0n ? -rem : rem;
  return `${intPart.toString()}.${posRem.toString().padStart(decimals, "0")}`;
}

/**
 * Validates and parses a string amount into BigInt minor units.
 * Reuses parseTokenAmount while tolerating extra trailing zeros beyond decimals.
 * Rejects non-zero digits that exceed decimals.
 */
export function parseAndValidateTokenAmount(
  amountStr: string,
  decimals: number = 7
): bigint {
  if (!amountStr || amountStr.trim() === "") {
    throw new Error("Amount is required");
  }

  const trimmed = amountStr.trim();
  const numCheck = Number(trimmed);
  if (isNaN(numCheck)) {
    throw new Error("Invalid numerical amount format");
  }
  if (numCheck < 0) {
    throw new Error("Amount must be greater than zero");
  }

  let normalized = trimmed;
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    if (parts.length > 2) {
      throw new Error("Invalid numerical amount format");
    }
    const fractionalPart = parts[1] || "";
    if (fractionalPart.length > decimals) {
      const extraDigits = fractionalPart.slice(decimals);
      if (/[^0]/.test(extraDigits)) {
        throw new Error(`Amount exceeds maximum precision of ${decimals} decimals`);
      }
      // Safely truncate redundant trailing zeros
      normalized = `${parts[0]}.${fractionalPart.slice(0, decimals)}`;
    }
  }

  const minor = parseTokenAmount(normalized, decimals);
  if (minor <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  const maxMinor = MAX_SAFE_DEPOSIT_TOKENS * 10n ** BigInt(decimals);
  if (minor > maxMinor) {
    throw new Error(
      `Amount exceeds maximum supported limit of ${MAX_SAFE_DEPOSIT_TOKENS.toLocaleString()} tokens`
    );
  }

  return minor;
}

/**
 * Platform fee calculation:
 * Strictly mirrors contracts/src/lib.rs#L156-L160:
 * fee_amount = amount * fee_bps / BPS_DIVISOR (truncating integer division / floor).
 * amount_to_anchor = amount - fee_amount.
 */
export function calculatePlatformFee(
  grossMinor: bigint,
  feeBps: number = DEFAULT_PLATFORM_FEE_BPS
): { platformFeeMinor: bigint; amountSentToAnchorMinor: bigint } {
  if (feeBps < 0 || feeBps > 1000) {
    throw new Error("feeBps must be between 0 and 1000 (0% to 10%)");
  }
  const platformFeeMinor = (grossMinor * BigInt(feeBps)) / BPS_DIVISOR;
  const amountSentToAnchorMinor = grossMinor - platformFeeMinor;
  return { platformFeeMinor, amountSentToAnchorMinor };
}

/**
 * Calculates clock skew from HTTP server Date header.
 * Falls back to 0 if the Date header is unreadable or missing (e.g. CORS).
 */
export function calculateClockSkewMs(
  serverDateHeader: string | null | undefined,
  clientReceiveMs: number = Date.now()
): number {
  if (!serverDateHeader) {
    return 0;
  }
  const serverMs = Date.parse(serverDateHeader);
  if (isNaN(serverMs)) {
    return 0;
  }
  return serverMs - clientReceiveMs;
}

/**
 * Calculates remaining quote validity in seconds, compensating for clock skew.
 */
export function getQuoteRemainingSeconds(
  expiresAtIso: string,
  nowMs: number = Date.now(),
  clockSkewMs: number = 0
): number {
  const expiresAtMs = Date.parse(expiresAtIso);
  if (isNaN(expiresAtMs)) {
    return 0;
  }
  const effectiveNowMs = nowMs + clockSkewMs;
  return Math.floor((expiresAtMs - effectiveNowMs) / 1000);
}

/**
 * Evaluates quote expiry state with three distinct non-confirmable or warning states:
 * 1. Expiring soon (<= 30s)
 * 2. Too close to confirm (<= 5s safety margin)
 * 3. Expired (<= 0s)
 */
export function getQuoteExpiryDetails(remainingSeconds: number): QuoteExpiryDetails {
  if (remainingSeconds <= 0) {
    return {
      status: "expired",
      remainingSeconds: 0,
      isConfirmable: false,
      message: "Quote has expired. Refresh quote to proceed.",
    };
  }
  if (remainingSeconds <= QUOTE_SAFETY_MARGIN_SEC) {
    return {
      status: "too_close_to_confirm",
      remainingSeconds,
      isConfirmable: false,
      message: "Quote too close to expiry to confirm deposit safely. Please refresh.",
    };
  }
  if (remainingSeconds <= QUOTE_EXPIRY_WARNING_THRESHOLD_SEC) {
    return {
      status: "expiring_soon",
      remainingSeconds,
      isConfirmable: true,
      message: `Quote expiring in ${remainingSeconds}s. Refresh recommended.`,
    };
  }
  return {
    status: "active",
    remainingSeconds,
    isConfirmable: true,
    message: `Quote active (${remainingSeconds}s remaining).`,
  };
}

/**
 * Validates every field of an anchor SEP-38 quote response before display.
 */
export function validateAnchorQuoteResponse(
  quote: unknown,
  expected: {
    sell_asset: string;
    buy_asset: string;
    expectedSellAmount: string;
    sellDecimals: number;
    buyDecimals: number;
  },
  nowMs: number = Date.now()
): Sep38Quote {
  if (!quote || typeof quote !== "object") {
    throw new Error("Invalid quote response: expected JSON object from anchor");
  }

  const q = quote as Record<string, unknown>;

  if (typeof q.id !== "string" || q.id.trim() === "") {
    throw new Error("Invalid quote response: missing quote id");
  }

  if (q.sell_asset !== expected.sell_asset) {
    throw new Error(
      `Anchor quote sell_asset "${String(q.sell_asset)}" does not match requested "${expected.sell_asset}"`
    );
  }

  if (q.buy_asset !== expected.buy_asset) {
    throw new Error(
      `Anchor quote buy_asset "${String(q.buy_asset)}" does not match requested "${expected.buy_asset}"`
    );
  }

  if (typeof q.sell_amount !== "string") {
    throw new Error("Invalid quote response: sell_amount must be a string");
  }

  const quoteSellMinor = parseAndValidateTokenAmount(q.sell_amount, expected.sellDecimals);
  const expectedSellMinor = parseAndValidateTokenAmount(
    expected.expectedSellAmount,
    expected.sellDecimals
  );
  if (quoteSellMinor !== expectedSellMinor) {
    throw new Error(
      `Anchor quote sell_amount "${q.sell_amount}" does not match required anchor disbursement "${expected.expectedSellAmount}"`
    );
  }

  if (typeof q.buy_amount !== "string") {
    throw new Error("Invalid quote response: buy_amount must be a string");
  }
  let quoteBuyMinor: bigint;
  try {
    quoteBuyMinor = parseAndValidateTokenAmount(q.buy_amount, expected.buyDecimals);
  } catch {
    throw new Error("Anchor quote buy_amount must be a positive amount string");
  }
  if (quoteBuyMinor <= 0n) {
    throw new Error("Anchor quote buy_amount must be a positive amount string");
  }

  if (typeof q.expires_at !== "string") {
    throw new Error("Invalid quote response: missing expires_at string");
  }
  const expiresAtMs = Date.parse(q.expires_at);
  if (isNaN(expiresAtMs)) {
    throw new Error("Anchor quote expires_at is not a valid date string");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("Anchor quote expires_at must be a valid future timestamp");
  }

  if (!q.fee || typeof q.fee !== "object") {
    throw new Error("Invalid quote response: missing fee object");
  }
  const feeObj = q.fee as Record<string, unknown>;
  if (typeof feeObj.total !== "string" || typeof feeObj.asset !== "string") {
    throw new Error("Invalid quote response: fee must contain string total and asset");
  }

  if (typeof q.total_price !== "string" || q.total_price.trim() === "") {
    throw new Error("Invalid quote response: missing or invalid total_price");
  }

  return {
    id: q.id,
    expires_at: q.expires_at,
    price: typeof q.price === "string" ? q.price : q.total_price,
    total_price: q.total_price,
    sell_asset: q.sell_asset,
    sell_amount: q.sell_amount,
    buy_asset: q.buy_asset,
    buy_amount: q.buy_amount,
    fee: {
      total: feeObj.total,
      asset: feeObj.asset,
      details: Array.isArray(feeObj.details)
        ? (feeObj.details as Array<{ name: string; amount: string; description?: string }>)
        : undefined,
    },
    isFallbackDemo: Boolean(q.isFallbackDemo),
  };
}

/**
 * Computes the complete fee and payout breakdown under SEP-38 semantics.
 * Note: quote.buy_amount already reflects deductions for anchor fees.
 */
export function computeRateBreakdown(params: {
  grossTokens: string;
  grossDecimals: number;
  quote: Sep38Quote;
  platformFeeBps?: number;
  infoMap?: Map<string, AssetInfo> | Record<string, AssetInfo>;
}): RateBreakdown {
  const { grossTokens, grossDecimals, quote, platformFeeBps = DEFAULT_PLATFORM_FEE_BPS, infoMap } =
    params;

  const grossMinor = parseAndValidateTokenAmount(grossTokens, grossDecimals);
  const { platformFeeMinor, amountSentToAnchorMinor } = calculatePlatformFee(
    grossMinor,
    platformFeeBps
  );

  const feeAssetDecimals = getAssetDecimals(quote.fee.asset, infoMap);
  const feeMinor = parseAndValidateTokenAmount(quote.fee.total, feeAssetDecimals);
  const feeFormatted = formatMinorUnits(feeMinor, feeAssetDecimals);

  const buyAssetDecimals = getAssetDecimals(quote.buy_asset, infoMap);
  const buyMinor = parseAndValidateTokenAmount(quote.buy_amount, buyAssetDecimals);
  const guaranteedPayoutFiat = formatMinorUnits(buyMinor, buyAssetDecimals);

  return {
    grossTokens: formatMinorUnits(grossMinor, grossDecimals),
    platformFeeTokens: formatMinorUnits(platformFeeMinor, grossDecimals),
    amountSentToAnchorTokens: formatMinorUnits(amountSentToAnchorMinor, grossDecimals),
    anchorFeeFormatted: feeFormatted,
    anchorFeeAsset: quote.fee.asset,
    guaranteedPayoutFiat,
    fiatAsset: quote.buy_asset,
    totalPrice: quote.total_price,
    isFallbackDemo: Boolean(quote.isFallbackDemo),
  };
}

/**
 * Request sequencing and race-condition manager.
 * Cancels prior in-flight requests and drops responses that arrive out of order.
 */
export class QuoteSequenceController {
  private currentRequestId = 0;
  private activeAbortController: AbortController | null = null;

  public startRequest(): { requestId: number; signal: AbortSignal } {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    this.activeAbortController = new AbortController();
    this.currentRequestId += 1;
    return {
      requestId: this.currentRequestId,
      signal: this.activeAbortController.signal,
    };
  }

  public isLatest(requestId: number): boolean {
    return requestId === this.currentRequestId;
  }

  public cancelActive(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  public getCurrentRequestId(): number {
    return this.currentRequestId;
  }
}

/**
 * Creates the default quote fetcher.
 * If anchorBaseUrl is provided, it calls the HTTPS endpoint.
 * Otherwise, it uses deterministic placeholder data marked as demo quotes.
 */
export function createDefaultQuoteFetcher(
  anchorBaseUrl?: string,
  infoMap?: Map<string, AssetInfo> | Record<string, AssetInfo>
): (req: Sep38QuoteRequest, signal?: AbortSignal) => Promise<Sep38Quote> {
  return async (req: Sep38QuoteRequest, signal?: AbortSignal): Promise<Sep38Quote> => {
    if (anchorBaseUrl) {
      if (!anchorBaseUrl.startsWith("https://")) {
        throw new Error("Anchor quote URL must use https://");
      }
      const url = new URL(`${anchorBaseUrl.replace(/\/+$/, "")}/quote`);
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sell_asset: req.sell_asset,
          buy_asset: req.buy_asset,
          sell_amount: req.sell_amount,
          context: req.context || "sep31",
        }),
        signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Anchor SEP-38 request failed (${res.status}): ${errorText}`);
      }

      const json = await res.json();
      const sellDecimals = getAssetDecimals(req.sell_asset, infoMap);
      const buyDecimals = getAssetDecimals(req.buy_asset, infoMap);

      return validateAnchorQuoteResponse(json, {
        sell_asset: req.sell_asset,
        buy_asset: req.buy_asset,
        expectedSellAmount: req.sell_amount,
        sellDecimals,
        buyDecimals,
      });
    }

    // Fallback/demo quote generator with placeholder data
    const fiatCode = req.buy_asset.includes(":")
      ? req.buy_asset.split(":")[1] || "USD"
      : req.buy_asset;
    const rateInfo = DEMO_ANCHOR_PLACEHOLDER_RATES[fiatCode] || DEMO_ANCHOR_PLACEHOLDER_RATES.USD!;

    const sellDecimals = getAssetDecimals(req.sell_asset, infoMap);
    const buyDecimals = getAssetDecimals(req.buy_asset, infoMap);
    const sellMinor = parseAndValidateTokenAmount(req.sell_amount, sellDecimals);

    // Compute buy amount using integer minor units
    const priceRateMinor = parseAndValidateTokenAmount(rateInfo.price, 4); // rate with 4 decimals
    const grossBuyMinor = (sellMinor * priceRateMinor) / 10_000n;
    // Scale from sellDecimals (7) to buyDecimals (2)
    const scaleFactor = 10n ** BigInt(sellDecimals - buyDecimals);
    let scaledBuyMinor = grossBuyMinor / scaleFactor;
    if (scaledBuyMinor <= 0n) {
      scaledBuyMinor = 1n;
    }

    const buyAmountStr = formatMinorUnits(scaledBuyMinor, buyDecimals);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    return {
      id: `demo-${Date.now()}`,
      expires_at: expiresAt,
      price: rateInfo.price,
      total_price: rateInfo.total_price,
      sell_asset: req.sell_asset,
      sell_amount: req.sell_amount,
      buy_asset: req.buy_asset,
      buy_amount: buyAmountStr,
      fee: {
        total: rateInfo.feeTotal,
        asset: rateInfo.feeAsset,
      },
      isFallbackDemo: true,
    };
  };
}
