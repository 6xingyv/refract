let updateCheckStarted = false;

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function checkForAppUpdates() {
  if (updateCheckStarted || !isTauri()) return;
  updateCheckStarted = true;

  let userAcceptedInstall = false;
  try {
    const [{ check }, { relaunch }, { confirm, message }] = await Promise.all([
      import("@tauri-apps/plugin-updater"),
      import("@tauri-apps/plugin-process"),
      import("@tauri-apps/plugin-dialog"),
    ]);

    const update = await check({ timeout: 15_000 });
    if (!update) return;

    const notes = update.body?.trim();
    const prompt = [
      `Refract ${update.version} is available.`,
      `Current version: ${update.currentVersion}`,
      notes ? `\n${notes}` : "",
      "\nDownload and install it now?",
    ].filter(Boolean).join("\n");

    userAcceptedInstall = await confirm(prompt, {
      title: "Update available",
      kind: "info",
      okLabel: "Install",
      cancelLabel: "Later",
    });
    if (!userAcceptedInstall) return;

    let downloaded = 0;
    let total: number | undefined;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloaded = 0;
        total = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total) console.info(`Update download: ${Math.round((downloaded / total) * 100)}%`);
      }
    }, { timeout: 120_000 });

    const restartNow = await confirm("The update was installed. Restart Refract now?", {
      title: "Update ready",
      kind: "info",
      okLabel: "Restart",
      cancelLabel: "Later",
    });
    if (restartNow) await relaunch();
    else await message("The update will be applied the next time Refract starts.", {
      title: "Update installed",
      kind: "info",
    });
  } catch (error) {
    console.warn("Update check failed:", error);
    if (!userAcceptedInstall) return;
    const { message } = await import("@tauri-apps/plugin-dialog");
    await message(`The update could not be installed.\n\n${describeError(error)}`, {
      title: "Update failed",
      kind: "error",
    });
  }
}
