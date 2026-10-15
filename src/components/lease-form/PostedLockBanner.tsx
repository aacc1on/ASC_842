import { Lock, ArrowRight } from 'lucide-react';
import { parseLocalDate } from '../../utils/formatting';

function formatPostedMonth(postedThrough: string): string {
  return parseLocalDate(postedThrough).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function PostedLockBanner({ postedThrough }: { postedThrough: string }) {
  return (
    <div role="status" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-amber-100 p-1.5">
          <Lock className="h-4 w-4 text-amber-700" />
        </div>
        <div className="flex-1">
          <span className="inline-flex items-center rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            Posted through {formatPostedMonth(postedThrough)}
          </span>
          <p className="mt-2 text-sm leading-relaxed text-amber-900">
            Accounting fields are locked because this lease has posted periods. You can still update the name,
            description, lessor and branch. To change dates, payments, rates or classification, use Contract Modification.
          </p>
          <a
            href="/modifications"
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-amber-800 underline-offset-2 transition hover:text-amber-950 hover:underline"
          >
            Go to Contract Modification
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
