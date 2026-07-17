"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

export type ComboboxOption = { id: string; name: string; usageCount?: number };

// Same "type or pick an existing one" input used for stockout products and
// warranty categories — a native <input list> datalist grows into an
// unbounded, unstyled browser list as more options are added, so this keeps
// the same autocomplete behavior but inside a fixed-height, scrollable panel.
// When onDelete is provided, each row also gets a permanent-delete option —
// blocked (grayed out) if usageCount > 0, since deleting a catalog entry
// that's already anchored to real weeks/months would silently wipe that
// history too.
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  onDelete,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  onDelete?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingDeleteId(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = options.filter((o) => o.name.toLowerCase().includes(value.trim().toLowerCase()));

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
          {filtered.map((opt) => {
            const inUse = (opt.usageCount ?? 0) > 0;
            return (
              <div
                key={opt.id}
                className="flex items-center border-b border-rule last:border-b-0 hover:bg-cloud"
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left px-2.5 py-1.5 text-[12.5px] cursor-pointer truncate"
                  onClick={() => {
                    onChange(opt.name);
                    setOpen(false);
                  }}
                >
                  {opt.name}
                </button>
                {onDelete &&
                  (confirmingDeleteId === opt.id ? (
                    <span className="flex items-center gap-1 pr-2 text-[11px] shrink-0">
                      <button
                        type="button"
                        className="text-red font-semibold cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(opt.id);
                          setConfirmingDeleteId(null);
                        }}
                      >
                        Sí
                      </button>
                      <button
                        type="button"
                        className="text-steel cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmingDeleteId(null);
                        }}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={inUse}
                      title={inUse ? `No se puede eliminar: tiene ${opt.usageCount} registro(s) de historial guardado.` : "Eliminar permanentemente"}
                      className={`pr-2.5 shrink-0 ${inUse ? "text-steel/40 cursor-not-allowed" : "text-steel hover:text-red cursor-pointer"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!inUse) setConfirmingDeleteId(opt.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
