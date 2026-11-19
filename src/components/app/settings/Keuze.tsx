import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props<T extends string> {
  naam: string;
  label: string;
  waarde: T;
  onChange: (v: T) => void;
  opties: { value: T; titel: string; tekst?: string }[];
}

/** Een groep keuzes als shadcn RadioGroup, met grote klikdoelen. */
export default function Keuze<T extends string>({ naam, label, waarde, onChange, opties }: Props<T>) {
  return (
    <RadioGroup value={waarde} onValueChange={(v) => onChange(v as T)} aria-label={label} className="gap-3">
      {opties.map((o) => (
        <FieldLabel key={o.value} htmlFor={`${naam}-${o.value}`} className="cursor-pointer rounded-xl border-2 border-input p-4 has-data-checked:border-primary has-data-checked:bg-accent">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle id={`${naam}-${o.value}-titel`} className="text-lg">
                {o.titel}
              </FieldTitle>
              {o.tekst && <FieldDescription className="text-base">{o.tekst}</FieldDescription>}
            </FieldContent>
            <RadioGroupItem id={`${naam}-${o.value}`} value={o.value} aria-labelledby={`${naam}-${o.value}-titel`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  );
}
