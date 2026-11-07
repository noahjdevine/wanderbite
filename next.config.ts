import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { buildSecurityHeaderSources } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ['happy-dom'],
  experimental: {
    serverActions: {
      // Multipart framing sits on top of the 10,000,000-byte receipt cap.
      // The action still refuses a file over that cap.
      bodySizeLimit: 12_000_000,
    },
  },
  env: {
    NEXT_PUBLIC_POSTHOG_HOST: process.env.POSTHOG_HOST,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      {
        protocol: "https",
        hostname: "yiajoycgiyxjvznndjge.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    contentSecurityPolicy:
      "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return buildSecurityHeaderSources({
      nodeEnv: process.env.NODE_ENV,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      posthogHost:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || process.env.POSTHOG_HOST,
      sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      mapTilesUrl: process.env.NEXT_PUBLIC_MAP_TILES_URL,
    });
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});
