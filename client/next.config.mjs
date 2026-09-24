import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  webpack(config) {
    // The vendored shared contracts (src/vendor/shared) are the server's
    // TypeScript source vendored byte-identical (X1 gate) and use the ESM
    // `.js`-extension import style (`export * from './contracts/findings.js'`).
    // tsc and vitest map `.js` → `.ts` natively; webpack only does so via
    // extensionAlias, which Next does not set for app code. The first RUNTIME
    // import of the barrel (reviews.ts importing the RunEvent schema, F20/X2)
    // exposed this — type-only imports are erased and never hit the resolver.
    // Keep in sync if the project ever moves to `next dev --turbopack`
    // (turbopack ignores this hook; it resolves .js→.ts natively).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
