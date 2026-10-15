import type { MetadataRoute } from 'next';

// Installable PWA manifest. Name stays generic (discretion rule).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'My Fit Brain',
    short_name: 'My Fit Brain',
    description: 'Private, structured assessments with qualified counsellors.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'en',
    dir: 'ltr',
    theme_color: '#145A5A',
    background_color: '#FBF7F2',
    categories: ['health', 'lifestyle'],
    icons: [
      { src: '/android-chrome-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
