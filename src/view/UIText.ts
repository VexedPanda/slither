import { currentTheme, uiFont } from './Theme.ts';

import { TReadOnlyProperty } from 'scenerystack/axon';
import { EmptySelfOptions, optionize } from 'scenerystack/phet-core';
import { Text, TextOptions } from 'scenerystack/scenery';

export type UITextOptions = TextOptions;

export class UIText extends Text {
  public constructor(string: string | number | TReadOnlyProperty<string>, providedOptions?: UITextOptions) {
    const options = optionize<UITextOptions, EmptySelfOptions, TextOptions>()(
      {
        font: uiFont,
        fill: currentTheme.uiForegroundColorProperty,
      },
      providedOptions,
    );

    super(string, options);
  }
}
