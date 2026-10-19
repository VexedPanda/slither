/**
 * Same results as satSolve, but reuses one SAT solver per board (for states where every edge is undecided, as in puzzle
 * generation), instead of building and loading every clause for each solve.
 *
 * The vertex constraints are the same for every such state, so they are added once. Each face value constraint is added
 * once, guarded by a selector variable (the clauses only apply when the selector is true). Each solve uses a new "call"
 * variable as its MiniSat assumption: the call variable implies the selectors for the state's face values, and guards the
 * loop-excluding clauses added during that solve. Afterward, the call variable is retired, disabling its clauses.
 *
 * The solution count only depends on the clauses (the possible loops), not the order MiniSat finds them in. The one
 * possible difference is that the iteration limit (MaximumSolverIterationsError) may be reached in different cases.
 */
import { TBoard } from '../board/core/TBoard.ts';
import { TEdge } from '../board/core/TEdge.ts';
import { TVertex } from '../board/core/TVertex.ts';
import { TState } from '../data/core/TState.ts';
import EdgeState from '../data/edge-state/EdgeState.ts';
import { TEdgeStateData } from '../data/edge-state/TEdgeStateData.ts';
import { TFaceValueData } from '../data/face-value/TFaceValueData.ts';
import { SatSolveOptions, satSolve } from './SATSolver.ts';
import { MaximumSolverIterationsError } from './errors/MaximumSolverIterationsError.ts';
import { MultipleSolutionsError } from './errors/MultipleSolutionsError.ts';
// @ts-expect-error
import Logic from './logic-solver/logic-solver.js';

import { Combination } from 'scenerystack/dot';

// Start over with a new solver when it gets this many clauses (retired clauses still take memory)
const MAX_CLAUSES = 200000;

class IncrementalSATSolver {
  private readonly solver = new Logic.Solver();
  private readonly edgeToVariableNumber = new Map<TEdge, number>();
  private readonly variableNameToEdge = new Map<string, TEdge>();
  private readonly faceSelectors = new Map<string, number>(); // `${faceIndex},${value}` => selector variable number
  private callCount = 0;
  // Every clause added (including logic-solver's two initial ones), even after they are dropped from solver.clauses
  private addedClauseCount = this.solver.clauses.length;

  public constructor(private readonly board: TBoard) {
    // Same variable names (and order) as satSolve
    board.edges.forEach((edge, i) => {
      const name = `edge${i + 1}`;
      this.edgeToVariableNumber.set(edge, this.solver.getVarNum(name));
      this.variableNameToEdge.set(name, edge);
    });

    // Force there to be at least one edge
    this.addClause(board.edges.map((edge) => this.term(edge)));

    for (const vertex of board.vertices) {
      // Zero or two edges: no three edges, and each edge implies another edge
      const edges = vertex.edges;
      this.forEachCombinationOfSize(edges, 3, (combination) => {
        this.addClause(combination.map((edge) => -this.term(edge)));
      });
      for (const edge of edges) {
        this.addClause([-this.term(edge), ...edges.filter((otherEdge) => otherEdge !== edge).map((e) => this.term(e))]);
      }
    }
  }

  public get clauseCount(): number {
    return this.addedClauseCount;
  }

  private term(edge: TEdge): number {
    return this.edgeToVariableNumber.get(edge)!;
  }

  private addClause(terms: number[]): void {
    this.addedClauseCount++;
    this.solver._addClause(new Logic.Clause(terms));
  }

  private forEachCombinationOfSize(edges: TEdge[], size: number, callback: (combination: readonly TEdge[]) => void) {
    Combination.forEachCombination(edges, (combination: readonly TEdge[]) => {
      if (combination.length === size) {
        callback(combination);
      }
    });
  }

  // logic-solver keeps every clause (to give them to MiniSat when solving), which on large boards is hundreds of MB of
  // long loop-excluding clauses. Once MiniSat has them, they aren't needed (we don't use logic-solver's formulas).
  private dropClausesGivenToMiniSat(): void {
    if (this.solver._numClausesAddedToMiniSat === this.solver.clauses.length) {
      this.solver.clauses.length = 0;
      this.solver._numClausesAddedToMiniSat = 0;
    }
  }

  // A variable that (when true) requires exactly `value` of the face's edges
  private getFaceSelector(faceIndex: number, value: number): number {
    const key = `${faceIndex},${value}`;
    const existingSelector = this.faceSelectors.get(key);
    if (existingSelector !== undefined) {
      return existingSelector;
    }

    const selector: number = this.solver.getVarNum(`face${key}`);
    this.faceSelectors.set(key, selector);

    const edges = this.board.faces[faceIndex].edges;
    if (value === 0) {
      for (const edge of edges) {
        this.addClause([-selector, -this.term(edge)]);
      }
    } else {
      // at least `value`
      this.addClause([-selector, ...edges.map((edge) => this.term(edge))]);
      this.forEachCombinationOfSize(edges, edges.length - value + 1, (combination) => {
        this.addClause([-selector, ...combination.map((edge) => this.term(edge))]);
      });
      // at most `value`
      this.forEachCombinationOfSize(edges, value + 1, (combination) => {
        this.addClause([-selector, ...combination.map((edge) => -this.term(edge))]);
      });
    }

    return selector;
  }

