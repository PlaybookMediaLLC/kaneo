import { sql } from "drizzle-orm";
import { getStorageDriver } from "../../storage/local-driver";
import type { ServiceStatus } from "./service-status";
import { withDatabaseTimeout } from "./with-database-timeout";

export type DoctorCheck = {
  id:
    | "public_url"
    | "pgvector"
    | "storage"
    | "email"
    | "inbound_email"
    | "ai_provider";
  status: ServiceStatus;
  detail: string;
  remediation: string | null;
};

/**
 * Self-hosted First-Run Doctor diagnostics (#303). Surfaces actionable remediation hints
 * without exposing any secrets, passwords, or internal credentials.
 */
export async function probeDoctor(
  timeoutMs: number,
  probes: {
    email: { status: ServiceStatus; configured: boolean };
    storage: { status: ServiceStatus; configured: boolean };
  },
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Public URL & HTTPS hygiene
  const clientUrl = process.env.KANEO_CLIENT_URL?.trim() || "";
  if (!clientUrl) {
    checks.push({
      id: "public_url",
      status: "warning",
      detail: "Public client URL is not set",
      remediation:
        "Set the public client URL (https://your-domain.example) in .env",
    });
  } else if (
    process.env.NODE_ENV === "production" &&
    clientUrl.startsWith("http://") &&
    !clientUrl.includes("localhost") &&
    !clientUrl.includes("127.0.0.1")
  ) {
    checks.push({
      id: "public_url",
      status: "warning",
      detail: "Public URL uses plain HTTP in production",
      remediation:
        "Serve the application behind HTTPS (Caddy, Traefik, or nginx) and set an https:// public URL",
    });
  } else {
    checks.push({
      id: "public_url",
      status: "ok",
      detail: "Public URL configured",
      remediation: null,
    });
  }

  // 2. PostgreSQL pgvector extension & HNSW index readiness
  try {
    const pgv = await withDatabaseTimeout(async (tx) => {
      const ext = await tx.execute<{ extversion: string }>(
        sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
      );
      return ext.rows[0]?.extversion ?? null;
    }, timeoutMs);
    if (pgv) {
      checks.push({
        id: "pgvector",
        status: "ok",
        detail: `pgvector ${pgv} installed`,
        remediation: null,
      });
    } else {
      checks.push({
        id: "pgvector",
        status: "down",
        detail: "pgvector extension is not installed",
        remediation:
          "Use pgvector/pgvector:0.8.7-pg16-bookworm in compose.yml and run CREATE EXTENSION IF NOT EXISTS vector",
      });
    }
  } catch {
    checks.push({
      id: "pgvector",
      status: "down",
      detail: "Could not inspect pgvector extension",
      remediation: "Verify PostgreSQL connectivity and permissions",
    });
  }

  // 3. Storage driver (local filesystem or S3)
  const driver = getStorageDriver();
  checks.push({
    id: "storage",
    status: probes.storage.status,
    detail:
      driver === "local"
        ? "Local filesystem storage driver active"
        : probes.storage.configured
          ? "S3-compatible storage driver active"
          : "No object storage configured",
    remediation:
      probes.storage.status === "ok"
        ? null
        : "Set STORAGE_DRIVER=local with LOCAL_STORAGE_DIR=/data/uploads, or configure S3_BUCKET/S3_ENDPOINT",
  });

  // 4. Outbound SMTP email
  checks.push({
    id: "email",
    status: probes.email.status,
    detail: probes.email.configured
      ? "Outbound email configured"
      : "Outbound email not configured (optional)",
    remediation: probes.email.configured
      ? null
      : "Configure SMTP in Admin › System or set SMTP_HOST/SMTP_FROM in .env to send invites and release digests",
  });

  // 5. Inbound email support
  const inboundReady = Boolean(
    process.env.EMAIL_INBOUND_DOMAIN?.trim() &&
    process.env.EMAIL_INBOUND_SIGNING_SECRET?.trim(),
  );
  checks.push({
    id: "inbound_email",
    status: inboundReady ? "ok" : "not_configured",
    detail: inboundReady
      ? "Inbound email replies configured"
      : "Inbound email replies not configured (optional)",
    remediation: inboundReady
      ? null
      : "Set EMAIL_INBOUND_DOMAIN and EMAIL_INBOUND_SIGNING_SECRET to accept support replies by email",
  });

  // 6. AI provider (optional)
  const aiReady = Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.AI_GATEWAY_API_KEY?.trim(),
  );
  checks.push({
    id: "ai_provider",
    status: aiReady ? "ok" : "not_configured",
    detail: aiReady
      ? "AI provider credentials configured"
      : "AI provider not configured (optional)",
    remediation: aiReady
      ? null
      : "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env to enable the AI customer agent",
  });

  return checks;
}
