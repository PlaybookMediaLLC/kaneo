import { fixture } from "../framework/contract";

export const applyQuillsWorkspacePreset = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { preset: "solo_founder" as const } }),
});

export const getQuillsSetupState = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const updateQuillsSetupState = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      completedSteps: ["create_project", "install_widget"],
      dismissed: false,
    },
  }),
});
