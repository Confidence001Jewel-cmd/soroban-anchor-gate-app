/**
 * SEP-38 anchor RFQ client helpers.
 *
 * This module discovers an anchor's SEP-38 quote server from its
 * `stellar.toml` file and requests an indicative exchange price for a pair of
 * assets. It is intended for browser and mobile clients that need to show a
 * quote before creating an escrow. Firm quotes (`POST /quote`) require SEP-10
 * authentication and anchor-specific context, while the helper here uses the
 * public `GET /price` endpoint defined by SEP-38.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md
 * @packageDocumentation
 */

/**
 * Fee line item returned by a SEP-38 price or quote response.
 */
export interface Sep38FeeDetail {
  /** Human-readable fee name, such as `"PIX fee"` or `"Service fee"`. */
  name: string;
  /** Optional explanation of how the fee is calculated. */
  description?: string;
  /** Fee amount in the asset identified by {@link Sep38Fee.asset}. */
  amount: string;
}

/**
 * Fee breakdown returned by a SEP-38 price or quote response.
 */
export interface Sep38Fee {
  /** Total fee amount across all {@link Sep38Fee.details}. */
  total: string;
  /** Asset in which the fee is denominated, in SEP-38 asset format. */
  asset: string;
  /** Optional individual fee components that make up {@link Sep38Fee.total}. */
  details?: Sep38FeeDetail[];
}

/**
 * Strongly typed indicative exchange quote produced by
 * {@link getAnchorExchangeQuote}.
 */
export interface Sep38Quote {
  /** Normalized anchor host used for SEP-1 discovery. */
  anchorDomain: string;
  /** SEP-38 quote server base URL discovered from `stellar.toml`. */
  quoteServer: string;
  /** Total price including fees, for one unit of the buy asset. */
  totalPrice: string;
  /** Price excluding fees, for one unit of the buy asset. */
  price: string;
  /** Asset being sold, in SEP-38 asset identification format. */
  sellAsset: string;
  /** Amount of `sellAsset` the anchor will exchange. */
  sellAmount: string;
  /** Asset being bought, in SEP-38 asset identification format. */
  buyAsset: string;
  /** Amount of `buyAsset` the anchor will provide. */
  buyAmount: string;
  /** Optional fee breakdown returned by the anchor. */
  fee?: Sep38Fee;
}

/**
 * Valid values for the optional SEP-38 `context` request parameter.
 */
export type Sep38QuoteContext = "sep6" | "sep24" | "sep31";

/**
 * Options for {@link getAnchorExchangeQuote}.
 */
export interface AnchorQuoteRequestOptions {
  /**
   * Custom `fetch` implementation. Useful for tests, server-side proxies, or
   * instrumented browser clients. Defaults to the global `fetch`.
   */
  fetch?: typeof fetch;
  /** Optional SEP-38 context identifying how the quote will be used. */
  context?: Sep38QuoteContext;
  /** Optional ISO 3166-2 or ISO-3166-1 alpha-2 country code. */
  countryCode?: string;
  /** Optional delivery method used when selling an off-chain asset. */
  sellDeliveryMethod?: string;
  /** Optional delivery method used when buying an off-chain asset. */
  buyDeliveryMethod?: string;
  /** Optional SEP-10 JWT used to personalize the indicative price. */
  authToken?: string;
  /** Additional HTTP headers to include on both discovery and quote requests. */
  headers?: Record<string, string>;
  /** Optional abort signal used to cancel discovery and quote requests. */
  signal?: AbortSignal;
}

interface RequestResult {
  status: number;
  statusText: string;
  body: string;
}

/**
 * Extracts the `ANCHOR_QUOTE_SERVER` value from the top-level table of a
 * `stellar.toml` document.
 *
 * This intentionally small TOML reader handles the subset of the format used
 * by SEP-1 discovery: comments, table headers, bare keys, basic strings, and
 * literal strings. Other sections are ignored.
 *
 * @param toml - Raw `stellar.toml` contents.
 * @returns The configured quote server URL, or `undefined` when the key is
 *   absent.
 * @throws {Error} If `ANCHOR_QUOTE_SERVER` is present but is not a string.
 */