  public solve(state: TState<TEdgeStateData & TFaceValueData>, options: SatSolveOptions): TEdge[][] {
    const callVariable = this.solver.getVarNum(`call${this.callCount++}`);
    let hasSolved = false;

    try {
      this.board.faces.forEach((face, faceIndex) => {
        const faceValue = state.getFaceValue(face);
        if (faceValue !== null) {
          this.addClause([-callVariable, this.getFaceSelector(faceIndex, faceValue)]);
        }
      });

      const getBlackEdges = (): TEdge[] | null => {
        const solution = this.solver.solve(callVariable);
        hasSolved = true;
        this.dropClausesGivenToMiniSat();

        if (solution) {
          const edges: TEdge[] = [];
          for (const variable of solution.getTrueVars()) {
            const edge = this.variableNameToEdge.get(variable);
            if (edge) {
              edges.push(edge);
            }
          }
          return edges;
        } else {
          return null;
        }
      };

      // Same as satSolve from here
      const findLoops = (): {
        touchingValueLoops: TEdge[][];
        nonTouchingValueLoops: TEdge[][];
      } => {
        const newBlackEdges = getBlackEdges();
        if (newBlackEdges === null) {
          return {
            touchingValueLoops: [],
            nonTouchingValueLoops: [],
          };
        }

        const blackEdgeSet = new Set(newBlackEdges);

        const touchingValueLoops: TEdge[][] = [];
        const nonTouchingValueLoops: TEdge[][] = [];

        while (blackEdgeSet.size) {
          const startEdge = blackEdgeSet.values().next().value!;

          const loop: TEdge[] = [];
          let vertex: TVertex = startEdge.end;
          let currentEdge: TEdge | null = startEdge;

          let touchingValue = false;

          while (currentEdge) {
            blackEdgeSet.delete(currentEdge);
            loop.push(currentEdge);

            touchingValue = touchingValue || currentEdge.faces.some((face) => state.getFaceValue(face) !== null);

            currentEdge = vertex.edges.find((e) => blackEdgeSet.has(e)) ?? null;

            if (currentEdge) {
              vertex = currentEdge.getOtherVertex(vertex);
            }
          }

          (touchingValue ? touchingValueLoops : nonTouchingValueLoops).push(loop);
        }

        return {
          touchingValueLoops,
          nonTouchingValueLoops,
        };
      };

      const solutions: TEdge[][] = [];
      let iterationNumber = 0;

      while (true) {
        const loops = findLoops();

        if (!loops.touchingValueLoops.length) {
          break;
        }

        if (loops.touchingValueLoops.length === 1) {
          solutions.push(loops.touchingValueLoops[0]);

          if (solutions.length > 1 && options.failOnMultipleSolutions) {
            throw new MultipleSolutionsError(solutions);
          }
        }

        // Exclude these loops, only for this call
        for (const loop of [...loops.touchingValueLoops, ...loops.nonTouchingValueLoops]) {
          this.addClause([-callVariable, ...loop.map((edge) => -this.term(edge))]);
        }

        iterationNumber++;

        if (iterationNumber > options.maxIterations) {
          throw new MaximumSolverIterationsError();
        }
      }

      return solutions;
    } finally {
      // Permanently false, so its clauses no longer apply (any not yet given to MiniSat will be satisfied when added)
      // (only if MiniSat knows about the variable yet; otherwise its clauses never apply anyway)
      if (hasSolved) {
        this.solver._minisat.retireVar(callVariable);
      }
    }
  }
}

const solverMap = new WeakMap<TBoard, IncrementalSATSolver>();

export const incrementalSatSolve = (
  board: TBoard,
  state: TState<TEdgeStateData & TFaceValueData>,
  options: SatSolveOptions,
): TEdge[][] => {
  // Only for states where every edge is undecided
  if (!board.edges.every((edge) => state.getEdgeState(edge) === EdgeState.WHITE)) {
    return satSolve(board, state, options);
  }

  return Logic.disablingAssertions(() => {
    let solver = solverMap.get(board);
    if (!solver || solver.clauseCount > MAX_CLAUSES) {
      solver = new IncrementalSATSolver(board);
      solverMap.set(board, solver);
    }

    try {
      return solver.solve(state, options);
    } catch (e) {
      if (e instanceof MultipleSolutionsError || e instanceof MaximumSolverIterationsError) {
        throw e;
      }

      // e.g. MiniSat aborted (such as running out of memory), which leaves the solver unusable. Retry once with a new
      // solver, which doesn't have the retired clauses.
      console.warn('Incremental SAT solve failed, retrying with a new solver', e);
      solver = new IncrementalSATSolver(board);
      solverMap.set(board, solver);
      return solver.solve(state, options);
    }
  });
};
