// The small DOM builders that the panels share.
export function element(tag: string, text: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function card(title: string, ...content: HTMLElement[]): HTMLElement {
  const section = element("div", "", "stats-card");
  section.append(element("h3", title), ...content);
  return section;
}

export function rows(cells: string[][]): HTMLElement {
  if (cells.length === 0) return line("–");
  const table = document.createElement("table");
  for (const texts of cells) {
    const row = table.insertRow();
    for (const text of texts) row.insertCell().textContent = text;
  }
  return table;
}

export function line(text: string): HTMLElement {
  return element("div", text, "muted");
}

export function showTooltip(tooltip: HTMLElement, text: string | null, clientX: number, clientY: number): void {
  tooltip.style.display = text ? "block" : "none";
  if (!text) return;
  tooltip.textContent = text;
  const width = tooltip.offsetWidth;
  const left = clientX + 14 + width > window.innerWidth - 8 ? clientX - 14 - width : clientX + 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.min(clientY + 14, window.innerHeight - tooltip.offsetHeight - 8)}px`;
}
