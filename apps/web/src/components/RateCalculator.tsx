"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Clock,
  RefreshCw,
  Coins,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  QuoteExpiryDetails,
  RateBreakdown,
  Sep38Quote,
  Sep38QuoteRequest,
  calculateClockSkewMs,
  calculatePlatformFee,
  computeRateBreakdown,
  createDefaultQuoteFetcher,
  formatMinorUnits,
  getQuoteExpiryDetails,
  getQuoteRemainingSeconds,
  parseAndValidateTokenAmount,
  QuoteSequenceController,
} from "@/lib/rate-calculator";

export interface RateCalculatorProps {
  /** Gross token amount string from the escrow deposit form */
  sellAmount: string;
  /** Stellar asset identifier or symbol (e.g. "XLM", "USDC", or StrKey contract) */
  sellAsset?: string;
  /** Token decimal places (defaults to 7 for Stellar SAC) */
  sellDecimals?: number;
  /** Connected Freighter wallet public key */
  walletAddress?: string;
  /** Optional custom anchor SEP-38 endpoint URL (must use HTTPS) */
  anchorUrl?: string;
  /** Optional injected quote fetcher for full dependency injection and testing */
  fetchQuote?: (req: Sep38QuoteRequest, signal?: AbortSignal) => Promise<Sep38Quote>;
  /** Callback notifying parent of quote validity, blocking reason, and breakdown */
  onValidityChange?: (
    isValid: boolean,
    reason: string | null,
    breakdown: RateBreakdown | null
  ) => void;
  className?: string;
}

const SUPPORTED_FIAT_CURRENCIES = ["USD", "EUR", "GBP", "NGN", "BRL"] as const;
type FiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number];

