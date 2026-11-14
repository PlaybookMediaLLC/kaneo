import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListUsers } from "../../../hooks/team/use-list-users";
import { useTeamRuntime } from "../../../team/runtime";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  Button,
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  useDebouncedValue,
} from "../../../ui/upstream";

/** The person a new request is posted for. Null is the signed-in teammate. */
export interface RequestAuthor {
  principalId: string;
  name: string;
  avatarUrl: string | null;
}

/** One row of the picker: the signed-in teammate (a null author) or a customer. */
interface Choice {
  label: string;
  author: RequestAuthor | null;
}

export interface AuthorPickerProps {
  workspaceId: string;
  value: RequestAuthor | null;
  onChange: (author: RequestAuthor | null) => void;
}

/**
 * The author of a new request. A teammate who can update posts can pick a customer, to post
 * on their behalf; the others always post as themselves.
 */
export function AuthorPicker({
  workspaceId,
  value,
  onChange,
}: AuthorPickerProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 300);
  const users = useListUsers(
    {
      param: { workspaceId: open && search ? workspaceId : "" },
      query: { search, limit: "5" },
    },
    team.viewer,
  );
  const name = value?.name ?? t("team-posts.you");
  const chip = (
    <>
      <PersonAvatar colored name={name} avatarUrl={value?.avatarUrl} />
      {name}
    </>
  );
  if (!team.permissions.update)
    return <span className="flex items-center gap-1.5 px-1">{chip}</span>;
  // The server filters the customers, so the combobox does not filter them again.
  const choices: Choice[] = [
    { label: t("team-posts.you"), author: null },
    ...(search ? (users.data?.items ?? []) : []).map((user) => {
      const label = user.name ?? user.email ?? "";
      return {
        label,
        author: {
          principalId: user.principalId,
          name: label,
          avatarUrl: user.image,
        },
      };
    }),
  ];
  return (
    <Combobox<Choice>
      items={choices}
      filter={null}
      open={open}
      onOpenChange={setOpen}
      inputValue={text}
      onInputValueChange={setText}
      value={null}
      onValueChange={(choice) => {
        if (choice) onChange(choice.author);
      }}
    >
      <ComboboxTrigger
        render={<Button type="button" variant="ghost" size="sm" />}
        aria-label={t("team-posts.author", { name })}
      >
        {chip}
        <ChevronDown aria-hidden="true" />
      </ComboboxTrigger>
      <ComboboxPopup aria-labelledby={titleId} className="w-72">
        <p id={titleId} className="px-3 pt-3 text-sm font-medium">
          {t("team-posts.postFor")}
        </p>
        <div className="p-2">
          <ComboboxInput
            showTrigger={false}
            size="sm"
            aria-label={t("team-posts.findCustomer")}
            placeholder={t("team-posts.findCustomer")}
          />
        </div>
        <ComboboxList>
          {(choice: Choice) => (
            <ComboboxItem key={choice.author?.principalId ?? ""} value={choice}>
              <span className="flex min-w-0 items-center gap-2">
                {choice.author ? (
                  <PersonAvatar
                    colored
                    name={choice.author.name}
                    avatarUrl={choice.author.avatarUrl}
                  />
                ) : null}
                <span className="truncate">{choice.label}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {users.error ? (
          <p
            role="alert"
            className="px-3 pb-3 text-sm text-destructive-foreground"
          >
            {t("core.problem.failed")}
          </p>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}
