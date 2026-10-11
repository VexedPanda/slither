import { QueryStringMachine } from 'scenerystack/query-string-machine';

export default QueryStringMachine.getAll({
  p: {
    type: 'string',
    defaultValue: '',
  },

  debugScan: { type: 'flag' },

  debugColors: { type: 'flag' },

  // like PhET sims
  showPointerAreas: { type: 'flag' },
});
