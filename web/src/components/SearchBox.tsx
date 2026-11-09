import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Suggestion {
  spec: string;
  label: string;
  kind: 'drug' | 'resource' | 'specialist' | 'facility';
}

const KIND_LABEL = { drug: 'Medicine', resource: 'Hospital resource', specialist: 'Specialist', facility: 'Place' };

/**
 * Free-text search with typo-tolerant suggestions (US-02). Submitting the form searches the
 * typed words; picking a suggestion searches that exact target.
 */
export function SearchBox({
  initial = '',
  onSearch,
  compact = false,
  id = 'q',
  value,
  onChange,
}: {
  initial?: string;
  onSearch?: (q: { q?: string; target?: string }) => void;
  compact?: boolean;
  id?: string;
  /** Controlled mode: the parent owns the text and the submit button. */
  value?: string;
  onChange?: (text: string, target?: string) => void;
}) {
  const [own, setOwn] = useState(initial);
  const text = value ?? own;
  const setText = (t: string, target?: string) => (onChange ? onChange(t, target) : setOwn(t));
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    if (value === undefined) setOwn(initial);
  }, [initial, value]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (text.trim().length < 2) return setItems([]);
    const ctrl = new AbortController();
    timer.current = window.setTimeout(() => {
      api<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(text)}`, { signal: ctrl.signal })
        .then((s) => {
          setItems(s);
          setActive(-1);
        })
        .catch(() => {});
    }, 180);
    return () => ctrl.abort();
  }, [text]);

  const choose = (s: Suggestion) => {
    setText(s.label, s.spec);
    setOpen(false);
    onSearch?.({ target: s.spec, q: s.label });
  };

  const input = (
    <div className="suggest-wrap">
      <input
        id={id}
        type="search"
        autoComplete="off"
        className="filled"
        placeholder={compact ? 'Drug, equipment or specialist' : 'e.g. Insulin glargine, oxygen, cardiologist'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, -1));
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && active >= 0 && items[active]) {
            e.preventDefault();
            choose(items[active]);
          }
        }}
        aria-label="What do you need?"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-suggestions`}
        role="combobox"
      />
      {open && items.length > 0 && (
        <div className="suggestions" id={`${id}-suggestions`} role="listbox">
          {items.map((s, i) => (
            <button type="button" key={s.spec} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={() => choose(s)}>
              <span>{s.label}</span>
              <span className="small muted">{KIND_LABEL[s.kind]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!onSearch) return input;
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          setOpen(false);
          onSearch({ q: text.trim() });
        }
      }}
    >
      {input}
    </form>
  );
}