export function parseAnchorQuoteServerFromToml(
  toml: string
): string | undefined {
  if (typeof toml !== "string") {
    throw new Error("stellar.toml contents must be a string");
  }

  let table = "";
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }
    if (line.startsWith("[")) {
      table = line;
      continue;
    }
    if (table !== "") {
      continue;
    }

    const equals = line.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    if (key !== "ANCHOR_QUOTE_SERVER") {
      continue;
    }
    const value = parseTomlString(line.slice(equals + 1).trim());
    return value === "" ? undefined : value;
  }

  return undefined;
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote !== undefined) {
      if (quote === '"' && character === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (character === quote && !escaped) {
        quote = undefined;
      }
      escaped = false;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#") {
      return line.slice(0, index);
    }
  }

  return line;
}

function parseTomlString(value: string): string {
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new Error("ANCHOR_QUOTE_SERVER must be a quoted TOML string");
    }
    return unescapeTomlBasicString(value.slice(1, -1));
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new Error("ANCHOR_QUOTE_SERVER must be a quoted TOML string");
    }
    return value.slice(1, -1);
  }
  throw new Error("ANCHOR_QUOTE_SERVER must be a quoted TOML string");
}

function unescapeTomlBasicString(value: string): string {
  return value.replace(
    /\\(["\\bfnrt]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/g,
    (_match, escape: string) => {
      switch (escape[0]) {
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "u":
        case "U":
          return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
        default:
          return escape;
      }
    }
  );
}

function normalizeAnchorDomain(anchorDomain: string): URL {
  if (typeof anchorDomain !== "string" || anchorDomain.trim() === "") {
    throw new Error("anchorDomain cannot be empty");
  }

  const trimmed = anchorDomain.trim();
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`Invalid anchor domain: ${anchorDomain}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported anchor URL protocol: ${url.protocol}`);
  }

  return url;
}

function resolveQuoteServer(quoteServer: string, anchorUrl: URL): URL {
  let url: URL;
  try {
    url = new URL(quoteServer, anchorUrl);
  } catch {
    throw new Error(`Invalid ANCHOR_QUOTE_SERVER value: ${quoteServer}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported ANCHOR_QUOTE_SERVER protocol: ${url.protocol}`);
  }
  return url;
}

