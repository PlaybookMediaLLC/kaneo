import { exportSchedules } from "../../../database/quills/schema/export-runs";
import { fixture } from "../../framework/contract";
import { sealCredentials } from "../../framework/integration-config";

process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-contract-test-key";

export const exportQuillsWorkspaceZip = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { format: "zip" as const } }),
});

export const getQuillsExportSchedule = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const setQuillsExportSchedule = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      enabled: true,
      cadence: "weekly" as const,
      destinationEndpoint: "https://s3.us-east-1.amazonaws.com",
      bucket: "acme-backups",
      prefix: "kaneo/",
      region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
  }),
});

export const deleteQuillsExportSchedule = fixture({
  seed: async (env) => {
    await env.scoped(env.a, (db) =>
      db
        .insert(exportSchedules)
        .values({
          enabled: true,
          cadence: "weekly",
          destinationEndpoint: "https://s3.us-east-1.amazonaws.com",
          bucket: "acme-backups",
          prefix: "kaneo/",
          region: "us-east-1",
          sealedCredentials: sealCredentials({
            accessKeyId: "AKIAIOSFODNN7EXAMPLE",
            secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          }),
        })
        .onConflictDoNothing(),
    );
    return {};
  },
  valid: () => ({}),
});
