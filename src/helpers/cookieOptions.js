export function getOptions(req) {
    const hostname = req.hostname;
    const protocol = req.protocol;
  
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  
    return {
      httpOnly: true,
      secure: protocol === "https",             // True if request came over HTTPS
      sameSite: isLocalhost ? "Lax" : "None",   // Lax works for dev, None for cross-domain
    };
  }
  