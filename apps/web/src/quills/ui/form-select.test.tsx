import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import type { PortalProblem } from "../core/types";
import { choose, press } from "../test/actions";
import { renderComponent } from "../test/render";
import { FormSelect } from "./form-select";
import { PortalForm } from "./portal-form";

const schema = z.object({ sort: z.enum(["votes", "newest"]).nullable() });
type Values = z.infer<typeof schema>;
const options = [
  { value: null, label: "Portal default" },
  { value: "votes", label: "Most votes" },
  { value: "newest", label: "Newest" },
] as const;

function renderForm(
  onSubmit: (values: Values) => Promise<PortalProblem | void>,
) {
  return renderComponent(
    <PortalForm<Values>
      schema={schema}
      defaultValues={{ sort: "votes" }}
      submitKey="team-triage.saveVoting"
      onSubmit={onSubmit}
    >
      {(form) => (
        <FormSelect
          control={form.control}
          name="sort"
          label="Sort"
          options={options}
        />
      )}
    </PortalForm>,
  );
}

describe("FormSelect", () => {
  it("labels the trigger, shows the value and submits the empty choice", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderForm(onSubmit);
    const trigger = view.getByRole("combobox", { name: "Sort" });
    expect(trigger).toHaveTextContent("Most votes");
    await choose("Sort", "Portal default");
    expect(trigger).toHaveTextContent("Portal default");
    press("Save voting settings");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ sort: null }));
  });

  it("announces a field issue and links it to the trigger", async () => {
    const onSubmit = vi.fn(async () => ({
      kind: "invalid" as const,
      issues: [{ path: "sort", message: "Pick a sort" }],
    }));
    const view = renderForm(onSubmit);
    press("Save voting settings");
    expect(await view.findByRole("alert")).toHaveTextContent("Pick a sort");
    const trigger = view.getByRole("combobox", { name: "Sort" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("Pick a sort");
  });
});
