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
