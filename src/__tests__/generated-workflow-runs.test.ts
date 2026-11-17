import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateWorkflowCode } from '../code-generator.js';

const manifest = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));
const engineEntry = fileURLToPath(new URL('../index.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'generated-workflow-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Write the generated module beside its config, importing this source tree in
// place of the published package, and load it.
async function load(name: string, config: any, nodeConfigs: any = {}) {
  const source = generateWorkflowCode(config, { workflowType: name });
  expect(source).toContain(`from '${manifest.name}'`);
  writeFileSync(join(dir, `workflow-${name}.config.json`), JSON.stringify(nodeConfigs));
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, source.replace(`'${manifest.name}'`, JSON.stringify(pathToFileURL(engineEntry).href)));
  return import(pathToFileURL(file).href);
}

describe('generated workflows build and run', () => {
  it('a node with no implementation of its own builds and runs as a passthrough', async () => {
    const mod = await load('passthrough', { nodes: [{ id: 'start', type: 'custom' }], edges: [] });
    const graph = mod.buildGraph();
    const result = await graph.run(null, { input: 1 });
    expect(result.success).not.toBe(false);
  });

  it('nodes with code run in order and their output reaches state', async () => {
    const config = {
      nodes: [{ id: 'first', type: 'custom' }, { id: 'second', type: 'custom' }],
      edges: [{ source: 'first', target: 'second' }],
      nodeConfigs: {
        first: { customCode: 'async (state) => ({ success: true, output: { count: 1 }, raw: null })' },
        second: { customCode: 'async (state) => ({ success: true, output: { seen: state.first?.output?.count ?? null }, raw: null })' },
      },
    };
    const mod = await load('chain', config);
    const result = await mod.buildGraph().run(null, {});
    expect(result.success).not.toBe(false);
    expect(JSON.stringify(result)).toContain('"seen":1');
  });

  it('a registered factory node type is built from its id and config', async () => {
    const mod = await load('factory', { nodes: [{ id: 'ask', type: 'ai_agent' }], edges: [] });
    const graph = mod.buildGraph();
    expect(graph.nodes.get('ask')?.name).toBe('ask');
    expect(typeof graph.nodes.get('ask')?.customExecute).toBe('function');
  });
});
