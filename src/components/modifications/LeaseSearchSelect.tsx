import { useState } from 'react';
import { Search, CheckCircle } from 'lucide-react';
import type { Lease } from './types';

interface LeaseSearchSelectProps {
  leases: Lease[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function LeaseSearchSelect({
  leases, value, onChange, placeholder = 'Search leases by name...', required,
}: LeaseSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = leases.find(l => l.id === value) ?? null;

  const filtered = query.trim()
    ? leases.filter(l => l.lease_name.toLowerCase().includes(query.trim().toLowerCase()))
    : leases;

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-2 w-full px-3 py-3 border rounded-lg bg-white cursor-text transition ${
          open ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-300 hover:border-slate-400'
        }`}
        onClick={() => setOpen(true)}
      >
        <Search className="w-4 h-4 text-slate-500 shrink-0" />
        <input
          type="text"
          value={open ? query : (selected?.lease_name ?? '')}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="flex-1 outline-none bg-transparent text-sm text-slate-900 placeholder:text-slate-500"
        />
        {selected && !open && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); setQuery(''); }}
            className="text-slate-500 hover:text-slate-600 text-xs font-bold px-1"
            aria-label="Clear"
          >
            ×
          </button>
        )}
      </div>
      {/* Hidden input to satisfy native required validation */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => {}}
          className="sr-only"
          style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
        />
      )}
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">No leases match "{query}"</div>
          ) : (
            filtered.map(l => (
              <button
                key={l.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(l.id); setQuery(''); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center justify-between gap-3 ${
                  l.id === value ? 'bg-blue-50 text-blue-900 font-semibold' : 'text-slate-700'
                }`}
              >
                <span className="truncate">{l.lease_name}</span>
                {l.id === value && <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
