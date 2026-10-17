import { generateAdditiveConstrainedWithWorker } from './getGenerationAdditiveConstrainedWorker.ts';

import { TinyEmitter, TinyProperty } from 'scenerystack/axon';

import { PolygonGenerator } from '../model/board/PolygonGenerator.ts';
import { PolygonGeneratorBoard } from '../model/board/core/PolygonGeneratorBoard.ts';
import { TStructure } from '../model/board/core/TStructure.ts';
import { polygonGenerators } from '../model/board/generators/polygonGenerators.ts';
import { TCompleteData } from '../model/data/combined/TCompleteData.ts';
import FaceValue from '../model/data/face-value/FaceValue.ts';
import CanSolveDifficulty from '../model/generator/CanSolveDifficulty.ts';
import { TSerializedSolvedPuzzle, TSolvedPuzzle } from '../model/generator/TSolvedPuzzle.ts';
import { canSolveDifficultyProperty } from '../model/generator/canSolveDifficultyProperty.ts';
import { deserializeSolvedPuzzle } from '../model/generator/deserializeSolvedPuzzle.ts';
import { serializeSolvedPuzzle } from '../model/generator/serializeSolvedPuzzle.ts';

type PreGeneratedPuzzle = {
  key: string;
  interruptedProperty: TinyProperty<boolean>;
  promise: Promise<TSolvedPuzzle<TStructure, TCompleteData> | null>;
  result: TSolvedPuzzle<TStructure, TCompleteData> | null;
};

// Persisted to localStorage, so that generation can resume (or a finished puzzle can be used) after a reload
type StoredGenerationState = {
  generator: string;
  parameters: Record<string, any>;
  canSolveDifficulty: string;
  solvedPuzzle: TSerializedSolvedPuzzle | null;
};

const STORAGE_KEY = 'nextPuzzleGenerationState';

// At most one puzzle is pre-generated (or being pre-generated) at a time
let preGenerated: PreGeneratedPuzzle | null = null;

// Whether a pre-generated puzzle is ready, or one is being generated
export const preGeneratedPuzzleReadyProperty = new TinyProperty(false);
export const preGeneratingPuzzleProperty = new TinyProperty(false);

const updateStatus = () => {
  preGeneratedPuzzleReadyProperty.value = !!preGenerated?.result;
  preGeneratingPuzzleProperty.value = !!preGenerated && !preGenerated.result;
};

const storeGenerationState = (
  generator: PolygonGenerator,
  parameters: Record<string, any>,
  canSolveDifficulty: CanSolveDifficulty,
  solvedPuzzle: TSolvedPuzzle<TStructure, TCompleteData> | null,
): void => {
  const state: StoredGenerationState = {
    generator: generator.name,
    parameters: parameters,
    canSolveDifficulty: canSolveDifficulty.name,
    solvedPuzzle: solvedPuzzle ? serializeSolvedPuzzle(solvedPuzzle) : null,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // e.g. quota exceeded, persistence is best-effort
    console.warn('Failed to persist puzzle generation state', e);
  }
};

const loadGenerationState = (): StoredGenerationState | null => {
  try {
    const string = localStorage.getItem(STORAGE_KEY);
    return string ? JSON.parse(string) : null;
  } catch (e) {
    return null;
  }
};

// Snapshots the settings, since parameters objects can be mutated after this is called
const getPreGenerationKey = (
  generator: PolygonGenerator,
  parameters: Record<string, any>,
  canSolveDifficulty: CanSolveDifficulty,
): string => {
  return `${generator.name}/${JSON.stringify(parameters)}/${canSolveDifficulty.name}`;
};

const clearPreGeneratedPuzzle = (): void => {
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

  parameters = { ...parameters };
  storeGenerationState(generator, parameters, canSolveDifficulty, null);

  const board = PolygonGeneratorBoard.get(generator, parameters);
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
        storeGenerationState(generator, parameters, canSolveDifficulty, result);
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
 *
 * Either way, these settings are remembered (without a finished puzzle), so that if the page is closed before the
 * requested puzzle is loaded, generation resumes on the next load.
 */
export const takePreGeneratedPuzzle = (
  generator: PolygonGenerator,
  parameters: Record<string, any>,
  canSolveDifficulty: CanSolveDifficulty,
): Promise<TSolvedPuzzle<TStructure, TCompleteData> | null> | null => {
  const key = getPreGenerationKey(generator, parameters, canSolveDifficulty);

  storeGenerationState(generator, { ...parameters }, canSolveDifficulty, null);

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

// Before anything has been generated, use the settings the Generate panel will show (see GenerateNode)
const getGenerateNodeSettings = (): StoredGenerationState => {
  let storedParameters: Record<string, any> | null = null;
  try {
    storedParameters = JSON.parse(localStorage.getItem('polygonGeneratorParameters') ?? 'null');
  } catch (e) {
    // ignore, use defaults
  }

  const generator =
    polygonGenerators.find((generator) => generator.name === localStorage.getItem('polygonGeneratorProperty')) ??
    polygonGenerators[0];

  const parameters: Record<string, any> = {};
  for (const key of Object.keys(generator.parameters)) {
    parameters[key] =
      storedParameters && key in storedParameters ? storedParameters[key] : generator.defaultParameterValues[key];
  }

  return {
    generator: generator.name,
    parameters: parameters,
    canSolveDifficulty: canSolveDifficultyProperty.value.name,
    solvedPuzzle: null,
  };
};

/**
 * Restores the persisted generation state: a finished puzzle is made ready
 * immediately, otherwise generation is restarted with the last-used settings (in-progress worker state is not
 * persisted, so an unfinished generation starts over).
 */
export const resumePreGeneration = (): void => {
  if (preGenerated) {
    return;
  }

  const state = loadGenerationState() ?? getGenerateNodeSettings();

  const generator = polygonGenerators.find((generator) => generator.name === state.generator);
  const canSolveDifficulty = CanSolveDifficulty.enumeration.getValue(state.canSolveDifficulty);
  if (!generator || !canSolveDifficulty) {
    return;
  }

  if (state.solvedPuzzle) {
    try {
      const result = deserializeSolvedPuzzle(state.solvedPuzzle);
      preGenerated = {
        key: getPreGenerationKey(generator, state.parameters, canSolveDifficulty),
        interruptedProperty: new TinyProperty(false),
        promise: Promise.resolve(result),
        result: result,
      };
      updateStatus();
      return;
    } catch (e) {
      console.warn('Failed to restore pre-generated puzzle, regenerating', e);
    }
  }

  startPreGeneratingPuzzle(generator, state.parameters, canSolveDifficulty);
};
