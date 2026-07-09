export function buildContentSecurityPolicy({ isProduction = false } = {}) {
  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["script-src", "'self'"],
    ["style-src", "'self'", "https://fonts.googleapis.com"],
    ["font-src", "'self'", "https://fonts.gstatic.com", "data:"],
    ["img-src", "'self'", "data:"],
    ["connect-src", "'self'"],
    ["form-action", "'self'"]
  ];

  if (isProduction) directives.push(["upgrade-insecure-requests"]);

  return directives.map((directive) => directive.join(" ")).join("; ");
}

export function securityHeaders({ isProduction = false } = {}) {
  const contentSecurityPolicy = buildContentSecurityPolicy({ isProduction });

  return (_req, res, next) => {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    next();
  };
}
