# Regels voor Zakelijk (shadcn-onderdelen)
- Importeer alle onderdelen uit `@/kit/components` (bijv. `import { Button, Card, CardContent } from "@/kit/components"`). De code staat in `src/kit/components/`; pas die niet aan, maar maak een wrapper in `src/components/app/`.
- Delen van één onderdeel hebben een eigen naam: `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Dialog`, `DialogContent`, `DialogTitle`, `Tabs`, `TabsList`, `TabsTrigger`.
- Stijlen met Tailwind-klassen die thematokens gebruiken: `bg-primary`, `text-muted-foreground`, `rounded-lg`, `p-4`. Nooit `#hex`, `rgb()` of vaste pixelwaarden zoals `w-[13px]`.
- Elk invoerveld krijgt een `Label` (`htmlFor` en `id`). Elke `Dialog` heeft een `DialogTitle`.
- Knoppen: `<Button>` (variant `outline`, `ghost`, `destructive`, `link`; maat `sm`, `lg`). Geen gewone `<button>`.
- Stijl: Houd het zakelijk: duidelijke koppen, compacte formulieren, geen overbodige versiering.
