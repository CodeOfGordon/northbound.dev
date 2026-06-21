/**
 * Calm, static page backdrop — replaces the animated WebGL light rays.
 * A single soft mint glow up top plus a faint grid, both very low contrast,
 * so the page reads as quiet depth rather than motion. No JS, no canvas.
 */
const Backdrop = () => (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">
        {/* soft accent glow, top-center — a radial-gradient (no filter blur, which is
            very expensive to re-composite during scroll). */}
        <div
            className="absolute left-1/2 top-[-22rem] h-[44rem] w-[72rem] -translate-x-1/2"
            style={{ background: 'radial-gradient(closest-side, rgba(89,222,202,0.14), transparent 70%)' }}
        />
        {/* faint grid */}
        <div
            className="absolute inset-0 opacity-[0.16]"
            style={{
                backgroundImage:
                    'linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)',
                backgroundSize: '56px 56px',
                maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, #000 30%, transparent 80%)',
                WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, #000 30%, transparent 80%)',
            }}
        />
    </div>
);

export default Backdrop;
