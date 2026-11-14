import { useId } from "react";
import { useTranslation } from "react-i18next";

export interface MeterListProps {
  titleKey: string;
  emptyKey: string;
  items: Array<{ id: string; label: string; value: number }>;
  /** The value of a full bar. 0 shows the empty text. */
  max: number;
}

/** A titled list of counts, each with a native meter bar. */
export function MeterList({ titleKey, emptyKey, items, max }: MeterListProps) {
  const { t } = useTranslation("quills");
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">
        {t(titleKey)}
      </h2>
      {max > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm"
            >
              <label htmlFor={`${id}-${item.id}`} className="truncate">
                {item.label}
              </label>
              <meter
                id={`${id}-${item.id}`}
                className="h-2 w-full"
                min={0}
                max={max}
                value={item.value}
              />
              <span className="text-right tabular-nums">{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t(emptyKey)}</p>
      )}
    </section>
  );
}
