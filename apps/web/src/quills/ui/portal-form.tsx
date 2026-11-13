import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState, type ReactNode } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type { PortalProblem } from "../core/types";
import { isFramed } from "./confirm-action";
import { Button } from "./upstream";
import { StateView } from "./state-view";

export interface PortalFormProps<T extends FieldValues> {
  schema: z.ZodType<T, T>;
  defaultValues: DefaultValues<T>;
  submitKey: string;
  onSubmit: (values: T) => Promise<PortalProblem | void>;
  children: (form: UseFormReturn<T>) => ReactNode;
}

export function PortalForm<T extends FieldValues>(props: PortalFormProps<T>) {
  const { t } = useTranslation("quills");
  const form = useForm<T>({
    defaultValues: props.defaultValues,
    resolver: zodResolver(props.schema) as Resolver<T>,
  });
  const [problem, setProblem] = useState<PortalProblem | null>(null);
  const running = useRef(false);
  const submit = form.handleSubmit(async (values) => {
    if (running.current || (problem && problem.kind !== "invalid")) return;
    setProblem(null);
    if (isFramed()) {
      form.setError("root", { message: t("core.frameBlocked") });
      return;
    }
    running.current = true;
    try {
      const result = await props.onSubmit(values);
      if (result?.kind === "invalid" && result.issues?.length) {
        for (const issue of result.issues) {
          form.setError(issue.path as never, { message: issue.message });
        }
      } else {
        setProblem(result ?? null);
      }
    } catch {
      setProblem({ kind: "failed" });
    } finally {
      running.current = false;
    }
  });
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      {form.formState.errors.root?.message ? (
        <p role="alert">{form.formState.errors.root.message}</p>
      ) : null}
      {props.children(form)}
      <StateView problem={problem} onRetry={() => setProblem(null)}>
        {null}
      </StateView>
      <Button
        type="submit"
        disabled={
          form.formState.isSubmitting ||
          Boolean(problem && problem.kind !== "invalid")
        }
        loading={form.formState.isSubmitting}
      >
        {t(props.submitKey)}
      </Button>
    </form>
  );
}
