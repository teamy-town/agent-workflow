/**
 * Inside a node the timeline prefixes every line with `│ `. It soft-wraps a
 * long line only when stdout is a terminal, at the terminal's width. Piped
 * output (a log file, a parent process reading line by line) keeps each line
 * whole: a hard break there split one structured record into several lines,
 * and a reader that recognises the record by its start then showed the
 * remaining pieces as if they were messages.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { timeline } from '../timeline.js';

describe('timeline soft-wrap', () => {
  let realOut;
  let realIsTTY;
  let realColumns;
  let seen: string[];

  beforeEach(() => {
    realOut = process.stdout.write;
    realIsTTY = process.stdout.isTTY;
    realColumns = process.stdout.columns;
    seen = [];
    process.stdout.write = ((chunk) => { seen.push(String(chunk)); return true; }) as any;
  });
  afterEach(() => {
    if (timeline.isInsideNode) timeline.nodeComplete('wrap');
    process.stdout.write = realOut;
    (process.stdout as any).isTTY = realIsTTY;
    (process.stdout as any).columns = realColumns;
  });

  const record = `[native-stream] ${JSON.stringify({ threadId: 't', text: 'x'.repeat(600), startup: { firstTextAt: 1 } })}`;
  const linesOf = () => seen.join('').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.startsWith('│ '));

  it('keeps a long line whole when stdout is not a terminal', () => {
    (process.stdout as any).isTTY = false;
    (process.stdout as any).columns = undefined;
    timeline.nodeStart('wrap');
    process.stdout.write(`${record}\n`);
    timeline.nodeComplete('wrap');
    const lines = linesOf();
    expect(lines).toContain(`│ ${record}`);
    expect(lines.some((l) => l.includes('firstTextAt') && !l.includes('[native-stream]'))).toBe(false);
  });

  it('wraps at the terminal width when stdout is a terminal', () => {
    (process.stdout as any).isTTY = true;
    (process.stdout as any).columns = 80;
    timeline.nodeStart('wrap');
    process.stdout.write(`${record}\n`);
    timeline.nodeComplete('wrap');
    const lines = linesOf().filter((l) => !/^│ ?$/.test(l));
    const pieces = lines.filter((l) => !l.includes('wrap'));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((l) => l.length <= 80)).toBe(true);
  });
});
