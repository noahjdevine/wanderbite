import type { MetadataRoute } from 'next';

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'https://wanderbite.co';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/roulette',
          '/restaurants',
          '/how-it-works',
          '/pricing',
          '/contact',
          '/privacy',
          '/terms',
          '/rules',
        ],
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/account',
          '/billing',
          '/dashboard',
          '/challenges',
          '/journey',
          '/journal',
          '/passport',
          '/onboarding',
          '/checkout',
          '/checkout/',
          '/partner',
          '/partner/',
          '/suggest',
          '/success',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
