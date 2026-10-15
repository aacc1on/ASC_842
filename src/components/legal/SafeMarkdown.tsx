import { Fragment, type ReactNode } from 'react';

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const UNORDERED = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function nextNonBlank(lines: string[], from: number): number {
  let j = from;
  while (j < lines.length && !lines[j].trim()) j++;
  return j;
}

function isTableRow(line: string | undefined): boolean {
  return line !== undefined && line.includes('|') && !HEADING.test(line) && !UNORDERED.test(line) && !ORDERED.test(line);
}

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      i++;
      continue;
    }

    const separatorAt = nextNonBlank(lines, i + 1);
    if (line.trim().startsWith('|') && separatorAt < lines.length && TABLE_SEPARATOR.test(lines[separatorAt])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i = separatorAt + 1;
      // Rows may be separated by blank lines and may omit the leading pipe.
      for (let j = nextNonBlank(lines, i); isTableRow(lines[j]); j = nextNonBlank(lines, i)) {
        rows.push(splitRow(lines[j]));
        i = j + 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const listMatch = UNORDERED.exec(line) ?? ORDERED.exec(line);
    if (listMatch) {
      const ordered = !UNORDERED.test(line);
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (i < lines.length) {
        const m = pattern.exec(lines[i]);
        if (!m) break;
        items.push(m[1].trim());
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const para: string[] = [];
    let current: string[] = [];
    while (
      i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) &&
      !UNORDERED.test(lines[i]) && !ORDERED.test(lines[i]) && !lines[i].trim().startsWith('|')
    ) {
      current.push(lines[i].trim());
      if (/ {2,}$/.test(lines[i])) {
        para.push(current.join(' '));
        current = [];
      }
      i++;
    }
    if (current.length) para.push(current.join(' '));
    blocks.push({ kind: 'paragraph', lines: para });
  }
  return blocks;
}

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={idx} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      : <Fragment key={idx}>{part}</Fragment>,
  );
}

export function SafeMarkdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-4 text-slate-700 leading-relaxed">
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case 'heading':
            if (b.level === 1) return <h1 key={idx} className="text-3xl font-bold text-slate-900 leading-tight">{renderInline(b.text)}</h1>;
            if (b.level === 2) return <h2 key={idx} className="text-xl font-bold text-slate-900 leading-tight pt-4">{renderInline(b.text)}</h2>;
            return <h3 key={idx} className="text-base font-semibold text-slate-900 leading-tight pt-2">{renderInline(b.text)}</h3>;
          case 'paragraph':
            return (
              <p key={idx}>
                {b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(l)}</Fragment>)}
              </p>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={idx} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1`}>
                {b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={idx} className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>{b.header.map((h, j) => <th key={j} className="text-left font-semibold text-slate-900 px-4 py-2 border-b border-slate-200">{renderInline(h)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-slate-100 last:border-0">
                        {row.map((cell, c) => <td key={c} className="px-4 py-2 align-top">{renderInline(cell)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
