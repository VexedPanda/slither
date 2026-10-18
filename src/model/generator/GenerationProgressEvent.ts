import FaceValue from '../data/face-value/FaceValue.ts';

// Progress of puzzle generation (see generateAdditiveConstrained), as shown in the Generate preview
export type GenerationProgressEvent =
  { type: 'define' | 'minimize'; index: number; state: FaceValue } | { type: 'reset' };
