// Generation benchmark: times seeded puzzle generation, and hashes each puzzle so changes can be checked to produce
// identical puzzles. Usage: bench.html?boards=square-10x10,hexagonal-4&difficulties=EASY,HARD&seeds=1,2,3&sleep=1000
// @ts-expect-error
import BenchWorker from '../workers/benchWorker.ts?worker';

const params = new URLSearchParams(location.search);
const boards = (params.get('boards') ?? 'square-10x10').split(',');
const difficulties = (params.get('difficulties') ?? 'NO_LIMIT,EASY,MEDIUM,HARD').split(',');
const seeds = (params.get('seeds') ?? '1,2,3').split(',').map(Number);
const sleepCount = Number(params.get('sleep') ?? 0);

const output = document.createElement('pre');
output.id = 'output';
document.body.appendChild(output);
const log = (s: string) => (output.textContent += s + '\n');

const worker = new BenchWorker();
const request = (message: unknown): Promise<any> =>
  new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type === 'result') {
        worker.removeEventListener('message', listener);
        resolve(event.data);
      }
    };
    worker.addEventListener('message', listener);
    worker.postMessage(message);
  });

(async () => {
  if (sleepCount) {
    const { ms } = await request({ type: 'sleep', count: sleepCount });
    log(`sleep(0) x${sleepCount}: ${ms.toFixed(0)}ms`);
  }

  const results: unknown[] = [];
  for (const board of boards) {
    // Warm-up (pattern data loading, JIT), not reported
    await request({ type: 'generate', board, difficulty: difficulties[0], seed: 0 });

    for (const difficulty of difficulties) {
      let total = 0;
      for (const seed of seeds) {
        const result = await request({ type: 'generate', board, difficulty, seed });
        total += result.ms;
        results.push({ board, difficulty, seed, ...result });
        log(`${board} ${difficulty} seed=${seed}: ${result.ms.toFixed(0)}ms resets=${result.resets} hash=${result.hash}`);
      }
      log(`${board} ${difficulty} TOTAL: ${total.toFixed(0)}ms`);
    }
  }
  log('DONE');
  // @ts-expect-error
  window.benchResults = results;
})();
