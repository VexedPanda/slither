import { Enumeration, EnumerationValue } from 'scenerystack/phet-core';

export default class HintState extends EnumerationValue {
  public static readonly DEFAULT = new HintState();
  public static readonly LOADING = new HintState();
  public static readonly SEARCHING = new HintState();
  public static readonly FOUND = new HintState();
  public static readonly NOT_FOUND = new HintState();

  public static readonly enumeration = new Enumeration(HintState);
}
