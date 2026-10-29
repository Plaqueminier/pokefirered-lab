import type { ComponentChildren } from "preact";
import { MODEL_ACTION_NAMES } from "../src/model/decision";
import { Card } from "./components";

// The colors of a prompt of the model bot, from the tokens of the theme. The first token that matches wins.
const TOKENS = [
  ["str", String.raw`"(?:[^"\\]|\\.)*"`, "text-warn"],
  ["call", String.raw`\b[a-z][A-Za-z]*(?=\()`, "text-accent"],
  ["bad", String.raw`\b(?:impossible|blocked|failed|unreadable)\b`, "text-bad"],
  ["ok", String.raw`\bdone\b`, "text-ok"],
  ["info", String.raw`\binterrupted\b`, "text-info"],
  ["act", String.raw`\b(?:${[...MODEL_ACTION_NAMES, "interact", "readText"].join("|")})\b(?= [A-Z0-9<]| ?$)`, "text-accent"],
  ["hole", String.raw`<[^>\s]+>`, "text-accent italic"],
  ["node", String.raw`#\d+(?:-\d+)?`, "text-accent"],
  ["place", String.raw`\b[A-Z][a-z]+[A-Z][A-Za-z]*(?:_[A-Za-z0-9]+)*\b`, "font-semibold text-fg"],
  ["num", String.raw`-?\b\d+(?:[.,]\d+)*\b%?`, "text-info"],
] as const;

const PROMPT_TOKENS = new RegExp(TOKENS.map(([kind, source]) => `(?<${kind}>${source})`).join("|"), "g");

// A text followed by ":" is a key of the JSON answer of the model.
const KEY_CLASS = "text-info";

const LINE_START = /^(\s*)(- )?([A-Z][A-Za-z' ]{0,40}:(?= |$))?/;

function promptTokens(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let at = 0;
  for (const match of text.matchAll(PROMPT_TOKENS)) {
    const index = match.index;
    if (index > at) out.push(text.slice(at, index));
    const token = TOKENS.find(([kind]) => match.groups?.[kind] !== undefined);
    const key = token?.[0] === "str" && text[index + match[0].length] === ":";
    out.push(
      <span key={index} class={key ? KEY_CLASS : token?.[2]}>
        {match[0]}
      </span>,
    );
    at = index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function PromptLine({ line, first }: { line: string; first: boolean }) {
  const [start, indent, bullet, label] = LINE_START.exec(line) ?? ["", "", undefined, undefined];
  if (first && line.endsWith(":") && !bullet) return <div class="font-semibold text-fg">{line}</div>;
  const hang = `${indent.length + (bullet?.length ?? 0)}ch`;
  return (
    <div style={{ paddingLeft: hang, textIndent: `-${hang}` }}>
      {indent}
      {bullet && <span class="text-faint">{bullet}</span>}
      {label && <span class="font-semibold text-fg">{label}</span>}
      {promptTokens(line.slice(start.length))}
    </div>
  );
}

export function PromptText({ text, highlight }: { text: string; highlight?: boolean }) {
  return (
    <Card size="sm">
      <div class="font-mono text-xs leading-[1.6] whitespace-pre-wrap text-fg/75">
        {highlight
          ? text.split("\n").map((line, i) => <PromptLine key={i} line={line} first={i === 0} />)
          : text}
      </div>
    </Card>
  );
}
