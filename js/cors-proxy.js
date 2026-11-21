/**
 * Routes a request through a user-provided CORS proxy.
 * "{url}" in the proxy address is replaced with the encoded target URL ("https://proxy.example/?url={url}");
 * without it the target URL is appended as is ("https://proxy.example/https://target...").
 */
export function withCorsProxy(url, corsProxy) {
  const proxy = String(corsProxy || "").trim();
  if (!proxy) return url;
  return proxy.includes("{url}") ? proxy.replace("{url}", encodeURIComponent(url)) : `${proxy}${url}`;
}
