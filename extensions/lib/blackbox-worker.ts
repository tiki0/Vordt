/** Explicit -e entry point for a delegated Pi process; not auto-discovered globally. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import blackbox, { canonicalRoot, checkScope, type WorkerScope } from "../blackbox.ts";

export default async function worker(pi: ExtensionAPI) {
  try {
    const scope: WorkerScope = JSON.parse(process.env.BLACKBOX_WORKER_SCOPE ?? "null");
    if (!scope || typeof scope.root !== "string" || !/^[a-f0-9]{64}$/.test(scope.sha256)) throw new Error("Missing delegated scope configuration");
    if (canonicalRoot(scope.root) !== scope.root || checkScope(scope.root).sha256 !== scope.sha256) throw new Error("Delegated scope does not match parent snapshot");
    await blackbox(pi, scope);
  } catch {
    // A failing factory alone is insufficient: Pi logs extension errors and continues.
    // Explicitly consume the initial command so no model is started without the gate.
    pi.on("input", async () => {
      pi.sendMessage({ customType: "blackbox-diagnostic", content: "Worker scope initialization failed; reinvoke from parent",
        display: true, details: { level: "error" } }, { triggerTurn: false });
      return { action: "handled" };
    });
  }
}
