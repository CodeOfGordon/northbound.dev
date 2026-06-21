const Row = () => (
    <div className="bg-dark-100/60 border-border-dark flex items-center gap-4 rounded-xl border p-2.5">
        <div className="bg-dark-200 h-14 w-20 shrink-0 animate-pulse rounded-lg max-sm:hidden" />
        <div className="flex flex-1 flex-col gap-2">
            <div className="bg-dark-200 h-4 w-2/3 animate-pulse rounded" />
            <div className="bg-dark-200 h-3 w-1/3 animate-pulse rounded" />
        </div>
    </div>
);

const Loading = () => (
    <section className="flex flex-col gap-6">
        <div className="bg-dark-100/60 h-10 w-56 animate-pulse rounded-lg" />
        <div className="flex items-center justify-between">
            <div className="bg-dark-100/60 h-9 w-72 animate-pulse rounded-lg" />
            <div className="bg-dark-100/60 h-9 w-28 animate-pulse rounded-full" />
        </div>
        <div className="flex flex-col gap-2.5">
            {Array.from({ length: 6 }, (_, i) => (
                <Row key={i} />
            ))}
        </div>
    </section>
);

export default Loading;
