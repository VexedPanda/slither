// Seeded generation benchmark (see bench.ts), run in a worker like the real generator.
import { TinyEmitter, TinyProperty } from 'scenerystack/axon';
import { dotRandom } from 'scenerystack/dot';

import { PolygonGeneratorBoard } from '../model/board/core/PolygonGeneratorBoard.ts';
import CanSolveDifficulty from '../model/generator/CanSolveDifficulty.ts';
import { generateAdditiveConstrained } from '../model/generator/generateAdditiveConstrained.ts';
import { serializeSolvedPuzzle } from '../model/generator/serializeSolvedPuzzle.ts';

import { sleep } from '../util/sleep.ts';

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(16);
};

self.addEventListener('message', async (event) => {
  const data = event.data;

  if (data.type === 'sleep') {
    const start = performance.now();
    for (let i = 0; i < data.count; i++) {
      await sleep(0);
    }
    self.postMessage({ type: 'result', ms: performance.now() - start });
    return;
  }

  const board = PolygonGeneratorBoard.fromShortName(data.board);
  const difficulty = CanSolveDifficulty.enumeration.getValue(data.difficulty);

  // Deterministic randomness, so the same seed should give the same puzzle
  dotRandom.nextDouble = mulberry32(data.seed);

  let resets = 0;
  const resetEmitter = new TinyEmitter();
  resetEmitter.addListener(() => resets++);

  const start = performance.now();
  const puzzle = await generateAdditiveConstrained(
    board,
    difficulty,
    new TinyProperty(false),
    new TinyEmitter(),
    new TinyEmitter(),
    resetEmitter,
  );
  const ms = performance.now() - start;

  const serialized = JSON.stringify(serializeSolvedPuzzle(puzzle!));
  self.postMessage({ type: 'result', ms, resets, hash: hash(serialized) });
});

self.postMessage({ type: 'loaded' });
