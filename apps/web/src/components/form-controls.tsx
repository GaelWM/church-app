import { useState, type ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { fr } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* shadcn Select / Calendar wrapped for this app's forms: string values in, string values out. */

export interface Option { value: string; label: ReactNode }

// Radix Select cannot hold an item whose value is "", so "no choice" travels as a sentinel.
const NONE = "__none__";

interface OptionSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function OptionSelect({ value, onValueChange, options, placeholder, size, disabled, className, "aria-label": ariaLabel }: OptionSelectProps) {
  return (
    <Select value={value === "" ? undefined : value} onValueChange={(v) => onValueChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger size={size} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => <SelectItem key={o.value || NONE} value={o.value === "" ? NONE : o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** react-hook-form binding for OptionSelect. */
export function FormSelect<T extends FieldValues>({ control, name, options, ...rest }: { control: Control<T>; name: Path<T> } & Pick<OptionSelectProps, "options" | "placeholder" | "size" | "disabled" | "className">) {
  return <Controller control={control} name={name} render={({ field }) => <OptionSelect {...rest} options={options} value={field.value ?? ""} onValueChange={field.onChange} />} />;
}

const ISO = "yyyy-MM-dd";
const toDate = (s?: string) => { if (!s) return undefined; const d = parse(s, ISO, new Date()); return isNaN(d.getTime()) ? undefined : d; };
const show = (d?: Date) => (d ? format(d, "dd/MM/yyyy") : "");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Today shifted by whole years/days, at local midnight. Evaluated per render so a tab left open past midnight stays correct. */
const shift = ({ years = 0, days = 0 }: { years?: number; days?: number } = {}) => { const d = startOfDay(new Date()); d.setFullYear(d.getFullYear() + years); d.setDate(d.getDate() + days); return d; };

/** Allowed date windows per kind of field, so nobody can pick 1901 or 2099. */
export const dateLimits = {
  /** Something that already happened: an entry, a bank operation, a service. Up to 5 years back, never in the future. */
  past: () => ({ min: shift({ years: -5 }), max: shift() }),
  /** A due date: may already be overdue (1 year back) and can be planned up to 5 years ahead. */
  due: () => ({ min: shift({ years: -1 }), max: shift({ years: 5 }) }),
  /** A rate or setting taking effect: backfill up to 5 years, schedule up to a month ahead. */
  effective: () => ({ min: shift({ years: -5 }), max: shift({ days: 30 }) }),
};
export type DateLimits = { min?: Date; max?: Date };

/** Calendar props that disable days outside [min, max] and keep the year/month dropdowns inside it. */
function bounds({ min, max }: DateLimits) {
  const lo = min ?? new Date(2015, 0), hi = max ?? shift({ years: 5 });
  return { startMonth: lo, endMonth: hi, disabled: [...(min ? [{ before: min }] : []), ...(max ? [{ after: max }] : [])] };
}

function Trigger({ text, placeholder, className }: { text: string; placeholder: string; className?: string }) {
  return (
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" className={cn("w-full justify-between font-normal", !text && "text-muted-foreground", className)}>
        <span className="truncate">{text || placeholder}</span>
        <CalendarIcon className="text-muted-foreground" />
      </Button>
    </PopoverTrigger>
  );
}

/** Popover + Calendar. The value stays an ISO date string ("2026-09-19", or "" when empty). */
export function DatePicker({ value, onChange, placeholder = "jj/mm/aaaa", clearable, className, min, max }: { value: string; onChange: (iso: string) => void; placeholder?: string; clearable?: boolean; className?: string } & DateLimits) {
  const [open, setOpen] = useState(false);
  const date = toDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Trigger text={show(date)} placeholder={placeholder} className={className} />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" locale={fr} captionLayout="dropdown" {...bounds({ min, max })} defaultMonth={date} selected={date}
          onSelect={(d) => { onChange(d ? format(d, ISO) : ""); setOpen(false); }} />
        {clearable && value && <div className="border-t p-2"><Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onChange(""); setOpen(false); }}>Effacer</Button></div>}
      </PopoverContent>
    </Popover>
  );
}

/** react-hook-form binding for DatePicker. */
export function FormDate<T extends FieldValues>({ control, name, ...rest }: { control: Control<T>; name: Path<T>; placeholder?: string; clearable?: boolean } & DateLimits) {
  return <Controller control={control} name={name} render={({ field }) => <DatePicker {...rest} value={field.value ?? ""} onChange={field.onChange} />} />;
}

/** One picker for a from/to pair (two months side by side). Values are ISO strings or "". */
export function DateRangePicker({ from, to, onChange, placeholder = "Toutes les dates", className, min, max }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void; placeholder?: string; className?: string } & DateLimits) {
  const [open, setOpen] = useState(false);
  const f = toDate(from), t = toDate(to);
  const selected: DateRange | undefined = f || t ? { from: f, to: t } : undefined;
  const text = f && t ? `${show(f)} – ${show(t)}` : f ? `Dès le ${show(f)}` : t ? `Jusqu'au ${show(t)}` : "";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Trigger text={text} placeholder={placeholder} className={cn("min-w-64", className)} />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" locale={fr} numberOfMonths={2} captionLayout="dropdown" {...bounds({ min, max })} defaultMonth={f ?? t} selected={selected}
          onSelect={(r) => { onChange({ from: r?.from ? format(r.from, ISO) : "", to: r?.to ? format(r.to, ISO) : "" }); if (r?.from && r?.to) setOpen(false); }} />
        {(from || to) && <div className="border-t p-2"><Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onChange({ from: "", to: "" }); setOpen(false); }}>Effacer la période</Button></div>}
      </PopoverContent>
    </Popover>
  );
}
