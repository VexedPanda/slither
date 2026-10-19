/**
 * Solves the puzzle using a SAT solver, providing all solutions if helpful.
 *
 * Patterned after the algorithm noted in https://www.dougandjean.com/slither/howitsolves.html (thanks!).
 *
 * Uses https://www.npmjs.com/package/logic-solver (MIT), located under the logic-solver directory (made compatible with ES6 modules).
 *
 * Could in the future consider https://www.comp.nus.edu.sg/~gregory/sat/.
 */
import { TBoard } from '../board/core/TBoard.ts';
import { TEdge } from '../board/core/TEdge.ts';
import { TStructure } from '../board/core/TStructure.ts';
import { TVertex } from '../board/core/TVertex.ts';
import { CompleteData } from '../data/combined/CompleteData.ts';
import { TCompleteData } from '../data/combined/TCompleteData.ts';
import { TState } from '../data/core/TState.ts';
import EdgeState from '../data/edge-state/EdgeState.ts';
import { TEdgeStateData } from '../data/edge-state/TEdgeStateData.ts';
import { TFaceValueData } from '../data/face-value/TFaceValueData.ts';
import { simpleRegionIsSolved } from '../data/simple-region/TSimpleRegionData.ts';
import { getSolvedPuzzle } from '../generator/getSolvedPuzzle.ts';
import { TSolvablePropertyPuzzle } from '../puzzle/TPuzzle.ts';
import { MaximumSolverIterationsError } from './errors/MaximumSolverIterationsError.ts';
import { MultipleSolutionsError } from './errors/MultipleSolutionsError.ts';
// @ts-expect-error
import Logic from './logic-solver/logic-solver.js';

import { Property } from 'scenerystack/axon';
import { Combination } from 'scenerystack/dot';

import assert, { assertEnabled } from '../../workarounds/assert.ts';

export const getSolvablePropertyPuzzle = <
  Structure extends TStructure = TStructure,
  Data extends TCompleteData = TCompleteData,
>(
  board: TBoard<Structure>,
  currentState: TState<Data>,
): TSolvablePropertyPuzzle<Structure, Data> | null => {
  try {
    // SAT solver doesn't work with fully solved boards, check this first
    if (simpleRegionIsSolved(currentState)) {
      return {
        board,
        stateProperty: new Property(currentState),
        solution: getSolvedPuzzle(board, currentState, []),
      };
    }

    // The solution must only depend on the clues, not on anything the player has marked (e.g. a restored puzzle with
    // a mistaken line would otherwise get that line baked into its solution, leaving the rest of the solution
    // unresolved, so correct marks would be highlighted as incorrect).
    const cleanState = CompleteData.fromFaces(board, (face) =>
      currentState.getFaceValue(face),
    ) as unknown as TState<Data>;

    const solutions = satSolve(board, cleanState, {
      maxIterations: 10000,
      failOnMultipleSolutions: true,
    });

    if (solutions.length !== 1) {
      return null;
    }

    const solution = getSolvedPuzzle(board, cleanState, solutions[0]);
    assertEnabled() && assert(simpleRegionIsSolved(solution.solvedState));

    return {
      board,
      stateProperty: new Property(currentState),
      solution: solution,
    };
  } catch (e) {
    if (e instanceof MultipleSolutionsError) {
      return null;
    } else {
      throw e;
    }
  }
};

export type SatSolveOptions = {
  maxIterations: number;
  failOnMultipleSolutions: boolean;
};

// TODO: in the future, vertex state might help! anything that gives us more helpful clauses? maybe not
export const satSolve = (
  board: TBoard,
  state: TState<TEdgeStateData & TFaceValueData>,
  options: SatSolveOptions,
): TEdge[][] => {
  // Logic-solver's argument checks are a large part of clause generation time, and our inputs are generated
  // Disposed when done, rather than waiting for garbage collection to free its native memory
  const solver = new Logic.Solver();
  try {
    return Logic.disablingAssertions(() => satSolveWithoutAssertions(solver, board, state, options));
  } finally {
    solver.dispose();
  }
};

