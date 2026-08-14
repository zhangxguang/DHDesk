export type WindowCloseBehavior = "close" | "hide" | "minimize";

export function getWindowCloseBehavior(
  platform: NodeJS.Platform,
  appQuitting: boolean
): WindowCloseBehavior {
  if (appQuitting) return "close";
  if (platform === "darwin") return "hide";
  if (platform === "win32") return "minimize";
  return "close";
}
