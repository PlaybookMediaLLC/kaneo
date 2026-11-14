import { Tabs, TabsList, TabsTab } from "../upstream";

export interface StatusTabsProps {
  /** The accessible name of the tab list, such as "Status". */
  label: string;
  tabs: readonly StatusTab[];
  value: string;
  onChange: (value: string) => void;
}

/** The status filter of an inbox list, such as Open, Snoozed and All. The arrow keys move between tabs. */
export function StatusTabs({ label, tabs, value, onChange }: StatusTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(String(next))}>
      <TabsList
        variant="underline"
        aria-label={label}
        className="w-full justify-start border-b border-border px-3"
      >
        {tabs.map((tab) => (
          <TabsTab key={tab.value} value={tab.value} className="grow-0">
            {tab.label}{" "}
            {tab.count === undefined ? null : (
              <span className="tabular-nums text-muted-foreground">
                {tab.count}
              </span>
            )}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}

export interface StatusTab {
  value: string;
  label: string;
  /** Shown after the label when known. */
  count?: number;
}
