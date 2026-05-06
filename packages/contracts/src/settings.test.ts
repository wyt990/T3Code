import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_FALLBACK_URL,
  buildProxyProcessEnv,
  resolveEffectiveProxyUrls,
} from "./settings.ts";

describe("proxy settings", () => {
  it("resolveEffectiveProxyUrls uses fallback when enabled and fields empty", () => {
    expect(resolveEffectiveProxyUrls({ enabled: true, httpProxy: "", httpsProxy: "" })).toEqual({
      httpProxy: DEFAULT_PROXY_FALLBACK_URL,
      httpsProxy: DEFAULT_PROXY_FALLBACK_URL,
    });
  });

  it("resolveEffectiveProxyUrls trims and falls back https from http", () => {
    expect(
      resolveEffectiveProxyUrls({
        enabled: true,
        httpProxy: "  http://a:1  ",
        httpsProxy: "",
      }),
    ).toEqual({ httpProxy: "http://a:1", httpsProxy: "http://a:1" });
  });

  it("buildProxyProcessEnv is empty when disabled", () => {
    expect(buildProxyProcessEnv({ enabled: false, httpProxy: "", httpsProxy: "" })).toEqual({});
  });

  it("buildProxyProcessEnv sets four vars when enabled with empty URLs", () => {
    expect(buildProxyProcessEnv({ enabled: true, httpProxy: "", httpsProxy: "" })).toEqual({
      http_proxy: DEFAULT_PROXY_FALLBACK_URL,
      HTTP_PROXY: DEFAULT_PROXY_FALLBACK_URL,
      https_proxy: DEFAULT_PROXY_FALLBACK_URL,
      HTTPS_PROXY: DEFAULT_PROXY_FALLBACK_URL,
    });
  });
});
