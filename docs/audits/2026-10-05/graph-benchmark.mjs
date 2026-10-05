import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const require = createRequire(resolve('apps/desktop/package.json'));
const { build } = require('esbuild');
const source = 'packages/core/src/graph.ts';
const baselineCommit = 'a32dffc873556dd2649699324e52a2e5d320cbc0';
const before = execFileSync('git', ['show', `${baselineCommit}:${source}`], { encoding: 'utf8', windowsHide: true });
const after = await readFile(source, 'utf8');
async function compile(contents) {
  const result = await build({ stdin: { contents, resolveDir: resolve('packages/core/src'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const [baseline, current] = await Promise.all([compile(before), compile(after)]);
const graph = {
  nodes: Array.from({ length: 2500 }, (_, index) => ({ id: String(index).padStart(5, '0'), type: 'prompt', inputs: [{ id: 'in', kind: 'text' }], outputs: [{ id: 'out', kind: 'text' }] })),
  edges: Array.from({ length: 2499 }, (_, index) => ({ id: `e${index}`, source: String(index).padStart(5, '0'), target: String(index + 1).padStart(5, '0'), sourcePort: 'out', targetPort: 'in' })),
};
const samples = { before: [], after: [] };
for (let round = 0; round < 13; round++) {
  const pair = round % 2 ? [['after', current], ['before', baseline]] : [['before', baseline], ['after', current]];
  for (const [name, implementation] of pair) {
    const start = performance.now();
    const result = implementation.validateGraph(graph);
    const elapsed = performance.now() - start;
    if (result.errors.length) throw new Error('Invalid benchmark graph');
    if (round >= 3) samples[name].push(elapsed);
  }
}
const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
  values.sort((a,b) => a-b);
  return [name, { medianMs: Number(((values[4] + values[5])/2).toFixed(2)), minMs: Number(values[0].toFixed(2)), maxMs: Number(values.at(-1).toFixed(2)) }];
}));
const result = { baselineCommit, node: process.version, nodes: 2500, edges: 2499, warmupRounds: 3, measuredRounds: 10, ordering: 'alternating before/after', summary, note: 'Local synthetic graph validation only; not network throughput or total UI frame rate.' };
await writeFile(new URL('./graph-benchmark.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
