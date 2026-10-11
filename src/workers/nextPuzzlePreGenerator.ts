import { generateAdditiveConstrainedWithWorker } from './getGenerationAdditiveConstrainedWorker.ts';

import { TinyEmitter, TinyProperty } from 'phet-lib/axon';

import { PolygonGenerator } from '../model/board/PolygonGenerator.ts';
import { PolygonGeneratorBoard } from '../model/board/core/PolygonGeneratorBoard.ts';
import { TStructure } from '../model/board/core/TStructure.ts';
import { TCompleteData } from '../model/data/combined/TCompleteData.ts';
import FaceValue from '../model/data/face-value/FaceValue.ts';
import CanSolveDifficulty from '../model/generator/CanSolveDifficulty.ts';
import { TSolvedPuzzle } from '../model/generator/TSolvedPuzzle.ts';

type PreGeneratedPuzzle = {
  key: string;
  interruptedProperty: TinyProperty<boolean>;
  promise: Promise<TSolvedPuzzle<TStructure, TCompleteData> | null>;
  result: TSolvedPuzzle<TStructure, TCompleteData> | null;
};

// At most one puzzle is pre-generated (or being pre-generated) at a time
let preGenerated: PreGeneratedPuzzle | null = null;

// Whether a pre-generated puzzle is ready, or one is being generated
export const preGeneratedPuzzleReadyProperty = new TinyProperty(false);
export const preGeneratingPuzzleProperty = new TinyProperty(false);

const updateStatus = () => {
  preGeneratedPuzzleReadyProperty.value = !!preGenerated?.result;
  preGeneratingPuzzleProperty.value = !!preGenerated && !preGenerated.result;
};

// Snapshots the settings, since parameters objects can be mutated after this is called
export const getPreGenerationKey = (
  generator: PolygonGenerator,
  parameters: Record<string, any>,
  canSolveDifficulty: CanSolveDifficulty,
): string => {
  return `${generator.name}/${JSON.stringify(parameters)}/${canSolveDifficulty.name}`;
};

export const clearPreGeneratedPuzzle = (): void => {
  if (preGenerated) {
    preGenerated.interruptedProperty.value = true;
    preGenerated = null;
    updateStatus();
  }
};

// Starts generating a puzzle in the background (replacing any other pre-generated puzzle with different settings)
export const startPreGeneratingPuzzle = (
  generator: PolygonGenerator,
  parameters: Record<string, any>,
  canSolveDifficulty: CanSolveDifficulty,
): void => {
  const key = getPreGenerationKey(generator, parameters, canSolveDifficulty);

  if (preGenerated?.key === key) {
    return;
  }
  clearPreGeneratedPuzzle();

  const board = PolygonGeneratorBoard.get(generator, { ...parameters });
  const interruptedProperty = new TinyProperty(false);

  const entry: PreGeneratedPuzzle = {
    key: key,
    interruptedProperty: interruptedProperty,
    promise: generateAdditiveConstrainedWithWorker(
      board,
      canSolveDifficulty,
      interruptedProperty,
      // Progress is not displayed for background generation
      new TinyEmitter<[index: number, state: FaceValue]>(),
      new TinyEmitter<[index: number, state: FaceValue]>(),
      new TinyEmitter(),
    ),
    result: null,
  };
  preGenerated = entry;
  updateStatus();

  entry.promise.then((result) => {
    if (preGenerated === entry) {
      if (result) {
        entry.result = result;
      } else {
        // Failed, don't retry
        preGenerated = null;
      }
      updateStatus();
    }
  });
};

/**
 * If a puzzle was (or is being) pre-generated with these settings, takes it (resolving when it is complete). Otherwise
 * stops any pre-generation with different settings (so it doesn't compete with a new generation) and returns null.
 */
export const takePreGeneratedPuzzle = (
  key: string,
): Promise<TSolvedPuzzle<TStructure, TCompleteData> | null> | null => {
  if (preGenerated?.key === key) {
    const promise = preGenerated.promise;
    preGenerated = null;
    updateStatus();
    return promise;
  } else {
    clearPreGeneratedPuzzle();
    return null;
  }
};
