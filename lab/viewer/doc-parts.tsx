import { Info } from "lucide-preact";
import type { ComponentChildren, ComponentProps } from "preact";
import { useState } from "preact/hooks";
import { Code, Collapsible, InfoCard, LABEL, TermList } from "./components";

// Container queries, not media queries: the side list takes a part of the window.
export const GRID3 = "grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3";
export const GRID2 = "grid grid-cols-1 gap-3 @xl:grid-cols-2";
export const BLOCKS2 = "grid grid-cols-1 gap-6 @xl:grid-cols-2 @xl:gap-5";

function withCode(text: string): ComponentChildren {
  const parts = text.split("`");
  return parts.length === 1 ? text : parts.map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : part));
}

export type TextTerm = readonly [term: string, text: string];

export function Terms({ rows, numbered }: { rows: readonly TextTerm[]; numbered?: boolean }) {
  return <TermList numbered={numbered} rows={rows.map(([term, text]) => [withCode(term), withCode(text)] as const)} />;
}

export function DocCard({ lines, ...card }: Omit<ComponentProps<typeof InfoCard>, "lines"> & { lines: readonly string[] }) {
  return <InfoCard {...card} lines={lines.map(withCode)} />;
}

export function Block({ label, sub, children }: { label: string; sub?: string; children: ComponentChildren }) {
  return (
    <div class="flex min-w-0 flex-col gap-3">
      <div class="flex flex-col gap-1">
        <span class={LABEL}>{label}</span>
        {sub && <span class="text-sm text-muted">{withCode(sub)}</span>}
      </div>
      {children}
    </div>
  );
}

export function Pills({ children }: { children: ComponentChildren }) {
  return <div class="flex flex-wrap gap-1.5">{children}</div>;
}

export function Page({ lead, details, children }: { lead: string; details: readonly TextTerm[]; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="flex flex-col gap-8">
      <p class="m-0 text-base text-muted">{withCode(lead)}</p>
      {children}
      <div class="border-t border-line pt-4">
        <Collapsible title="Details" icon={<Info size={13} />} detail={`${details.length} facts`} open={open} onToggle={() => setOpen(!open)}>
          <div class="px-2 pt-2">
            <Terms rows={details} />
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
