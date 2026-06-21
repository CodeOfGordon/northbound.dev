import type { MetadataRoute } from 'next';

/** PWA manifest — makes the site installable with the new brand icons. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Northbound',
        short_name: 'Northbound',
        description: 'Official dev events, hackathons & meetups across North America — one clean feed.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0b0d',
        theme_color: '#0a0b0d',
        icons: [
            { src: '/icons/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
    };
}
