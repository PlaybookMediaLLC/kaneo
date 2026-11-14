import { avatarTone } from "../core/avatar-tone";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  cn,
  getInitials,
} from "./upstream";

export interface PersonAvatarProps {
  name: string | null;
  avatarUrl?: string | null;
  /** Two initials on a tone of the name, as in the teammate inbox. */
  colored?: boolean;
  className?: string;
}

/** A decorative avatar; the name is always shown next to it as text. */
export function PersonAvatar({
  name,
  avatarUrl,
  colored = false,
  className,
}: PersonAvatarProps) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        "size-5 bg-muted text-[10px] text-muted-foreground",
        colored && cn("font-medium", avatarTone(name)),
        className,
      )}
    >
      {avatarUrl ? (
        // quills-web-allow C3: the avatar is decorative, so its image needs an empty alt.
        <AvatarImage src={avatarUrl} alt="" />
      ) : null}
      <AvatarFallback className={colored ? "bg-transparent" : undefined}>
        {colored ? getInitials(name, "") : name?.trim().charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
