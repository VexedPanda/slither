import { UISwitch, UISwitchOptions } from './UISwitch.ts';
import { UIText, UITextOptions } from './UIText.ts';

import { Property, TReadOnlyProperty } from 'scenerystack/axon';
import { optionize } from 'scenerystack/phet-core';

type SelfOptions = {
  textOptions?: UITextOptions;
};

export type UITextSwitchOptions = SelfOptions & UISwitchOptions;

export class UITextSwitch extends UISwitch {
  public constructor(
    property: Property<boolean>,
    name: string | TReadOnlyProperty<string>,
    providedOptions?: UITextSwitchOptions,
  ) {
    const options = optionize<UITextSwitchOptions, SelfOptions, UISwitchOptions>()(
      {
        textOptions: {},
      },
      providedOptions,
    );

    const text = new UIText(name, options.textOptions);

    super(property, name, text, options);
  }
}