const satSolveWithoutAssertions = (
  solver: Logic.Solver,
  board: TBoard,
  state: TState<TEdgeStateData & TFaceValueData>,
  options: SatSolveOptions,
): TEdge[][] => {
  // also, we might as well apply a "normal" solver first, to reduce the number of variables/clauses needed?
  // for instance, this should immediately outlaw 0s

  // TODO: see if outlawing simple loops helps performance later?

  // NOTE: for puzzle generation, holes are either "inside" or "outside" of the puzzle!

  const blackEdges = board.edges.filter((edge) => state.getEdgeState(edge) === EdgeState.BLACK);
  const whiteEdges = board.edges.filter((edge) => state.getEdgeState(edge) === EdgeState.WHITE);

  assertEnabled() && assert(whiteEdges.length, 'Need to have at least some undefined edges to use solver');

  const whiteEdgeSet = new Set(whiteEdges); // For faster lookup

  const edgeToVariable = new Map(whiteEdges.map((edge, i) => [edge, `edge${i + 1}`]));
  const variableToEdge = new Map(whiteEdges.map((edge, i) => [`edge${i + 1}`, edge]));

  // Every constraint below is a plain clause, so we add numeric clauses directly. Going through Logic.or() etc. was
  // most of the solve time (formula objects, flattening, and parsing variable names for every term).
  const edgeToVariableNumber = new Map(whiteEdges.map((edge) => [edge, solver.getVarNum(edgeToVariable.get(edge))]));

  const term = (edge: TEdge): number => {
    const result = edgeToVariableNumber.get(edge);
    assertEnabled() && assert(result !== undefined, 'Edge not found!');
    return result!;
  };
  const notTerm = (edge: TEdge): number => -term(edge);

  const addClause = (terms: number[]) => {
    solver._addClause(new Logic.Clause(terms));
  };

  const none = (edges: TEdge[]) => {
    for (const edge of edges) {
      addClause([notTerm(edge)]);
    }
  };

  const some = (edges: TEdge[]) => {
    addClause(edges.map(term));
  };

  const notAll = (edges: TEdge[]) => {
    addClause(edges.map(notTerm));
  };

  const atLeastN = (edges: TEdge[], n: number) => {
    if (n > 0) {
      some(edges);
      Combination.forEachCombination(edges, (combination: readonly TEdge[]) => {
        if (combination.length === edges.length - n + 1) {
          // NOT( AND( NOT ... ) ), as a plain clause
          addClause(combination.map(term));
        }
      });
    }
  };

  const atMostN = (edges: TEdge[], n: number) => {
    Combination.forEachCombination(edges, (combination: readonly TEdge[]) => {
      if (combination.length === n + 1) {
        addClause(combination.map(notTerm));
      }
    });
  };

  const not1 = (edges: TEdge[]) => {
    // NOT( exactlyOne ) as plain clauses (each edge implies another edge), which avoids the auxiliary variables and
    // formula expansion of Logic.exactlyOne
    for (const edge of edges) {
      addClause([notTerm(edge), ...edges.filter((otherEdge) => otherEdge !== edge).map(term)]);
    }
  };

  const zeroOrTwo = (edges: TEdge[]) => {
    atMostN(edges, 2);
    not1(edges);
  };

  const exactlyN = (edges: TEdge[], n: number) => {
    if (n === 0) {
      none(edges);
    } else {
      atLeastN(edges, n);
      atMostN(edges, n);
    }
  };

  // Add clauses
  some(whiteEdges); // Force there to be at least one edge

  for (const vertex of board.vertices) {
    let blackCount = 0;
    let whiteCount = 0;

    let edges: TEdge[] = [];

    for (const edge of vertex.edges) {
      const edgeState = state.getEdgeState(edge);
      if (edgeState === EdgeState.BLACK) {
        blackCount++;
      } else if (edgeState === EdgeState.WHITE) {
        whiteCount++;
        edges.push(edge);
      }
    }

    if (whiteCount === 0) {
      continue;
    }

    if (blackCount === 0) {
      zeroOrTwo(edges);
    } else if (blackCount === 1) {
      exactlyN(edges, 1);
    } else {
      none(edges);
    }
  }

  let hasFaceWithValue = false;
  for (const face of board.faces) {
    const faceValue = state.getFaceValue(face);
    if (faceValue === null) {
      continue;
    }

    hasFaceWithValue = true;

    let blackCount = 0;
    let whiteCount = 0;

    let edges: TEdge[] = [];

    for (const edge of face.edges) {
      const edgeState = state.getEdgeState(edge);
      if (edgeState === EdgeState.BLACK) {
        blackCount++;
      } else if (edgeState === EdgeState.WHITE) {
        whiteCount++;
        edges.push(edge);
      }
    }

    if (whiteCount === 0) {
      continue;
    }

    const openCount = Math.max(faceValue - blackCount, 0); // sanity check!!!

    exactlyN(edges, openCount);
  }
  assertEnabled() && assert(hasFaceWithValue, 'No faces with values!');

  const getBlackEdges = (): TEdge[] | null => {
    let solution: Logic.Solution | null = null;
    Logic.disablingAssertions(() => {
      solution = solver.solve();
    });

    if (solution) {
      const variables = solution.getTrueVars();
      return variables.map((variable: string) => variableToEdge.get(variable));
    } else {
      return null;
    }
  };

  let iterationNumber = 0;

  // TODO: can we add async/await into minisat somehow? (or web-worker it?)
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

    // Combine the SAT-solved edges with the excluded edges
    const blackEdgeSet = new Set([...newBlackEdges, ...blackEdges]);

    const touchingValueLoops: TEdge[][] = [];
    const nonTouchingValueLoops: TEdge[][] = [];

    while (blackEdgeSet.size) {
      const startEdge = blackEdgeSet.values().next().value;

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

      assertEnabled() &&
        assert(
          loop[0].vertices.some((vertex) => loop[loop.length - 1].vertices.includes(vertex)),
          'Loop is not a loop!',
        );

      (touchingValue ? touchingValueLoops : nonTouchingValueLoops).push(loop);
    }

    return {
      touchingValueLoops,
      nonTouchingValueLoops,
    };
  };

  const solutions: TEdge[][] = [];

  // https://www.dougandjean.com/slither/howitsolves.html describes this partial approach well, thank you!!!

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

    const allLoops = [...loops.touchingValueLoops, ...loops.nonTouchingValueLoops];

    for (const loop of allLoops) {
      notAll(loop.filter((edge) => whiteEdgeSet.has(edge)));
    }

    iterationNumber++;

    if (iterationNumber > options.maxIterations) {
      throw new MaximumSolverIterationsError();
    }
  }

  return solutions;
};
