import { Quote } from "lucide-react";
import { getDailyQuote } from "@/lib/dailyQuote";

// Shown at the top of Inicio (admin and every employee see the same one
// that day) — rotates daily via getDailyQuote(), no interactivity needed.
export function DailyQuoteBanner() {
  const quote = getDailyQuote();
  return (
    <div className="flex flex-col items-center text-center gap-1.5 mb-7 px-4">
      <Quote size={16} className="text-teal" />
      <p className="font-display text-[15px] italic text-ink max-w-xl leading-snug">&ldquo;{quote.text}&rdquo;</p>
      <span className="text-[11.5px] text-steel">— {quote.author}</span>
    </div>
  );
}
