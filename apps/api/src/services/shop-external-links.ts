export type ParsedDianpingUrl = {
  externalUrl: string;
  externalShopId: string | null;
};

export class InvalidDianpingUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDianpingUrlError";
  }
}

const DIANPING_SHOP_PATH = /^\/shop\/([A-Za-z0-9]+)\/?$/;

export function parseDianpingUrl(input: string): ParsedDianpingUrl {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new InvalidDianpingUrlError(
      "Dianping URL must contain 1 to 2048 characters",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidDianpingUrlError("Dianping URL is invalid");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isDianpingHost =
    hostname === "dianping.com" || hostname.endsWith(".dianping.com");
  if (
    parsed.protocol !== "https:" ||
    !isDianpingHost ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new InvalidDianpingUrlError(
      "Only HTTPS links on dianping.com are allowed",
    );
  }

  parsed.hostname = hostname;
  parsed.hash = "";
  const shopPath = DIANPING_SHOP_PATH.exec(parsed.pathname);
  return {
    externalUrl: parsed.toString(),
    externalShopId: shopPath?.[1] ?? null,
  };
}
