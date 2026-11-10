import { empty, fixture } from "../framework/contract";

export const getQuillsWidgetSettings = empty;
export const updateQuillsWidgetSettings = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { enabled: true, tabs: { help: true } } }),
});
export const getQuillsWidgetSecret = empty;
export const rotateQuillsWidgetSecret = empty;
export const mintQuillsWidgetInstallCode = empty;
