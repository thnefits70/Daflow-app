-- AddForeignKey
ALTER TABLE "PurchaseSuggestionDiscard" ADD CONSTRAINT "PurchaseSuggestionDiscard_discardedById_fkey" FOREIGN KEY ("discardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseSuggestionDiscard" ADD CONSTRAINT "PurchaseSuggestionDiscard_undoneById_fkey" FOREIGN KEY ("undoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

