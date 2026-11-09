/**
 * A conditional edge's declared `labels` NAME its targets.
 *
 * serialize() used to learn a route's targets only by reading the route
 * function's source text. A route whose source is unreadable (a function
 * compiled to bytecode, a minified build) therefore had no targets, and the
 * graph was refused . The branch now
 * declares its labels and the targets ARE those labels (declaration order),
 * plus any further node id a readable route returns.
 */
import { describe, it, expect } from 'vitest';
import { WorkflowGraph } from '../graph.js';
import { validateGraphConfig } from '../graph-compiler.js';

function graphWith(routes) {
  const g = new WorkflowGraph({ name: 'labels-test' });
  g.addNode('start', { name: 'start', _isCustomCode: true });
  g.addNode('fix', { name: 'fix', _isCustomCode: true });
  g.addNode('review', { name: 'review', _isCustomCode: true });
  g.setEntryPoint('start');
  g.addConditionalEdges('start', routes, { labels: { fix: 'needs a fix', review: 'looks fine', END: 'nothing to do' } });
  return g;
}

const targetsOf = (g) => g.serialize().edges
  .filter((e) => e.data && e.data.conditionalCode)
  .map((e) => e.target.replace(/^END__\d+$/, 'END'));

describe('labels name the targets of a conditional edge', () => {
  it('a route with unreadable source still gets every declared target, in declaration order', () => {
    // What a bytecode-compiled route looks like to toString(): no literals at all.
    const opaque = function () { return 'x'; };
    opaque.toString = () => '​'.repeat(40);
    expect(targetsOf(graphWith(opaque))).toEqual(['fix', 'review', 'END']);
  });

  it('a readable route adds nothing that is not a declared label or a known node, and loses nothing', () => {
    const readable = (s) => (s.a ? 'review' : s.b ? 'start' : 'fix');
    const t = targetsOf(graphWith(readable));
    expect(t.slice(0, 3)).toEqual(['fix', 'review', 'END']);
    expect(t).toContain('start'); // a literal naming a known node is still a target
    expect(new Set(t).size).toBe(t.length);
  });

  it('a conditional edge with declared labels passes validation even when it carries no readable code', () => {
    const cfg = {
      nodes: [{ id: 'a' }, { id: 'd', type: 'decision' }, { id: 'b' }],
      nodeConfigs: { a: { executeCode: 'x' }, b: { executeCode: 'x' } },
      edges: [{ source: 'a', target: 'd' }, { source: 'd', target: 'b', label: 'go' }],
    };
    expect(validateGraphConfig(cfg).valid).toBe(true);
  });
});
