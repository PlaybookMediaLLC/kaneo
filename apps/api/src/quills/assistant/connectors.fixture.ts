import { empty } from "../framework/contract";
import { on } from "./seed.fixture";

export const listQuillsConnectors = empty;
export const deleteQuillsConnector = on(
  ["connector"],
  (a) => ({ params: { connectorId: a.connectorId } }),
  (b) => ({ connectorId: b.connectorId }),
);
export const listQuillsAssistantTools = empty;
