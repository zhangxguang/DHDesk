export function shouldMinimizeOnClose(platform: NodeJS.Platform, appQuitting: boolean): boolean {
  return (platform === "darwin" || platform === "win32") && !appQuitting;
}
