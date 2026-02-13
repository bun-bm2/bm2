
export function color(text: string, type: string) {
  const codes: Record<string, string> = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
  };
  return (codes[type] || "") + text + codes.reset;
}

export function statusColor(status: string): string {
  switch (status) {
    case "online":
      return "green";
    case "stopped":
      return "gray";
    case "errored":
      return "red";
    case "launching":
    case "waiting-restart":
      return "yellow";
    case "stopping":
      return "magenta";
    default:
      return "white";
  }
}
