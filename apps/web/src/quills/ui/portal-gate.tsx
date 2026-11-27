import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth-client";
import type { Audience } from "../core/types";
import { portalHref } from "../core/portal-href";
import { portalSignInHref } from "../core/portal-sign-in-href";
import { useOptionalPortalRuntime } from "../portal/runtime";
import { Button, getSafeRedirectPath, Input } from "./upstream";

export interface PortalGateProps {
  workspaceId: string;
  audience: Audience;
  portalEnabled: boolean;
  accessGranted: boolean;
  signedIn: boolean;
  currentPath?: string;
  children: ReactNode;
}

function PortalOtpSignIn() {
  const { t } = useTranslation("quills");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email: trimmed,
        type: "sign-in",
      });
      if (res.error) {
        setError(res.error.message ?? t("core.problem.failed"));
      } else {
        setStep("code");
      }
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: trimmedCode,
      });
      if (res.error) {
        setError(res.error.message ?? t("core.problem.failed"));
      } else {
        window.location.reload();
      }
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 max-w-sm rounded-lg border bg-card p-4 text-left">
      <p className="text-sm font-medium">{t("core.otp.title")}</p>
      {step === "email" ? (
        <form onSubmit={sendOtp} className="mt-2 flex flex-col gap-2">
          <Input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("core.otp.emailPlaceholder")}
            aria-label={t("core.otp.emailPlaceholder")}
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={!email.trim() || busy}>
            {t("core.otp.sendCode")}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("core.otp.sentHint", { email })}
          </p>
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t("core.otp.codePlaceholder")}
            aria-label={t("core.otp.codePlaceholder")}
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              className="flex-1"
              disabled={!code.trim() || busy}
            >
              {t("core.otp.verify")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              {t("core.otp.changeEmail")}
            </Button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PortalGate(props: PortalGateProps) {
  const { t } = useTranslation("quills");
  const signIn = useOptionalPortalRuntime()?.access?.signIn;
  if (!props.portalEnabled) return <p role="status">{t("core.portalOff")}</p>;
  if (
    !props.signedIn &&
    (props.audience === "signed-in" ||
      (props.audience !== "public" && !props.accessGranted))
  ) {
    const href = portalSignInHref(
      props.workspaceId,
      getSafeRedirectPath(props.currentPath) ?? portalHref(props.workspaceId),
      signIn,
    );
    if (!href) return <p role="status">{t("core.signInOff")}</p>;
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="status">{t("core.signInRequired")}</p>
        <Button render={<a href={href} />}>{t("core.signIn")}</Button>
        {signIn?.mode !== "sso" ? <PortalOtpSignIn /> : null}
      </div>
    );
  }
  if (props.audience !== "public" && !props.accessGranted) {
    return <p role="status">{t("core.noAccess")}</p>;
  }
  return props.children;
}
