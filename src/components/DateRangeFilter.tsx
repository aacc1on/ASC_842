import { CalendarDays, Check, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';

interface DateRangeFilterProps {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  fromLabel?: string;
  toLabel?: string;
  className?: string;
}

interface RangeDraft {
  from: string;
  to: string;
}

type ActiveField = 'from' | 'to';

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return undefined;
  }

  return date;
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatInputDate(value: string): string {
  const date = parseLocalDate(value);
  return date ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}` : '';
}

function parseInputDate(value: string): string | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return undefined;

  const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  if (
    date.getFullYear() !== Number(match[3]) ||
    date.getMonth() !== Number(match[1]) - 1 ||
    date.getDate() !== Number(match[2])
  ) {
    return undefined;
  }

  return formatLocalDate(date);
}

function getDefaultMonth(from: string, to: string): Date {
  return parseLocalDate(from) ?? parseLocalDate(to) ?? new Date();
}

export function DateRangeFilter({
  from,
  to,
  onApply,
  fromLabel = 'From',
  toLabel = 'To',
  className = '',
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>('from');
  const [draft, setDraft] = useState<RangeDraft>({ from, to });
  const [fromText, setFromText] = useState(() => formatInputDate(from));
  const [toText, setToText] = useState(() => formatInputDate(to));
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft({ from, to });
    setFromText(formatInputDate(from));
    setToText(formatInputDate(to));
  }, [from, to]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        window.requestAnimationFrame(() => {
          (activeField === 'from' ? fromRef : toRef).current?.focus();
        });
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeField, open]);

  const validateRange = (range: RangeDraft): string => {
    if (range.from && !parseLocalDate(range.from)) return `${fromLabel} date is invalid.`;
    if (range.to && !parseLocalDate(range.to)) return `${toLabel} date is invalid.`;
    if (range.from && range.to && range.from > range.to) return `${fromLabel} date must be on or before the ${toLabel.toLowerCase()} date.`;
    return '';
  };

  const applyRange = (range: RangeDraft) => {
    const validationError = validateRange(range);
    if (validationError) {
      setError(validationError);
      return false;
    }

    setDraft(range);
    setFromText(formatInputDate(range.from));
    setToText(formatInputDate(range.to));
    onApply(range.from, range.to);
    setError('');
    return true;
  };

  const getTextRange = (): RangeDraft | undefined => {
    const fromValue = fromText.trim() === '' ? '' : parseInputDate(fromText);
    const toValue = toText.trim() === '' ? '' : parseInputDate(toText);
    if (fromValue === undefined) {
      setError(`${fromLabel} date must use MM/DD/YYYY.`);
      return undefined;
    }
    if (toValue === undefined) {
      setError(`${toLabel} date must use MM/DD/YYYY.`);
      return undefined;
    }
    return { from: fromValue, to: toValue };
  };

  const commitText = () => {
    const nextRange = getTextRange();
    if (nextRange) applyRange(nextRange);
  };

  const handleCalendarSelect = (range: DateRange | undefined) => {
    const nextRange = {
      from: range?.from ? formatLocalDate(range.from) : '',
      to: range?.to ? formatLocalDate(range.to) : '',
    };
    setDraft(nextRange);
    setFromText(formatInputDate(nextRange.from));
    setToText(formatInputDate(nextRange.to));
    setError(validateRange(nextRange));
    if (range?.from && !range.to) setActiveField('to');
  };

  const handleClear = () => {
    setDraft({ from: '', to: '' });
    setFromText('');
    setToText('');
    setError('');
    onApply('', '');
    setOpen(false);
  };

  const selectedRange: DateRange | undefined = draft.from
    ? { from: parseLocalDate(draft.from), to: parseLocalDate(draft.to) }
    : undefined;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <DateTextField
          id="date-range-from"
          label={fromLabel}
          value={fromText}
          inputRef={fromRef}
          onFocus={() => setActiveField('from')}
          onChange={setFromText}
          onCommit={commitText}
          onOpen={() => {
            setActiveField('from');
            setOpen(true);
          }}
        />
        <DateTextField
          id="date-range-to"
          label={toLabel}
          value={toText}
          inputRef={toRef}
          onFocus={() => setActiveField('to')}
          onChange={setToText}
          onCommit={commitText}
          onOpen={() => {
            setActiveField('to');
            setOpen(true);
          }}
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(100vw-32px,352px)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl" role="dialog" aria-label="Choose date range">
          <DayPicker
            mode="range"
            selected={selectedRange}
            onSelect={handleCalendarSelect}
            defaultMonth={getDefaultMonth(draft.from, draft.to)}
            captionLayout="dropdown"
            startMonth={new Date(2000, 0)}
            endMonth={new Date(2100, 11)}
            aria-label="Calendar"
            classNames={{
              months: 'flex flex-col',
              month: 'space-y-3',
              month_caption: 'flex items-center justify-center gap-2 h-9',
              caption_label: 'text-sm font-semibold text-slate-800',
              dropdowns: 'flex items-center gap-2',
              dropdown: 'rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700',
              nav: 'flex items-center justify-between absolute inset-x-2 top-3',
              button_previous: 'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900',
              button_next: 'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900',
              month_grid: 'w-full border-collapse',
              weekdays: 'flex',
              weekday: 'w-9 text-center text-xs font-semibold text-slate-400',
              week: 'flex w-full mt-1',
              day: 'relative h-9 w-9 p-0 text-center text-sm',
              day_button: 'h-9 w-9 rounded-md text-slate-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500',
              selected: 'bg-blue-600 text-white hover:bg-blue-700',
              range_start: 'rounded-l-md bg-blue-600 text-white',
              range_end: 'rounded-r-md bg-blue-600 text-white',
              range_middle: 'bg-blue-50 text-blue-900',
              today: 'font-bold text-blue-700',
              outside: 'text-slate-300',
            }}
          />
          {error && <p className="mt-2 text-xs font-medium text-red-600" role="alert">{error}</p>}
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <button type="button" onClick={handleClear} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              <X className="h-4 w-4" />
              Clear
            </button>
            <button type="button" onClick={() => {
                const nextRange = getTextRange();
                if (nextRange) applyRange(nextRange);
              }} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
              <Check className="h-4 w-4" />
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface DateTextFieldProps {
  id: string;
  label: string;
  value: string;
  inputRef: RefObject<HTMLInputElement>;
  onFocus: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
  onOpen: () => void;
}

function DateTextField({ id, label, value, inputRef, onFocus, onChange, onCommit, onOpen }: DateTextFieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</label>
      <div className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          aria-label={label}
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit();
            }
          }}
          className="min-w-0 flex-1 rounded-l-lg border-0 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-0"
        />
        <button type="button" aria-label={`Open ${label.toLowerCase()} calendar`} onClick={onOpen} className="rounded-r-lg p-2 text-slate-500 hover:bg-slate-50 hover:text-blue-600">
          <CalendarDays className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
