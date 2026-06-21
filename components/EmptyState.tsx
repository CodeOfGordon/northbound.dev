import { CalendarX2 } from 'lucide-react';

interface Props {
    title?: string;
    hint?: string;
}

const EmptyState = ({ title = 'No events found', hint = 'Try widening your filters or check back after the next scrape.' }: Props) => (
    <div className="border-border-dark flex-center bg-dark-100/40 flex-col gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
        <CalendarX2 className="text-light-200 size-10" aria-hidden />
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-light-200 text-sm">{hint}</p>
    </div>
);

export default EmptyState;
