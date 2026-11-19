import assert from "node:assert";
import { test, describe } from "node:test";
import {
  discoverAnchorQuoteServer,
  getAnchorExchangeQuote,
  parseAnchorQuoteServerFromToml,
} from "./sep38";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

interface MockResponse {
  status?: number;
  statusText?: string;
  body: string;
}

function mockFetch(
  handler: (url: string, init?: FetchInit) => MockResponse
): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: FetchInit }>;
} {
  const calls: Array<{ url: string; init?: FetchInit }> = [];
  const fetchImpl = (async (input: FetchInput, init?: FetchInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    const result = handler(url, init);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: result.statusText ?? "",
      text: async () => result.body,
    } as Response;
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}

const usdc = "stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const toml = `
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
ANCHOR_QUOTE_SERVER = "https://quotes.anchor.test/sep38" # quote service

[DOCUMENTATION]
ANCHOR_QUOTE_SERVER = "https://ignored.anchor.test"
`;

const pricePayload = {
  total_price: "1.02",
  price: "1.00",
  sell_amount: "102.00",
  buy_amount: "100.00",
  fee: {
    total: "2.00",
    asset: "iso4217:USD",
    details: [
      {
        name: "Service fee",
        description: "Anchor conversion fee",
        amount: "2.00",
      },
    ],
  },
};

describe("parseAnchorQuoteServerFromToml", () => {
  test("reads the top-level ANCHOR_QUOTE_SERVER value", () => {
    assert.strictEqual(
      parseAnchorQuoteServerFromToml(toml),
      "https://quotes.anchor.test/sep38"
    );
  });

  test("supports literal strings, inline comments, and CRLF line endings", () => {
    const content =
      "A = 'value # not a comment'\r\n\tANCHOR_QUOTE_SERVER = 'https://quotes.anchor.test' # real comment\r\n";
    assert.strictEqual(
      parseAnchorQuoteServerFromToml(content),
      "https://quotes.anchor.test"
    );
  });

  test("returns undefined when the key is absent or empty", () => {
    assert.strictEqual(parseAnchorQuoteServerFromToml("OTHER = \"x\""), undefined);
    assert.strictEqual(
      parseAnchorQuoteServerFromToml('ANCHOR_QUOTE_SERVER = ""'),
      undefined
    );
  });

  test("rejects unquoted and malformed values", () => {
    assert.throws(
      () => parseAnchorQuoteServerFromToml("ANCHOR_QUOTE_SERVER = https://x"),
      /quoted TOML string/
    );
    assert.throws(
      () => parseAnchorQuoteServerFromToml('ANCHOR_QUOTE_SERVER = "unterminated'),
      /quoted TOML string/
    );
    assert.throws(
      () => parseAnchorQuoteServerFromToml(1 as never),
      /must be a string/
    );
  });
});

describe("discoverAnchorQuoteServer", () => {
  test("fetches stellar.toml from the well-known location", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: toml }));
    const server = await discoverAnchorQuoteServer("anchor.test", { fetch });
    assert.strictEqual(server, "https://quotes.anchor.test/sep38");
    assert.deepStrictEqual(
      calls.map((call) => call.url),
      ["https://anchor.test/.well-known/stellar.toml"]
    );
  });

  test("resolves relative quote servers and preserves explicit HTTP URLs", async () => {
    const { fetch } = mockFetch((url) => {
      if (url.includes("stellar.toml")) {
        return { body: 'ANCHOR_QUOTE_SERVER = "/quotes"' };
      }
      return { body: JSON.stringify(pricePayload) };
    });

    assert.strictEqual(
      await discoverAnchorQuoteServer("http://localhost:8080/base", { fetch }),
      "http://localhost:8080/quotes"
    );
  });

  test("reports discovery failures and unsupported protocols", async () => {
    const notFound = mockFetch(() => ({
      status: 404,
      statusText: "Not Found",
      body: JSON.stringify({ error: "missing toml" }),
    }));
    await assert.rejects(
      discoverAnchorQuoteServer("anchor.test", { fetch: notFound.fetch }),
      /404 Not Found.*missing toml/
    );

    const missingKey = mockFetch(() => ({ body: "NETWORK_PASSPHRASE = \"x\"" }));
    await assert.rejects(
      discoverAnchorQuoteServer("anchor.test", { fetch: missingKey.fetch }),
      /does not declare ANCHOR_QUOTE_SERVER/
    );

    const badProtocol = mockFetch(() => ({
      body: 'ANCHOR_QUOTE_SERVER = "ftp://quotes.anchor.test"',
    }));
    await assert.rejects(
      discoverAnchorQuoteServer("anchor.test", { fetch: badProtocol.fetch }),
      /Unsupported ANCHOR_QUOTE_SERVER protocol/
    );

    await assert.rejects(
      discoverAnchorQuoteServer("", { fetch: badProtocol.fetch }),
      /anchorDomain cannot be empty/
    );
    await assert.rejects(
      discoverAnchorQuoteServer("ftp://anchor.test", {
        fetch: badProtocol.fetch,
      }),
      /Unsupported anchor URL protocol/
    );
  });
});

describe("getAnchorExchangeQuote", () => {
  test("discovers the quote server and returns a typed SEP-38 price", async () => {
    const { fetch, calls } = mockFetch((url) =>
      url.includes("stellar.toml")
        ? { body: toml, statusText: "OK" }
        : { body: JSON.stringify(pricePayload), statusText: "OK" }
    );

    const quote = await getAnchorExchangeQuote(
      "anchor.test",
      "iso4217:USD",
      usdc,
      "102.00",
      { fetch, context: "sep31", countryCode: "US" }
    );

    assert.strictEqual(quote.anchorDomain, "anchor.test");
    assert.strictEqual(quote.quoteServer, "https://quotes.anchor.test/sep38");
    assert.strictEqual(quote.totalPrice, "1.02");
    assert.strictEqual(quote.price, "1.00");
    assert.strictEqual(quote.sellAsset, "iso4217:USD");
    assert.strictEqual(quote.sellAmount, "102.00");
    assert.strictEqual(quote.buyAsset, usdc);
    assert.strictEqual(quote.buyAmount, "100.00");
    assert.deepStrictEqual(quote.fee, {
      total: "2.00",
      asset: "iso4217:USD",
      details: [
        {
          name: "Service fee",
          description: "Anchor conversion fee",
          amount: "2.00",
        },
      ],
    });

    assert.strictEqual(calls.length, 2);
    const priceUrl = new URL(calls[1].url);
    assert.strictEqual(
      `${priceUrl.origin}${priceUrl.pathname}`,
      "https://quotes.anchor.test/sep38/price"
    );
    assert.strictEqual(priceUrl.searchParams.get("sell_asset"), "iso4217:USD");
    assert.strictEqual(priceUrl.searchParams.get("buy_asset"), usdc);
    assert.strictEqual(priceUrl.searchParams.get("sell_amount"), "102.00");
    assert.strictEqual(priceUrl.searchParams.get("context"), "sep31");
    assert.strictEqual(priceUrl.searchParams.get("country_code"), "US");
  });

  test("accepts bigint and number amounts and sends optional headers", async () => {
    const { fetch, calls } = mockFetch((url) =>
      url.includes("stellar.toml")
        ? { body: toml }
        : {
            body: JSON.stringify({
              price: "2",
              sell_amount: "200",
              buy_amount: "100",
            }),
          }
    );

    const quote = await getAnchorExchangeQuote(
      "anchor.test",
      "iso4217:USD",
      usdc,
      100n,
      {
        fetch,
        authToken: "jwt-token",
        headers: { "X-Request-Id": "abc-123" },
        sellDeliveryMethod: "PIX",
        buyDeliveryMethod: "ACH",
      }
    );

    assert.strictEqual(quote.totalPrice, "2");
    assert.strictEqual(quote.fee, undefined);

    const priceUrl = new URL(calls[1].url);
    assert.strictEqual(priceUrl.searchParams.get("sell_amount"), "100");
    assert.strictEqual(priceUrl.searchParams.get("sell_delivery_method"), "PIX");
    assert.strictEqual(priceUrl.searchParams.get("buy_delivery_method"), "ACH");
    assert.deepStrictEqual(calls[1].init?.headers, {
      Accept: "application/json",
      Authorization: "Bearer jwt-token",
      "X-Request-Id": "abc-123",
    });
  });

  test("rejects invalid request inputs before fetching", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: toml }));

    await assert.rejects(
      getAnchorExchangeQuote("", "iso4217:USD", usdc, "1", { fetch }),
      /anchorDomain cannot be empty/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "", usdc, "1", { fetch }),
      /fromAsset cannot be empty/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", "  ", "1", { fetch }),
      /toAsset cannot be empty/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, "-1", { fetch }),
      /Invalid quote amount/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, Number.NaN, {
        fetch,
      }),
      /Invalid quote amount/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, 1e21, { fetch }),
      /Scientific notation/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, "1,000", {
        fetch,
      }),
      /Invalid quote amount/
    );
    assert.strictEqual(calls.length, 0);
  });

  test("surfaces anchor error responses without leaking raw failures", async () => {
    const { fetch } = mockFetch((url) =>
      url.includes("stellar.toml")
        ? { body: toml }
        : {
            status: 400,
            statusText: "Bad Request",
            body: JSON.stringify({ error: "asset pair is not supported" }),
          }
    );

    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", "iso4217:EUR", "1", {
        fetch,
      }),
      /400 Bad Request.*asset pair is not supported/
    );
  });

  test("treats null optional total_price and fee values as absent", async () => {
    const { fetch } = mockFetch((url) =>
      url.includes("stellar.toml")
        ? { body: toml }
        : {
            body: JSON.stringify({
              price: "3",
              total_price: null,
              sell_amount: "3",
              buy_amount: "1",
              fee: null,
            }),
          }
    );

    const quote = await getAnchorExchangeQuote(
      "anchor.test",
      "iso4217:USD",
      usdc,
      "3",
      { fetch }
    );
    assert.strictEqual(quote.totalPrice, "3");
    assert.strictEqual(quote.fee, undefined);
  });

  test("rejects malformed price responses", async () => {
    const response = (body: string) =>
      mockFetch((url) => (url.includes("stellar.toml") ? { body: toml } : { body }));

    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, "1", {
        fetch: response("not json").fetch,
      }),
      /not valid JSON/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, "1", {
        fetch: response(JSON.stringify({ price: "1" })).fetch,
      }),
      /sell_amount/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, "1", {
        fetch: response(
          JSON.stringify({
            price: "1",
            sell_amount: "1",
            buy_amount: "1",
            fee: { total: "0.1", asset: "iso4217:USD", details: "nope" },
          })
        ).fetch,
      }),
      /fee.details/
    );
    await assert.rejects(
      getAnchorExchangeQuote("anchor.test", "iso4217:USD", usdc, "1", {
        fetch: response(JSON.stringify([])).fetch,
      }),
      /must be a JSON object/
    );
  });
});