function normalizeAmount(amount: string | number | bigint): string {
  if (typeof amount === "bigint") {
    if (amount < 0n) {
      throw new Error("Quote amount cannot be negative");
    }
    return amount.toString();
  }

  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Invalid quote amount: ${amount}`);
    }
    const text = String(amount);
    if (/[eE]/.test(text)) {
      throw new Error(
        "Scientific notation is not supported; pass quote amounts as decimal strings"
      );
    }
    if (!/^\d+(?:\.\d+)?$/.test(text)) {
      throw new Error(`Invalid quote amount: ${amount}`);
    }
    return text;
  }

  if (typeof amount === "string") {
    const text = amount.trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) {
      throw new Error(`Invalid quote amount: ${amount}`);
    }
    return text;
  }

  throw new Error("Quote amount must be a string, number, or bigint");
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`SEP-38 response is missing a valid "${field}" field`);
  }
  return value;
}

function parseFee(value: unknown): Sep38Fee | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error('SEP-38 response contains an invalid "fee" field');
  }

  const fee = value as Record<string, unknown>;
  const parsed: Sep38Fee = {
    total: assertNonEmptyString(fee.total, "fee.total"),
    asset: assertNonEmptyString(fee.asset, "fee.asset"),
  };

  if (fee.details !== undefined) {
    if (!Array.isArray(fee.details)) {
      throw new Error('SEP-38 response contains an invalid "fee.details" field');
    }
    parsed.details = fee.details.map((detail, index) => {
      if (
        detail === null ||
        typeof detail !== "object" ||
        Array.isArray(detail)
      ) {
        throw new Error(
          `SEP-38 response contains an invalid "fee.details[${index}]" field`
        );
      }
      const item = detail as Record<string, unknown>;
      const description = item.description;
      if (description !== undefined && typeof description !== "string") {
        throw new Error(
          `SEP-38 response contains an invalid "fee.details[${index}].description" field`
        );
      }
      return {
        name: assertNonEmptyString(item.name, `fee.details[${index}].name`),
        amount: assertNonEmptyString(
          item.amount,
          `fee.details[${index}].amount`
        ),
        ...(description === undefined ? {} : { description }),
      };
    });
  }

  return parsed;
}

function parseQuote(
  payload: unknown,
  context: {
    anchorDomain: string;
    quoteServer: string;
    sellAsset: string;
    buyAsset: string;
  }
): Sep38Quote {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("SEP-38 price response must be a JSON object");
  }

  const body = payload as Record<string, unknown>;
  const price = assertNonEmptyString(body.price, "price");
  const totalPrice =
    body.total_price === undefined || body.total_price === null
      ? price
      : assertNonEmptyString(body.total_price, "total_price");

  return {
    anchorDomain: context.anchorDomain,
    quoteServer: context.quoteServer,
    totalPrice,
    price,
    sellAsset: context.sellAsset,
    sellAmount: assertNonEmptyString(body.sell_amount, "sell_amount"),
    buyAsset: context.buyAsset,
    buyAmount: assertNonEmptyString(body.buy_amount, "buy_amount"),
    ...(body.fee === undefined || body.fee === null
      ? {}
      : { fee: parseFee(body.fee) }),
  };
}

async function request(
  fetchImpl: typeof fetch,
  url: URL,
  options: AnchorQuoteRequestOptions,
  accept: string
): Promise<RequestResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: accept,
        ...(options.authToken === undefined
          ? {}
          : { Authorization: `Bearer ${options.authToken}` }),
        ...options.headers,
      },
      signal: options.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Request to ${url.toString()} failed: ${detail}`);
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read response from ${url.toString()}: ${detail}`);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    body,
  };
}

function errorMessageFromBody(body: string, fallback: string): string {
  if (body.trim() === "") {
    return fallback;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).error === "string"
    ) {
      return (parsed as Record<string, string>).error;
    }
  } catch {
    return body.trim();
  }
  return body.trim();
}

/**
 * Discovers an anchor's SEP-38 quote server from its `stellar.toml` file.
 *
 * The discovery URL is `https://<anchorDomain>/.well-known/stellar.toml`
 * unless the caller supplies an explicit `http://` or `https://` URL. The
 * returned server URL is resolved against the anchor URL so relative values
 * remain usable.
 *
 * @param anchorDomain - Anchor hostname such as `"testanchor.stellar.org"` or
 *   an absolute `http(s)` URL.
 * @param options - Optional fetch implementation, headers, and abort signal.
 * @returns The absolute SEP-38 quote server base URL.
 * @throws {Error} If the domain is invalid, discovery fails, or
 *   `ANCHOR_QUOTE_SERVER` is missing or malformed.
 */
export async function discoverAnchorQuoteServer(
  anchorDomain: string,
  options: AnchorQuoteRequestOptions = {}
): Promise<string> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "No fetch implementation available; pass options.fetch explicitly"
    );
  }

  const anchorUrl = normalizeAnchorDomain(anchorDomain);
  const tomlUrl = new URL("/.well-known/stellar.toml", anchorUrl.origin);
  const discovery = await request(fetchImpl, tomlUrl, options, "text/plain");

  if (discovery.status < 200 || discovery.status >= 300) {
    throw new Error(
      `Failed to fetch stellar.toml from ${tomlUrl.toString()} (${discovery.status}${
        discovery.statusText === "" ? "" : ` ${discovery.statusText}`
      }): ${errorMessageFromBody(discovery.body, "discovery failed")}`
    );
  }

  const quoteServer = parseAnchorQuoteServerFromToml(discovery.body);
  if (quoteServer === undefined) {
    throw new Error(
      `stellar.toml at ${tomlUrl.toString()} does not declare ANCHOR_QUOTE_SERVER`
    );
  }

  return resolveQuoteServer(quoteServer, anchorUrl).toString();
}

