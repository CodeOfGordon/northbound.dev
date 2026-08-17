/** Detail-page skeleton — mirrors app/events/[slug]/page.tsx so resolve doesn't jump. */
const Loading = () => (
    <section className="flex flex-col gap-14">
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
                <div className="bg-dark-100/60 h-7 w-24 animate-pulse rounded-full" />
                <div className="bg-dark-100/60 h-7 w-20 animate-pulse rounded-full" />
                <div className="bg-dark-100/60 h-7 w-28 animate-pulse rounded-full" />
            </div>

            <div className="bg-dark-100/60 h-12 w-3/4 animate-pulse rounded-lg" />
            <div className="bg-dark-100/60 h-5 w-48 animate-pulse rounded-lg" />
        </div>

        <div className="flex flex-col items-start gap-12 lg:flex-row">
            <div className="flex w-full flex-[2] flex-col gap-8">
                <div className="bg-dark-200 h-[420px] w-full animate-pulse rounded-xl" />
                <div className="flex flex-col gap-3">
                    <div className="bg-dark-200 h-4 w-full animate-pulse rounded" />
                    <div className="bg-dark-200 h-4 w-5/6 animate-pulse rounded" />
                    <div className="bg-dark-200 h-4 w-2/3 animate-pulse rounded" />
                </div>
            </div>

            <aside className="w-full flex-1 lg:sticky lg:top-24">
                <div className="bg-dark-100/60 border-border-dark flex w-full flex-col gap-5 rounded-xl border p-5">
                    <div className="flex flex-col gap-3">
                        <div className="bg-dark-200 h-5 w-full animate-pulse rounded" />
                        <div className="bg-dark-200 h-5 w-5/6 animate-pulse rounded" />
                        <div className="bg-dark-200 h-5 w-2/3 animate-pulse rounded" />
                        <div className="bg-dark-200 h-5 w-3/4 animate-pulse rounded" />
                    </div>
                    <div className="bg-dark-200 h-12 w-full animate-pulse rounded-lg" />
                </div>
            </aside>
        </div>
    </section>
);

export default Loading;
