import React, { useState } from 'react';
import { Search, User } from 'lucide-react';

// Plain search input + filtered result list rather than a Select dropdown —
// Radix Select in this app has no built-in text filtering, and a big
// tappable list reads better at presentation scale than a cramped dropdown.
export default function EmployeePicker({ employees, onPick, placeholder = 'Search employees…' }) {
  const [query, setQuery] = useState('');

  const results = query.trim()
    ? employees.filter((e) => {
        const q = query.trim().toLowerCase();
        return (e.full_name || '').toLowerCase().includes(q) || (e.employee_number || '').toLowerCase().includes(q) || (e.classification || '').toLowerCase().includes(q);
      })
    : employees;

  return (
    <div>
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full h-12 pl-11 pr-4 rounded-lg bg-slate-900 border border-slate-700 text-white text-lg placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
        {results.length === 0 ? (
          <p className="text-slate-500 text-base px-4 py-4">No active employees match "{query}".</p>
        ) : (
          results.slice(0, 50).map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => { onPick(e); setQuery(''); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800 transition-colors focus:outline-none focus-visible:bg-slate-800"
            >
              <User className="w-5 h-5 text-slate-500 flex-shrink-0" aria-hidden="true" />
              <span className="text-lg font-medium">{e.full_name}</span>
              {e.classification && <span className="text-sm text-slate-400">{e.classification}</span>}
              <span className="text-sm text-slate-500 ml-auto">{e.employee_number}</span>
            </button>
          ))
        )}
        {results.length > 50 && <p className="text-xs text-slate-500 px-4 py-2">Showing first 50 of {results.length} matches — refine your search.</p>}
      </div>
    </div>
  );
}
