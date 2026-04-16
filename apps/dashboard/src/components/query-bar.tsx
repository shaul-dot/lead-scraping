'use client';

import { useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import clsx from 'clsx';

export function QueryBar() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data.answer ?? 'No answer available.');
      } else {
        setResult('Query failed. Please try again.');
      }
    } catch {
      setResult('Unable to reach the query API.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <Search className="absolute left-3 h-4 w-4 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything..."
          className={clsx(
            'h-10 w-full rounded-lg border border-border bg-surface-light pl-10 pr-10 text-sm',
            'text-text-primary placeholder:text-text-muted outline-none',
            'transition-colors duration-200 focus:border-primary/50 focus:ring-1 focus:ring-primary/30'
          )}
        />
        {loading && <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-text-muted" />}
        {result && !loading && (
          <button
            type="button"
            onClick={() => setResult(null)}
            className="absolute right-3 text-text-muted hover:text-text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>
      {result && (
        <div className="mt-2 rounded-lg border border-border bg-surface-light p-3 text-sm text-text-secondary">
          {result}
        </div>
      )}
    </div>
  );
}
