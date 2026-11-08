type Pos = readonly [x: number, y: number];
type Arrow = { d: string; label: string; lx: number; ly: number; anchor: "start" | "middle" | "end" };

const LOOP = [
  { title: "Harness", tag: "🕹️ runs the game", lines: ["runs the emulator", "decides nothing, except the use of FLASH and the speed of a walk"], next: "runs to" },
  { title: "Decision point", tag: "⏸️ game frozen", lines: ["the game waits", "walk, text, choice, battle…"], next: "asks" },
  { title: "Model call", tag: "🤖 the Bot asks", lines: ["prompt → AI model", "action, reason, Mission"], next: "answer" },
  { title: "Macro-action", tag: "▶️ one game action", lines: ["goTo, fight, buy…", "or one Raw input"], next: "plays it" },
];
const LOOP_W = 200;
const LOOP_H = 104;

/** An arrow between the facing sides of two nodes on one row or one column. */
function edge([ax, ay]: Pos, [bx, by]: Pos, label: string): Arrow {
  if (ay === by) {
    const y = ay + LOOP_H / 2;
    const [x1, x2] = bx > ax ? [ax + LOOP_W + 2, bx - 4] : [ax - 2, bx + LOOP_W + 4];
    return { d: `M${x1} ${y} H${x2}`, label, lx: (x1 + x2) / 2, ly: y - 8, anchor: "middle" };
  }
  const x = ax + LOOP_W / 2;
  const down = by > ay;
  const [y1, y2] = down ? [ay + LOOP_H + 2, by - 4] : [ay - 2, by + LOOP_H + 4];
  return { d: `M${x} ${y1} V${y2}`, label, lx: down ? x + 10 : x - 10, ly: (y1 + y2) / 2 + 4, anchor: down ? "start" : "end" };
}

function rowLayout() {
  const pos: Pos[] = LOOP.map((_, i) => [8 + i * (LOOP_W + 56), 20]);
  const [first, last] = [pos[0], pos[pos.length - 1]];
  const bottom = first[1] + LOOP_H;
  const back: Arrow = {
    d: `M${last[0] + LOOP_W / 2} ${bottom + 2} V${bottom + 36} H${first[0] + LOOP_W / 2} V${bottom + 4}`,
    label: "the Harness plays the action, the game runs to the next Decision point",
    lx: (first[0] + last[0] + LOOP_W) / 2,
    ly: bottom + 60,
    anchor: "middle",
  };
  return { viewBox: `0 0 ${last[0] + LOOP_W + 8} ${bottom + 76}`, pos, arrows: [...pos.slice(1).map((to, i) => edge(pos[i], to, LOOP[i].next)), back] };
}

function cycleLayout() {
  const pos: Pos[] = [
    [20, 20],
    [330, 20],
    [330, 196],
    [20, 196],
  ];
  return { viewBox: "0 0 560 320", pos, arrows: pos.map((from, i) => edge(from, pos[(i + 1) % pos.length], LOOP[i].next)) };
}

const LOOP_LAYOUTS = { row: rowLayout(), cycle: cycleLayout() };

