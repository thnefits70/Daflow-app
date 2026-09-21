"use client";

import { useEffect, useState } from "react";
import { RocketRequestPanel } from "./RocketRequestPanel";
import { DropiRequestPanel } from "./DropiRequestPanel";
import { CompiledResult, FulfillmentHistoryList, type CompiledBatch, type BatchListItem } from "./fulfillmentRequestShared";

export function FulfillmentRequestPanel({ canSubmit }: { canSubmit: boolean }) {
  const [result, setResult] = useState<CompiledBatch | null>(null);
  const [history, setHistory] = useState<BatchListItem[]>([]);

  function loadHistory() {
    fetch("/api/fulfillment-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, []);

  async function showBatch(id: string) {
    const detail = await fetch(`/api/fulfillment-requests/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) setResult(detail);
  }

  function handleApplied(batchId: string) {
    loadHistory();
    showBatch(batchId);
  }

  return (
    <div>
      {result && <CompiledResult key={result.id} batch={result} canEditVariants={canSubmit} />}

      {canSubmit && (
        <div className="flex flex-col gap-6 mb-5">
          <RocketRequestPanel onApplied={handleApplied} />
          <DropiRequestPanel onApplied={handleApplied} />
        </div>
      )}

      <FulfillmentHistoryList history={history} onView={showBatch} />
    </div>
  );
}
