import { currentTheme, uiFont } from './Theme.ts';

import { TReadOnlyProperty } from 'scenerystack/axon';
import { EmptySelfOptions, optionize } from 'scenerystack/phet-core';
import { RichText, RichTextOptions } from 'scenerystack/scenery';

export type UITextOptions = RichTextOptions;

export class UIRichText extends RichText {
  public constructor(string: string | number | TReadOnlyProperty<string>, providedOptions?: UITextOptions) {
    const options = optionize<UITextOptions, EmptySelfOptions, RichTextOptions>()(
      {
        font: uiFont,
        fill: currentTheme.uiForegroundColorProperty,
        linkFill: currentTheme.uiLinkColorProperty,
      },
      providedOptions,
    );

    super(string, options);
  }
}
