import { Clock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Menu, MenuItem, MenuPopup, MenuTrigger } from "../upstream";

export interface ScheduleSendMenuProps {
  disabled?: boolean;
  onSchedule: (isoDate: string) => void;
}

function tomorrowMorningIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function inHoursIso(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function formatLocalDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultCustomLocal(): string {
  return formatLocalDatetime(new Date(Date.now() + 2 * 3_600_000));
}

/** Compact clock menu beside the reply send button for scheduling a future reply (#323). */
export function ScheduleSendMenu({
  disabled,
  onSchedule,
}: ScheduleSendMenuProps) {
  const { t } = useTranslation("quills");
  const [customValue, setCustomValue] = useState(defaultCustomLocal);
  const [customOpen, setCustomOpen] = useState(false);

  const parsedCustom = customValue ? new Date(customValue) : null;
  const customValid =
    parsedCustom !== null &&
    !Number.isNaN(parsedCustom.getTime()) &&
    parsedCustom.getTime() > Date.now();

  return (
    <div className="relative flex items-center gap-1">
      {customOpen ? (
        <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5">
          <input
            type="datetime-local"
            aria-label={t("inbox.scheduled.pickTime")}
            min={formatLocalDatetime(new Date(Date.now() + 60_000))}
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            className="bg-transparent text-xs outline-none"
          />
          <Button
            type="button"
            size="xs"
            disabled={disabled || !customValid}
            onClick={() => {
              const parsed = new Date(customValue);
              if (
                Number.isNaN(parsed.getTime()) ||
                parsed.getTime() <= Date.now()
              ) {
                return;
              }
              onSchedule(parsed.toISOString());
              setCustomOpen(false);
            }}
          >
            {t("inbox.scheduled.confirm")}
          </Button>
        </div>
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={t("inbox.scheduled.scheduleSend")}
              title={t("inbox.scheduled.scheduleSend")}
            />
          }
        >
          <Clock aria-hidden="true" className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => onSchedule(inHoursIso(1))}>
            {t("inbox.scheduled.inOneHour")}
          </MenuItem>
          <MenuItem onClick={() => onSchedule(inHoursIso(3))}>
            {t("inbox.scheduled.inThreeHours")}
          </MenuItem>
          <MenuItem onClick={() => onSchedule(tomorrowMorningIso())}>
            {t("inbox.scheduled.tomorrowMorning")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              const next = !customOpen;
              if (next) setCustomValue(defaultCustomLocal());
              setCustomOpen(next);
            }}
          >
            {t("inbox.scheduled.customTime")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