export function RateCalculator({
  sellAmount,
  sellAsset = "Native SAC (XLM)",
  sellDecimals = 7,
  walletAddress,
  anchorUrl,
  fetchQuote,
  onValidityChange,
  className = "",
}: RateCalculatorProps) {
  const [selectedFiat, setSelectedFiat] = useState<FiatCurrency>("USD");
  const [quote, setQuote] = useState<Sep38Quote | null>(null);
  const [breakdown, setBreakdown] = useState<RateBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const [expiryDetails, setExpiryDetails] = useState<QuoteExpiryDetails | null>(null);

  const sequenceController = useMemo(() => new QuoteSequenceController(), []);

  // Determine quote fetcher: injected prop, anchor URL prop, env var, or fallback generator
  const activeFetcher = useMemo(() => {
    if (fetchQuote) return fetchQuote;
    const url = anchorUrl || process.env.NEXT_PUBLIC_ANCHOR_QUOTE_URL;
    return createDefaultQuoteFetcher(url);
  }, [fetchQuote, anchorUrl]);

  // Derive canonical asset identifier for SEP-38
  const canonicalSellAsset = useMemo(() => {
    const s = sellAsset.toUpperCase();
    if (s.includes("XLM")) return "stellar:native";
    if (s.includes("USDC")) return "stellar:USDC:CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT";
    return sellAsset.startsWith("stellar:") ? sellAsset : `stellar:${sellAsset}`;
  }, [sellAsset]);

  const canonicalBuyAsset = useMemo(() => `iso4217:${selectedFiat}`, [selectedFiat]);

  // Keep a ref to onValidityChange to avoid unnecessary re-triggers
  const onValidityChangeRef = useRef(onValidityChange);
  useEffect(() => {
    onValidityChangeRef.current = onValidityChange;
  }, [onValidityChange]);

  const updateValidity = useCallback(
    (isValid: boolean, reason: string | null, b: RateBreakdown | null) => {
      if (onValidityChangeRef.current) {
        onValidityChangeRef.current(isValid, reason, b);
      }
    },
    []
  );

  // Core quote fetch routine
  const executeQuoteFetch = useCallback(async () => {
    if (!sellAmount || sellAmount.trim() === "") {
      setQuote(null);
      setBreakdown(null);
      setError(null);
      setExpiryDetails(null);
      updateValidity(false, "Please enter an amount to view rate quote", null);
      return;
    }

    let grossMinor: bigint;
    try {
      grossMinor = parseAndValidateTokenAmount(sellAmount, sellDecimals);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setQuote(null);
      setBreakdown(null);
      setError(msg);
      setExpiryDetails(null);
      updateValidity(false, msg, null);
      return;
    }

    const { amountSentToAnchorMinor } = calculatePlatformFee(
      grossMinor,
      DEFAULT_PLATFORM_FEE_BPS
    );
    const amountSentToAnchorStr = formatMinorUnits(amountSentToAnchorMinor, sellDecimals);

    const { requestId, signal } = sequenceController.startRequest();
    setLoading(true);
    setError(null);

    const startTime = Date.now();
    try {
      const receivedQuote = await activeFetcher(
        {
          sell_asset: canonicalSellAsset,
          buy_asset: canonicalBuyAsset,
          sell_amount: amountSentToAnchorStr,
          context: "sep31",
        },
        signal
      );

      if (!sequenceController.isLatest(requestId) || signal.aborted) {
        return;
      }

      // Compute clock skew if server header is present
      const skew = calculateClockSkewMs(undefined, startTime);
      setClockSkewMs(skew);

      const computed = computeRateBreakdown({
        grossTokens: sellAmount,
        grossDecimals: sellDecimals,
        quote: receivedQuote,
        platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
      });

      const remSec = getQuoteRemainingSeconds(receivedQuote.expires_at, Date.now(), skew);
      const expiry = getQuoteExpiryDetails(remSec);

      setQuote(receivedQuote);
      setBreakdown(computed);
      setExpiryDetails(expiry);

      if (!walletAddress) {
        updateValidity(false, "Freighter wallet required to initialize escrow", computed);
      } else if (!expiry.isConfirmable) {
        updateValidity(false, expiry.message, computed);
      } else {
        updateValidity(true, null, computed);
      }
    } catch (err: unknown) {
      if (signal.aborted || !sequenceController.isLatest(requestId)) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setQuote(null);
      setBreakdown(null);
      setError(msg);
      setExpiryDetails(null);
      updateValidity(false, `Quote fetch failed: ${msg}`, null);
    } finally {
      if (sequenceController.isLatest(requestId)) {
        setLoading(false);
      }
    }
  }, [
    sellAmount,
    sellDecimals,
    activeFetcher,
    canonicalSellAsset,
    canonicalBuyAsset,
    sequenceController,
    walletAddress,
    updateValidity,
  ]);

  // Debounced auto-fetch on amount or currency change
  useEffect(() => {
    const timer = setTimeout(() => {
      executeQuoteFetch();
    }, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [executeQuoteFetch]);

  // Cleanup in-flight requests on unmount
  useEffect(() => {
    return () => {
      sequenceController.cancelActive();
    };
  }, [sequenceController]);

  // Clock tick for expiry countdown
  useEffect(() => {
    if (!quote) return;

    const tick = () => {
      const rem = getQuoteRemainingSeconds(quote.expires_at, Date.now(), clockSkewMs);
      const details = getQuoteExpiryDetails(rem);
      setExpiryDetails(details);

      if (!walletAddress) {
        updateValidity(false, "Freighter wallet required to initialize escrow", breakdown);
      } else if (!details.isConfirmable) {
        updateValidity(false, details.message, breakdown);
      } else {
        updateValidity(true, null, breakdown);
      }

      if (rem <= 0) {
        clearInterval(timerId);
      }
    };

    tick();
    const timerId = setInterval(tick, 1000);

    return () => {
      clearInterval(timerId);
    };
  }, [quote, clockSkewMs, walletAddress, breakdown, updateValidity]);

  const tokenDisplayName = useMemo(() => {
    if (sellAsset.includes("XLM")) return "XLM";
    if (sellAsset.includes("USDC")) return "USDC";
    return "Tokens";
  }, [sellAsset]);

  return (
    <div
      className={`rounded-2xl border border-border bg-card/60 p-5 space-y-4 shadow-sm transition-all ${className}`}
      data-testid="rate-calculator"
    >
      {/* Header and Currency Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Anchor Rate & Guaranteed Payout
            </h3>
            <p className="text-xs text-muted-foreground">
              SEP-38 locked quotes before onchain escrow confirmation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="payout-currency-select"
            className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          >
            Fiat:
          </label>
          <div className="flex rounded-xl border border-border bg-input/40 p-0.5">
            {SUPPORTED_FIAT_CURRENCIES.map((fiat) => (
              <button
                key={fiat}
                type="button"
                onClick={() => setSelectedFiat(fiat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  selectedFiat === fiat
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {fiat}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={executeQuoteFetch}
            disabled={loading}
            aria-label="Refresh exchange quote"
            className="h-8 px-2.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            <span className="sr-only">Refresh quote</span>
          </Button>
        </div>
      </div>

      {/* Validation Error Banner */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3.5 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Quote Breakdown Display */}
      {breakdown && !error && (
        <div className="space-y-4">
          {/* Transparent Cost Breakdown Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
            <div className="p-3 rounded-xl border border-border bg-input/30 space-y-0.5">
              <span className="text-muted-foreground block text-[11px] uppercase tracking-wider">
                Gross Deposit
              </span>
              <span className="text-sm font-semibold text-foreground">
                {breakdown.grossTokens} {tokenDisplayName}
              </span>
            </div>

            <div className="p-3 rounded-xl border border-border bg-input/30 space-y-0.5">
              <span className="text-muted-foreground block text-[11px] uppercase tracking-wider">
                Platform Escrow Fee (2.0%)
              </span>
              <span className="text-sm font-semibold text-foreground">
                {breakdown.platformFeeTokens} {tokenDisplayName}
              </span>
            </div>

            <div className="p-3 rounded-xl border border-border bg-input/30 space-y-0.5">
              <span className="text-muted-foreground block text-[11px] uppercase tracking-wider">
                Net to Anchor
              </span>
              <span className="text-sm font-semibold text-foreground">
                {breakdown.amountSentToAnchorTokens} {tokenDisplayName}
              </span>
            </div>

            <div className="p-3 rounded-xl border border-border bg-input/30 space-y-0.5">
              <span className="text-muted-foreground block text-[11px] uppercase tracking-wider">
                Anchor Conversion Fee
              </span>
              <span className="text-sm font-semibold text-foreground">
                {breakdown.anchorFeeFormatted} {breakdown.anchorFeeAsset.split(":").pop()}
              </span>
            </div>
          </div>

          {/* Guaranteed Net Fiat Payout Banner */}
          <div className="p-4 rounded-xl border border-primary/30 bg-primary/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                  {breakdown.isFallbackDemo
                    ? "Estimated payout (demo quote, no anchor connected)"
                    : "Guaranteed payout"}
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-primary tracking-tight">
                {breakdown.guaranteedPayoutFiat}{" "}
                <span className="text-lg text-primary/80">{selectedFiat}</span>
              </div>
            </div>

            <div className="text-xs font-mono text-muted-foreground text-left sm:text-right">
              <div>Total Anchor Rate:</div>
              <div className="text-foreground font-semibold">
                1 {tokenDisplayName} = {breakdown.totalPrice} {selectedFiat}
              </div>
            </div>
          </div>

          {/* Expiry Warning Timer with 3 Distinct States */}
          {expiryDetails && (
            <div
              role="status"
              aria-live="polite"
              className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 transition-colors ${
                expiryDetails.status === "expired"
                  ? "bg-destructive/15 border-destructive/40 text-destructive font-semibold"
                  : expiryDetails.status === "too_close_to_confirm"
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-500 font-semibold"
                  : expiryDetails.status === "expiring_soon"
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  : "bg-input/30 border-border text-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2">
                {expiryDetails.status === "expired" ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-destructive animate-pulse" />
                ) : expiryDetails.status === "too_close_to_confirm" ||
                  expiryDetails.status === "expiring_soon" ? (
                  <Clock className="w-4 h-4 shrink-0 text-amber-400 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-primary" />
                )}
                <span>{expiryDetails.message}</span>
              </div>

              {!expiryDetails.isConfirmable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={executeQuoteFetch}
                  className="h-7 px-2.5 text-xs font-semibold"
                >
                  Refresh Rate
                </Button>
              )}
            </div>
          )}

          {/* Wallet Disconnection Warning */}
          {!walletAddress && (
            <p className="text-xs text-amber-500 flex items-center gap-1.5" role="alert">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Wallet disconnected. Connect Freighter to confirm deposit.</span>
            </p>
          )}
        </div>
      )}

      {/* Loading Placeholder */}
      {loading && !breakdown && (
        <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          <span>Fetching authoritative SEP-38 anchor quote…</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && !breakdown && !error && (
        <p className="text-xs text-muted-foreground italic text-center py-2">
          Enter an amount above to preview real-time anchor fees and guaranteed fiat payout.
        </p>
      )}
    </div>
  );
}
