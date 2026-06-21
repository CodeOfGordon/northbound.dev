'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Custom smooth (eased/momentum) scrolling via Lenis. Lenis v1 eases the *native*
 * window scroll with a rAF loop, so position:sticky/fixed and the scroll-driven
 * reveal animations keep working — and it stays at 60fps (no transform hijack that
 * would jank). Disabled for reduced-motion users; touch stays native (no lag).
 */
export default function SmoothScroll() {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const lenis = new Lenis({
            lerp: 0.1, // 10%/frame toward target — smooth but still tracks the wheel closely
            smoothWheel: true,
            wheelMultiplier: 1,
        });

        let rafId = 0;
        const raf = (time: number) => {
            lenis.raf(time);
            rafId = requestAnimationFrame(raf);
        };
        rafId = requestAnimationFrame(raf);

        // Smooth-scroll in-page anchor links (e.g. the hero "Explore events" → #events)
        // through Lenis instead of an abrupt native jump.
        const onClick = (e: MouseEvent) => {
            const anchor = (e.target as HTMLElement)?.closest?.('a[href^="#"]');
            const href = anchor?.getAttribute('href');
            if (!href || href.length < 2) return;
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                lenis.scrollTo(target as HTMLElement, { offset: -96 });
            }
        };
        document.addEventListener('click', onClick);

        return () => {
            document.removeEventListener('click', onClick);
            cancelAnimationFrame(rafId);
            lenis.destroy();
        };
    }, []);

    return null;
}
