import { Check, ChevronDown, Search, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { anchoredStyle, Button, Card, FIELD, Input, LABEL, type Tone, toneText, useAnchorId } from "./components";

const LAYER_CARD = "w-max rounded-card border border-line-strong bg-bg text-fg shadow-xl";

// The body of a floating layer: the card of a HoverCard, the content of a Popover and the list of a Select.
export function PopoverBody({ list, children }: { list?: boolean; children: ComponentChildren }) {
  const size = list ? "max-h-[min(320px,calc(100dvh-96px))] min-w-full max-w-[min(480px,calc(100vw-16px))] p-1" : "max-h-[calc(100dvh-96px)] max-w-[calc(100vw-16px)] p-4";
  return <div class={`${LAYER_CARD} animate-pop overflow-auto ${size}`}>{children}</div>;
}

const LAYER = "m-0 overflow-visible border-0 bg-transparent p-0";

const OPEN_DELAY = 300;
const CLOSE_DELAY = 150;

export function HoverCard({ card, control, children }: { card: ComponentChildren; control?: boolean; children: ComponentChildren }) {
  const anchor = `--hover-card-${useAnchorId()}`;
  const popover = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = popover.current;
    if (!element || open === element.matches(":popover-open")) return;
    if (open) element.showPopover();
    else element.hidePopover();
  }, [open]);
  // A trigger with blocks (a card) cannot be a button element, which holds only a phrase.
  const trigger = control ? {} : { role: "button" as const, tabIndex: 0, "aria-expanded": open, class: "rounded-card outline-none focus-visible:ring-3 focus-visible:ring-accent/35" };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the trigger is the button role of the spread, or the control in the children.
    <div
      {...trigger}
      style={`anchor-name: ${anchor}`}
      onMouseEnter={() => later(true, OPEN_DELAY)}
      onMouseLeave={() => later(false, CLOSE_DELAY)}
      // A click also gives the focus: only a keyboard focus opens the card at once, and a blur does not close it under the pointer.
      onFocusIn={(event) => (event.target as Element).matches(":focus-visible") && later(true, 0)}
      onFocusOut={(event) => !event.currentTarget.matches(":hover") && later(false, 0)}
    >
      {children}
      <div
        ref={popover}
        popover="manual"
        class={LAYER}
        style={anchoredStyle(anchor, "margin-left: 8px", "right span-bottom", "flip-inline, flip-block, flip-block flip-inline")}
      >
        {open && <PopoverBody>{card}</PopoverBody>}
      </div>
    </div>
  );
}

const POINTER_GAP = 16;
const EDGE = 8;

// In the top layer, so the overflow of a panel does not cut the card.
export function PointerCard({ at, glass, children }: { at: { x: number; y: number } | null; glass?: boolean; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const shown = element.matches(":popover-open");
    if (!at) {
      if (shown) element.hidePopover();
      return;
    }
    if (!shown) element.showPopover();
    const { offsetWidth: width, offsetHeight: height } = element;
    const left = at.x + POINTER_GAP + width > window.innerWidth - EDGE ? at.x - POINTER_GAP - width : at.x + POINTER_GAP;
    const top = at.y + POINTER_GAP + height > window.innerHeight - EDGE ? at.y - POINTER_GAP - height : at.y + POINTER_GAP;
    element.style.left = `${Math.max(EDGE, left)}px`;
    element.style.top = `${Math.max(EDGE, top)}px`;
  });
  return (
    <div ref={ref} popover="manual" class={`${LAYER} pointer-events-none inset-auto`}>
      {at && (glass ? <div class="text-fg"><Card size="sm" glass>{children}</Card></div> : <div class={`${LAYER_CARD} flex max-w-[340px] flex-col gap-1.5 px-3 py-2.5 text-xs`}>{children}</div>)}
    </div>
  );
}

