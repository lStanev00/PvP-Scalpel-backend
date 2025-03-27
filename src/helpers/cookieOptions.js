export function getOptions(req) {
  const hostname = req.hostname;
  const protocol = req.protocol;

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(hostname);

  const options = {
    httpOnly: true,
    secure: protocol === "https", // Required for SameSite=None
    sameSite: isLocalhost ? "Lax" : "None", // Lax for localhost dev
    maxAge: 15 * 24 * 60 * 60 * 1000 // 15 days
  };

  if (!isLocalhost) {
    options.domain = ".pvpscalpel.com"; // Enable cross-subdomain access
  }

  return options;
}
