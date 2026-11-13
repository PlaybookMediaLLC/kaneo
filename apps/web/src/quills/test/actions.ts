import { act, fireEvent, screen } from "@testing-library/react";
import { expect, vi } from "vite-plus/test";
import type { PortalProblem } from "../core/types";

export function press(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

export function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

export function expectProblem(problem: PortalProblem) {
  expect(screen.getByRole("alert")).toBeInTheDocument();
  return problem;
}

export async function advanceClock(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
