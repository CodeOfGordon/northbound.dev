const Card = () => (
    <li className="bg-dark-100/60 border-border-dark flex w-[280px] shrink-0 flex-col gap-3 rounded-xl border p-3 sm:w-[300px]">
        <div className="bg-dark-200 h-40 w-full animate-pulse rounded-lg" />
        <div className="bg-dark-200 h-4 w-3/4 animate-pulse rounded" />
        <div className="bg-dark-200 h-3 w-1/2 animate-pulse rounded" />
    </li>
);

/** Home-page skeleton — mirrors app/page.tsx: hero, then a single section rail. */
const Loading = () => (
    <section className="flex flex-col gap-24">
        <div className="flex flex-col items-center pt-12 text-center max-sm:pt-6">
            <div className="bg-dark-100/60 h-7 w-64 animate-pulse rounded-full" />
            <div className="bg-dark-100/60 mt-6 h-12 w-2/3 max-w-3xl animate-pulse rounded-lg" />
            <div className="bg-dark-100/60 mt-5 h-5 w-full max-w-2xl animate-pulse rounded-lg" />

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <div className="bg-dark-100/60 h-12 w-48 animate-pulse rounded-full" />
                <div className="bg-dark-100/60 h-12 w-40 animate-pulse rounded-full" />
            </div>
        </div>

        <div className="flex flex-col gap-6">
            <div className="bg-dark-100/60 h-8 w-48 animate-pulse rounded-lg" />
            <ul className="no-scrollbar flex list-none gap-4 overflow-hidden">
                {Array.from({ length: 4 }, (_, i) => (
                    <Card key={i} />
                ))}
            </ul>
        </div>
    </section>
);

export default Loading;
