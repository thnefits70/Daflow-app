// Uso único 2026-10-05: renombra los combos sugeridos que salieron antes de
// la regla "Producto A Y Producto B" (máx. 40 caracteres).
import "dotenv/config";
import { renameOpenComboSuggestions } from "@/lib/comboSuggestions";

renameOpenComboSuggestions().then((rows) => {
  for (const r of rows) console.log(`${r.before ?? "(sin nombre)"}  →  ${r.after}  (${r.after.length})`);
  console.log(`Renombrados: ${rows.length}`);
  process.exit(0);
});
