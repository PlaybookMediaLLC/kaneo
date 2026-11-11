import { apiRouter } from "../../../openapi";
import reads from "./reads";
import writes from "./writes";

// Widget help routes under /quills-public/{workspace}, mounted from ../../public.ts.
export default apiRouter().route("/", reads).route("/", writes);
