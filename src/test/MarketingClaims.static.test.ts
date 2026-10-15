import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const PROJECT = join(SRC, '..');
const FORBIDDEN = [/soc[\s-]*2/i, /type\s+ii\b/i, /certified/i];

function uiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : uiFiles(path);
    return /\.(ts|tsx|md|html|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('marketing claims', () => {
  it('never claims SOC 2 audits or ASC 842 certification in the UI', () => {
    const files = [...uiFiles(SRC), join(PROJECT, 'index.html'), join(PROJECT, 'README.md')];
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          FORBIDDEN.some((re) => re.test(line)) ? [`${relative(PROJECT, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});