/**
 * Fetches an indicative SEP-38 exchange quote from an anchor.
 *
 * The helper performs SEP-38 discovery automatically:
 *
 * 1. Fetches `/.well-known/stellar.toml` from `anchorDomain`.
 * 2. Reads the `ANCHOR_QUOTE_SERVER` table entry.
 * 3. Calls `GET <quote server>/price` with `sell_asset`, `buy_asset`, and
 *    `sell_amount` query parameters.
 *
 * The function does not create a firm quote and does not require SEP-10
 * authentication. If an anchor requires authentication for personalized
 * pricing, pass a token via {@link AnchorQuoteRequestOptions.authToken}.
 *
 * @param anchorDomain - Anchor hostname such as `"testanchor.stellar.org"`, or
 *   an absolute `http(s)` URL.
 * @param fromAsset - Asset sold by the client, in SEP-38 format such as
 *   `"stellar:USDC:GA5Z...ZVN"` or `"iso4217:USD"`.
 * @param toAsset - Asset bought by the client, in SEP-38 format.
 * @param amount - Amount of `fromAsset` to sell, as a non-negative decimal
 *   string, number, or `bigint`.
 * @param options - Optional context, delivery methods, country code,
 *   authentication token, custom fetch implementation, headers, and abort
 *   signal.
 * @returns A strongly typed {@link Sep38Quote}.
 * @throws {Error} If inputs are empty or invalid, discovery fails, the anchor
 *   returns an error, or the response is missing required fields.
 *
 * @example
 * ```ts
 * const quote = await getAnchorExchangeQuote(
 *   "testanchor.stellar.org",
 *   "iso4217:USD",
 *   "stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
 *   "100.00",
 *   { context: "sep31" }
 * );
 *
 * console.log(quote.totalPrice, quote.buyAmount);
 * ```
 */
export async function getAnchorExchangeQuote(
  anchorDomain: string,
  fromAsset: string,
  toAsset: string,
  amount: string | number | bigint,
  options: AnchorQuoteRequestOptions = {}
): Promise<Sep38Quote> {
  if (typeof fromAsset !== "string" || fromAsset.trim() === "") {
    throw new Error("fromAsset cannot be empty");
  }
  if (typeof toAsset !== "string" || toAsset.trim() === "") {
    throw new Error("toAsset cannot be empty");
  }
  const sellAsset = fromAsset.trim();
  const buyAsset = toAsset.trim();
  const sellAmount = normalizeAmount(amount);

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "No fetch implementation available; pass options.fetch explicitly"
    );
  }

  const quoteServer = await discoverAnchorQuoteServer(anchorDomain, options);
  const priceUrl = new URL(quoteServer);
  priceUrl.pathname = `${priceUrl.pathname.replace(/\/+$/, "")}/price`;
  priceUrl.search = "";
  priceUrl.searchParams.set("sell_asset", sellAsset);
  priceUrl.searchParams.set("buy_asset", buyAsset);
  priceUrl.searchParams.set("sell_amount", sellAmount);
  if (options.context !== undefined) {
    priceUrl.searchParams.set("context", options.context);
  }
  if (options.countryCode !== undefined) {
    priceUrl.searchParams.set("country_code", options.countryCode);
  }
  if (options.sellDeliveryMethod !== undefined) {
    priceUrl.searchParams.set(
      "sell_delivery_method",
      options.sellDeliveryMethod
    );
  }
  if (options.buyDeliveryMethod !== undefined) {
    priceUrl.searchParams.set(
      "buy_delivery_method",
      options.buyDeliveryMethod
    );
  }

  const response = await request(
    fetchImpl,
    priceUrl,
    options,
    "application/json"
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `SEP-38 price request failed (${response.status}${
        response.statusText === "" ? "" : ` ${response.statusText}`
      }): ${errorMessageFromBody(response.body, "quote request failed")}`
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error("SEP-38 price response is not valid JSON");
  }

  const anchorDomainOut = normalizeAnchorDomain(anchorDomain);
  return parseQuote(payload, {
    anchorDomain: anchorDomainOut.host,
    quoteServer,
    sellAsset,
    buyAsset,
  });
}
