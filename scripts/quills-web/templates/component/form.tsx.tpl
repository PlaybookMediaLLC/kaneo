import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Label } from "../../../ui/upstream";
const schema = {{SCHEMA}};
export interface {{NAME}}Props { onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>; }
export function {{NAME}}({ onSubmit }: {{NAME}}Props) { const { t } = useTranslation("quills"); return <PortalForm schema={schema} defaultValues={{{DEFAULTS}}} submitKey="{{SUBMIT_KEY}}" onSubmit={onSubmit}>{(form) => <div><Label htmlFor="{{FIELD_ID}}">{t({{FIELD_LABEL_KEY}})}</Label><Input id="{{FIELD_ID}}" {...form.register({{FIELD_NAME}})} />{form.formState.errors.{{FIELD_RAW}}?.message ? <p role="alert">{form.formState.errors.{{FIELD_RAW}}.message}</p> : null}</div>}</PortalForm>; }
