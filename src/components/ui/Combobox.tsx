"use client";

import { useEffect, useRef, useState } from "react";

// Same "type or pick an existing one" input used for stockout products and
// warranty categories — a native <input list> datalist grows into an
// unbounded, unstyled browser list as more options are added, so this keeps
// the same autocomplete behavior but inside a fixed-height, scrollable panel.
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = options.filter((o) => o.toLowerCase().includes(value.trim().toLowerCase()));

  return (
    <div ref={rootRef} className="relative">
      <input
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-surface border border-rule rounded-md shadow-lg">
          {filtered.map((name) => (
            <button
              key={name}
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-[12.5px] hover:bg-cloud cursor-pointer border-b border-rule last:border-b-0"
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