export function Popover({ label, icon, title, disabled, children }: { label: ComponentChildren; icon?: ComponentChildren; title?: string; disabled?: boolean; children: ComponentChildren }) {
  const id = `popover-${useAnchorId()}`;
  const [open, setOpen] = useState(false);
  return (
    <span class="flex min-w-0 *:min-w-0" style={`anchor-name: --${id}`}>
      <Button popovertarget={id} pressed={open} disabled={disabled} title={title}>
        {icon && <span class="flex shrink-0">{icon}</span>}
        <span class="min-w-0 truncate">{label}</span>
        <ChevronDown size={14} class={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </Button>
      <div
        id={id}
        popover="auto"
        onToggle={(event) => setOpen(event.newState === "open")}
        class={LAYER}
        style={anchoredStyle(`--${id}`, "margin-top: 6px", "bottom span-right", "flip-inline, flip-block")}
      >
        <PopoverBody>{children}</PopoverBody>
      </div>
    </span>
  );
}

type SelectOption<T extends string> = { value: T; label: string; group?: string; disabledReason?: string };

type SelectSearch = { placeholder: string; empty: (query: string) => string };

const TYPE_AHEAD_MS = 600;

// Names such as ViridianCity_Mart join words with "_": a search with spaces must find them.
function searchKey(text: string): string {
  return text.toLowerCase().replace(/[_\s]/g, "");
}

// The list takes the keyboard while it is open: no key goes to the game. A closed Select takes the keys only after a keyboard focus.
export function Select<T extends string>({
  options,
  value,
  onChange,
  disabled,
  title,
  placeholder = "–",
  searchable,
}: {
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  searchable?: SelectSearch;
}) {
  const id = `select-${useAnchorId()}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const byKeyboard = useRef(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const key = searchKey(query);
    return key ? options.filter((option) => searchKey(option.label).includes(key)) : options;
  }, [options, query]);
  const selected = shown.findIndex((option) => option.value === value);
  const current = options.find((option) => option.value === value);
  useLayoutEffect(() => {
    const item = document.getElementById(`${id}-${active}`);
    const scroller = layer.current?.firstElementChild;
    if (!open || !item || !scroller) return;
    const box = item.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const top = view.top + (search.current?.offsetHeight ?? 0);
    if (box.top < top) scroller.scrollTop -= top - box.top + 4;
    else if (box.bottom > view.bottom) scroller.scrollTop += box.bottom - view.bottom + 4;
  }, [open, active, id]);
  const close = () => {
    if (layer.current?.matches(":popover-open")) layer.current.hidePopover();
    // After a search typed in the field, a focus from a script is visible, so the field takes the arrows of the game.
    if (byKeyboard.current) trigger.current?.focus();
    else trigger.current?.blur();
  };
  const choose = (index: number) => {
    const option = shown[index];
    if (!option || option.disabledReason) return;
    close();
    if (option.value !== value) onChange(option.value);
  };
  const typeAhead = (key: string) => {
    const now = performance.now();
    const text = (now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text : "") + key.toLowerCase();
    typed.current = { text, at: now };
    // The same letter again goes to the next option with that letter.
    const again = [...text].every((letter) => letter === text[0]);
    const prefix = again ? text[0] : text;
    const from = again ? active + 1 : active;
    for (let k = 0; k < shown.length; k++) {
      const index = (from + k) % shown.length;
      if (shown[index].label.toLowerCase().startsWith(prefix)) return setActive(index);
    }
  };
  const move = (event: KeyboardEvent, index: number) => {
    event.preventDefault();
    setActive(Math.max(0, Math.min(shown.length - 1, index)));
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") move(event, active + 1);
    else if (event.key === "ArrowUp") move(event, active - 1);
    else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") close();
  };
  const onListKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    const typing = performance.now() - typed.current.at < TYPE_AHEAD_MS;
    if (event.key === "Home") move(event, 0);
    else if (event.key === "End") move(event, shown.length - 1);
    else if (event.key === " " && !typing) {
      event.preventDefault();
      choose(active);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      typeAhead(event.key);
    } else onKey(event);
  };
  const onTriggerKey = (event: KeyboardEvent) => {
    if (!(event.currentTarget as HTMLElement).matches(":focus-visible")) return;
    byKeyboard.current = true;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      layer.current?.showPopover();
    }
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) event.stopPropagation();
  };
  return (
    <span class="relative block min-w-0" style={`anchor-name: --${id}`}>
      <button
        ref={trigger}
        type="button"
        popovertarget={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled}
        title={title ?? current?.label}
        onKeyDown={onTriggerKey}
        onPointerDown={() => {
          byKeyboard.current = false;
        }}
        class={`${FIELD} flex items-center gap-2 text-left focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-40 ${open ? "border-accent ring-3 ring-accent/20" : "border-line focus-visible:border-accent focus-visible:ring-accent/20"}`}
      >
        <span class={`min-w-0 flex-1 truncate ${current ? "" : "text-faint"}`}>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} class={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {/* No click in the list reaches a label around the Select: the label would click the trigger again. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the list takes the keys. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this only stops the click. */}
      <div
        ref={layer}
        id={id}
        popover="auto"
        onClick={(event) => event.preventDefault()}
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (!opened) return setQuery("");
          setActive(Math.max(0, selected));
          if (searchable) search.current?.querySelector("input")?.focus();
          else list.current?.focus();
        }}
        class={LAYER}
        style={`${anchoredStyle(`--${id}`, "margin-top: 4px", "bottom span-right", "flip-block, flip-inline, flip-block flip-inline")}; min-width: anchor-size(width)`}
      >
        <PopoverBody list>
          {searchable && (
            <div ref={search} class="sticky top-0 z-10 w-[300px] max-w-full bg-bg p-1 pb-1.5">
              <Input
                icon={<Search size={14} />}
                placeholder={searchable.placeholder}
                value={query}
                aria-controls={`${id}-list`}
                aria-activedescendant={open && shown.length > 0 ? `${id}-${active}` : undefined}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  onKey(event);
                }}
              />
            </div>
          )}
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={open && !searchable ? `${id}-${active}` : undefined}
            onKeyDown={onListKey}
            class="outline-none"
          >
            {searchable && shown.length === 0 && <div class="px-2.5 py-2 text-sm text-faint">{searchable.empty(query)}</div>}
            {shown.map((option, index) => [
              option.group && option.group !== shown[index - 1]?.group && (
                <div key={`group-${option.group}`} role="presentation" class={`${LABEL} px-2.5 pt-2.5 pb-1 first:pt-1`}>
                  {option.group}
                </div>
              ),
              // biome-ignore lint/a11y/useKeyWithClickEvents: the list takes the keys.
              <div
                key={`${index}-${option.value}`}
                id={`${id}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === selected}
                aria-disabled={option.disabledReason ? true : undefined}
                title={option.disabledReason ?? option.label}
                onClick={() => choose(index)}
                onPointerMove={() => setActive(index)}
                class={`flex h-8 items-center gap-2 rounded-sm px-2.5 text-sm ${option.disabledReason ? "cursor-not-allowed text-faint" : "cursor-pointer"} ${index === active ? "bg-raised" : ""} ${option.disabledReason ? "" : index === selected ? "font-semibold text-accent" : "text-fg"}`}
              >
                <span class="min-w-0 flex-1 truncate">{option.label}</span>
                {option.disabledReason && <span class="min-w-0 max-w-[240px] truncate text-xs">{option.disabledReason}</span>}
                {index === selected && <Check size={14} class="shrink-0" />}
              </div>,
            ])}
          </div>
        </PopoverBody>
      </div>
    </span>
  );
}

export function Toast({ tone = "info", icon, title, onClose, children }: { tone?: Tone; icon?: ComponentChildren; title: string; onClose?: () => void; children?: ComponentChildren }) {
  return (
    <div
      role="status"
      class="pointer-events-auto flex w-[340px] max-w-[calc(100vw-32px)] animate-toast items-start gap-3 rounded-card border bg-bg py-3 pr-3 pl-4 shadow-xl"
      style={{ borderColor: `color-mix(in oklab, var(--color-${tone}) 55%, transparent)` }}
    >
      {icon && <span class={`mt-0.5 shrink-0 ${toneText(tone)}`}>{icon}</span>}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">{title}</p>
        {children && <p class="mt-0.5 text-sm leading-snug text-muted">{children}</p>}
      </div>
      {onClose && (
        <button type="button" aria-label="Close" onClick={onClose} class="shrink-0 rounded-sm p-0.5 text-faint transition-colors hover:text-fg">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Toaster({ children }: { children: ComponentChildren }) {
  return <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">{children}</div>;
}