/** "cycle" is 2 × 2 boxes, for a narrow page. */
export function LoopDiagram({ layout }: { layout: keyof typeof LOOP_LAYOUTS }) {
  const { viewBox, pos, arrows } = LOOP_LAYOUTS[layout];
  // One marker id per layout: both layouts are in the page, one of them hidden.
  const marker = `doc-arrow-${layout}`;
  return (
    <svg viewBox={viewBox} class="block h-auto w-full" role="img" aria-label="The loop: Harness, Decision point, Model call, Macro-action">
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="fill-faint" />
        </marker>
      </defs>
      {arrows.map((arrow) => (
        <g key={arrow.d}>
          <path d={arrow.d} fill="none" stroke-width="1.5" marker-end={`url(#${marker})`} class="stroke-faint" />
          <text x={arrow.lx} y={arrow.ly} font-size="12" text-anchor={arrow.anchor} class="fill-muted">
            {arrow.label}
          </text>
        </g>
      ))}
      {LOOP.map((node, i) => {
        const [x, y] = pos[i];
        return (
          <g key={node.title}>
            <rect x={x} y={y} width={LOOP_W} height={LOOP_H} rx="10" class="fill-raised stroke-line-strong" />
            <text x={x + 16} y={y + 26} font-size="16" font-weight="600" class="fill-fg">
              {node.title}
            </text>
            <text x={x + 16} y={y + 46} font-size="12" class="fill-muted">
              {node.tag}
            </text>
            {node.lines.map((line, j) => (
              <text key={line} x={x + 16} y={y + 68 + j * 17} font-size="12.5" class="fill-muted">
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

const BOX_H = 44;
const NOTE_W = 118;
const NOTES = [0, 1, 2, 3, 4, 5];
const LAST = NOTES.length - 1;
const noteX = (i: number) => 20 + i * (NOTE_W + 14);
const center = ([a, b]: readonly [number, number]) => (noteX(a) + noteX(b) + NOTE_W) / 2;
const Y_NOTE = 220;
const Y_TWO = 130;
const Y_FOUR = 40;

const LOOKS = {
  top: { box: "fill-accent/14 stroke-accent stroke-2", sub: "fill-accent" },
  fresh: { box: "fill-raised stroke-ok", sub: "fill-muted" },
  plain: { box: "fill-raised stroke-line-strong", sub: "fill-muted" },
};

/** `span`: the first and the last note under the node; `parent`: its index in NODES. */
type MemoryNode = { span: readonly [number, number]; y: number; w: number; label: string; sub: string; look: keyof typeof LOOKS; parent?: number };

const NODES: MemoryNode[] = [
  { span: [0, 3], y: Y_FOUR, w: 250, label: "Notes 1–4", sub: "seen by the model · 600 characters", look: "top" },
  { span: [0, 1], y: Y_TWO, w: 200, label: "Notes 1–2", sub: "Summary call · 400 characters", look: "plain", parent: 0 },
  { span: [2, 3], y: Y_TWO, w: 200, label: "Notes 3–4", sub: "Summary call · 400 characters", look: "plain", parent: 0 },
  { span: [4, 5], y: Y_TWO, w: 200, label: "Notes 5–6", sub: "seen by the model · 400", look: "top" },
  ...NOTES.map(
    (i): MemoryNode => ({
      span: [i, i],
      y: Y_NOTE,
      w: NOTE_W,
      label: `Note ${i + 1}`,
      sub: i === LAST ? "🆕 just added" : "200 characters",
      look: i === LAST ? "fresh" : "plain",
      parent: 1 + Math.floor(i / 2),
    }),
  ),
];

export function MemoryDiagram() {
  return (
    <svg viewBox="0 0 820 300" class="block h-auto w-full" role="img" aria-label="The Memory tree: 6 notes, nodes of 2 and 4 notes, and the top nodes that the model sees">
      {NODES.map((node) => {
        if (node.parent === undefined) return null;
        const parent = NODES[node.parent];
        return <path key={node.label} d={`M${center(node.span)} ${node.y} L${center(parent.span)} ${parent.y + BOX_H}`} stroke-width="1.3" fill="none" class="stroke-faint" />;
      })}
      {NODES.map((node) => {
        const cx = center(node.span);
        const look = LOOKS[node.look];
        return (
          <g key={node.label}>
            <rect x={cx - node.w / 2} y={node.y} width={node.w} height={BOX_H} rx="8" class={look.box} />
            <text x={cx} y={node.y + 19} font-size="14.5" font-weight="600" text-anchor="middle" class="fill-fg">
              {node.label}
            </text>
            <text x={cx} y={node.y + 36} font-size="12" text-anchor="middle" class={look.sub}>
              {node.sub}
            </text>
          </g>
        );
      })}
      <text x={center([4, 5])} y={Y_FOUR + 12} font-size="13" text-anchor="middle" class="fill-muted">
        Two neighbour nodes of the same size
      </text>
      <text x={center([4, 5])} y={Y_FOUR + 30} font-size="13" text-anchor="middle" class="fill-muted">
        get a parent: a Summary call.
      </text>
      <text x={410} y={292} font-size="13" text-anchor="middle" class="fill-faint">
        zoom 1-4 opens the two halves of a node, down to the notes · a node of 2^k notes has 200 × (k + 1) characters at most
      </text>
    </svg>
  );
}
