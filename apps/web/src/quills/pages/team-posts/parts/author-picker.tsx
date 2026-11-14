import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListUsers } from "../../../hooks/team/use-list-users";
import { useTeamRuntime } from "../../../team/runtime";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  Button,
  Input,
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
  useDebouncedValue,
} from "../../../ui/upstream";

/** The person a new request is posted for. Null is the signed-in teammate. */
export interface RequestAuthor {
  principalId: string;
  name: string;
  avatarUrl: string | null;
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
  const pick = (author: RequestAuthor | null) => {
    onChange(author);
    setText("");
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="sm" />}
        aria-label={t("team-posts.author", { name })}
      >
        {chip}
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-72 p-3">
        <PopoverTitle className="mb-2 text-sm">
          {t("team-posts.postFor")}
        </PopoverTitle>
        <Input
          type="search"
          size="sm"
          autoFocus
          aria-label={t("team-posts.findCustomer")}
          placeholder={t("team-posts.findCustomer")}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <ul className="mt-2 grid gap-0.5">
          <li>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => pick(null)}
            >
              {t("team-posts.you")}
            </Button>
          </li>
          {search
            ? users.data?.items.map((user) => (
                <li key={user.principalId}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() =>
                      pick({
                        principalId: user.principalId,
                        name: user.name ?? user.email ?? "",
                        avatarUrl: user.image,
                      })
                    }
                  >
                    <PersonAvatar
                      colored
                      name={user.name}
                      avatarUrl={user.image}
                    />
                    <span className="truncate">{user.name ?? user.email}</span>
                  </Button>
                </li>
              ))
            : null}
        </ul>
        {users.error ? (
          <p role="alert" className="mt-2 text-sm text-destructive-foreground">
            {t("core.problem.failed")}
          </p>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
