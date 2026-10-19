import { FormulaSolver } from '../../logic/FormulaSolver.ts';
import { Term } from '../../logic/Term.ts';
import { logicNot, logicOr } from '../../logic/operations.ts';
import { TFeature } from '../feature/TFeature.ts';
import { getStructuralFeatures } from '../feature/getStructuralFeatures.ts';
import { TPatternBoard } from '../pattern-board/TPatternBoard.ts';
import { TPatternEdge } from '../pattern-board/TPatternEdge.ts';

export class PatternBoardSolver {
  private readonly solver: FormulaSolver<TPatternEdge> = new FormulaSolver();
  private readonly getFormula: (edge: TPatternEdge) => Term<TPatternEdge>;

  public constructor(patternBoard: TPatternBoard) {
    this.getFormula = (edge: TPatternEdge) => new Term<TPatternEdge>(edge, `e${edge.index}`);

    for (const feature of getStructuralFeatures(patternBoard)) {
      this.addFeature(feature);
    }

    // We need to inform it of our one edge
    if (patternBoard.vertices.length === 0) {
      this.solver.addFormula(
        logicOr([this.getFormula(patternBoard.edges[0]), logicNot(this.getFormula(patternBoard.edges[0]))]),
      );
    }
  }

  public addFeature(feature: TFeature): void {
    this.solver.addFormula(feature.getPossibleFormula(this.getFormula));
  }

  public getNextSolution(): TPatternEdge[] | null {
    return this.solver.getNextSolution();
  }

  public getRemainingSolutions(): TPatternEdge[][] {
    const result: TPatternEdge[][] = [];

    while (true) {
      const solution = this.getNextSolution();

      if (solution) {
        result.push(solution);
      } else {
        break;
      }
    }

    return result;
  }

  // Frees the native solver now, instead of when this is garbage collected. It can't be used afterward.
  public dispose(): void {
    this.solver.dispose();
  }

  // Runs with a solver for the features, disposing it afterward
  private static withSolver<T>(
    patternBoard: TPatternBoard,
    features: TFeature[],
    callback: (solver: PatternBoardSolver) => T,
  ): T {
    const solver = new PatternBoardSolver(patternBoard);
    try {
      for (const feature of features) {
        solver.addFeature(feature);
      }

      return callback(solver);
    } finally {
      solver.dispose();
    }
  }

  public static forEachSolution(
    patternBoard: TPatternBoard,
    features: TFeature[],
    callback: (solution: TPatternEdge[]) => void,
  ): void {
    PatternBoardSolver.withSolver(patternBoard, features, (solver) => {
      while (true) {
        // TODO: figure out if we should expose this for debugging (helps)
        // console.log( solver.solver.solver._clauseStrings() );

        const solution = solver.getNextSolution();

        if (solution) {
          callback(solution);
        } else {
          break;
        }
      }
    });
  }

  public static countSolutions(patternBoard: TPatternBoard, features: TFeature[]): number {
    let count = 0;

    PatternBoardSolver.forEachSolution(patternBoard, features, () => {
      count++;
    });

    return count;
  }

  public static getSolutions(patternBoard: TPatternBoard, features: TFeature[]): TPatternEdge[][] {
    return PatternBoardSolver.withSolver(patternBoard, features, (solver) => solver.getRemainingSolutions());
  }

  public static hasSolution(patternBoard: TPatternBoard, features: TFeature[]): boolean {
    return PatternBoardSolver.withSolver(patternBoard, features, (solver) => solver.getNextSolution() !== null);
  }
}
