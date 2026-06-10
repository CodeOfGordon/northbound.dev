const Skeleton = () => (
    <div className="bg-dark-100/60 border-dark-200 h-80 animate-pulse rounded-xl border" />
);

const Loading = () => (
    <section className="flex flex-col gap-6">
        <div className="bg-dark-100/60 h-10 w-56 animate-pulse rounded-lg" />
        <div className="bg-dark-100/40 border-dark-200 h-20 animate-pulse rounded-xl border" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} />
            ))}
        </div>
    </section>
);

export default Loading;
