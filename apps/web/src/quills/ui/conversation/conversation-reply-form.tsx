import { useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../core/types";
import { PortalForm } from "../portal-form";
import { Label, Textarea } from "../upstream";

const schema = z.object({ content: z.string().trim().min(1).max(10000) });
type Reply = z.infer<typeof schema>;

export interface ConversationReplyFormProps {
  onSubmit: (content: string) => Promise<PortalProblem | void>;
}

export function ConversationReplyForm({
  onSubmit,
}: ConversationReplyFormProps) {
  const { t } = useTranslation("quills");
  const formRef = useRef<UseFormReturn<Reply>>(null);
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content: "" }}
      submitKey="conversation.send"
      onSubmit={async ({ content }) => {
        const problem = await onSubmit(content);
        if (!problem) formRef.current?.reset();
        return problem;
      }}
    >
      {(form) => {
        formRef.current = form;
        return (
          <div>
            <Label htmlFor="conversation-reply">
              {t("conversation.replyLabel")}
            </Label>
            <Textarea
              id="conversation-reply"
              placeholder={t("conversation.replyPlaceholder")}
              aria-invalid={Boolean(form.formState.errors.content)}
              {...form.register("content")}
            />
            {form.formState.errors.content?.message ? (
              <p role="alert">
                {String(form.formState.errors.content.message)}
              </p>
            ) : null}
          </div>
        );
      }}
    </PortalForm>
  );
}
