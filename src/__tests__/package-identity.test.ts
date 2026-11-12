import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { generateWorkflowCode } from '../code-generator.js';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const manifest = JSON.parse(read('package.json'));

describe('published package identity', () => {
  it('generated workflows import the package that generated them', () => {
    const source = generateWorkflowCode({ nodes: [{ id: 'start', type: 'custom' }], edges: [] });
    expect(source).toContain(`from '${manifest.name}'`);
  });

  it('runnable examples install and import the published package', () => {
    for (const dir of readdirSync(new URL('examples/', root), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const example = JSON.parse(read(`examples/${dir.name}/package.json`));
      expect(example.dependencies[manifest.name], dir.name).toBe(`^${manifest.version}`);
      expect(read(`examples/${dir.name}/index.js`), dir.name).toContain(`from '${manifest.name}'`);
    }
  });

  it('the package lock uses the same identity as the manifest', () => {
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.name).toBe(manifest.name);
    expect(lock.packages[''].name).toBe(manifest.name);
    expect(lock.version).toBe(manifest.version);
  });
});
