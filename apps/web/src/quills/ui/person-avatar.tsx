import { Avatar, AvatarFallback, AvatarImage, cn } from "./upstream";

export interface PersonAvatarProps {
  name: string | null;
  avatarUrl?: string | null;
  className?: string;
}

/** A decorative avatar; the name is always shown next to it as text. */
export function PersonAvatar({
  name,
  avatarUrl,
  className,
}: PersonAvatarProps) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        "size-5 bg-muted text-[10px] text-muted-foreground",
        className,
      )}
    >
      {avatarUrl ? (
        // quills-web-allow C3: the avatar is decorative, so its image needs an empty alt.
        <AvatarImage src={avatarUrl} alt="" />
      ) : null}
      <AvatarFallback>{name?.trim().charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
