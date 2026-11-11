import { fixture } from "../../framework/contract";
import { providerAnswers } from "../provider-edge.fixture";
import "../seed.fixture";

// Local Azure DevOps answers for the organization `contract`, and the fixture of the key connect route.
providerAnswers.push((route) => {
  if (route === "GET /dev.azure.com/contract/_apis/projects")
    return {
      value: [
        { id: "0f6a3c1e-0000-4000-8000-000000000001", name: "Contract App" },
      ],
    };
  if (
    route ===
    "GET /dev.azure.com/contract/Contract%20App/_apis/wit/workitemtypes"
  )
    return { value: [{ name: "Bug" }, { name: "User Story" }] };
  return undefined;
});

export const saveQuillsAzureDevopsKey = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { token: "contract-pat", organization: "contract" } }),
});
