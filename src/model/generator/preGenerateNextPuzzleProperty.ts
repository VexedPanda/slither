import { LocalStorageBooleanProperty } from '../../util/localStorage.ts';

// Whether to generate the next puzzle in the background (with the same settings) while the current one is played
export const preGenerateNextPuzzleProperty = new LocalStorageBooleanProperty('preGenerateNextPuzzle', false);
