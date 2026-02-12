import { describe, test, expect } from "bun:test";

interface ParsedCommand {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

function parseCliArgs(argv: string[]): ParsedCommand {
  const command = argv[0] || "help";
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        // Check if next arg is a value (not a flag)
        if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          flags[key] = argv[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { command, args, flags };
}

describe("CLI Argument Parser", () => {
  test("should parse simple command", () => {
    const result = parseCliArgs(["start", "app.ts"]);
    expect(result.command).toBe("start");
    expect(result.args).toEqual(["app.ts"]);
    expect(result.flags).toEqual({});
  });

  test("should parse command with --name flag", () => {
    const result = parseCliArgs(["start", "app.ts", "--name", "my-api"]);
    expect(result.command).toBe("start");
    expect(result.args).toEqual(["app.ts"]);
    expect(result.flags.name).toBe("my-api");
  });

  test("should parse --flag=value syntax", () => {
    const result = parseCliArgs(["start", "app.ts", "--instances=4"]);
    expect(result.flags.instances).toBe("4");
  });

  test("should parse boolean flags", () => {
    const result = parseCliArgs(["start", "app.ts", "--watch", "--force"]);
    expect(result.flags.watch).toBe(true);
    expect(result.flags.force).toBe(true);
  });

  test("should parse short flags", () => {
    const result = parseCliArgs(["start", "app.ts", "-n", "my-app", "-i", "4"]);
    expect(result.flags.n).toBe("my-app");
    expect(result.flags.i).toBe("4");
  });

  test("should parse stop command with process name", () => {
    const result = parseCliArgs(["stop", "my-api"]);
    expect(result.command).toBe("stop");
    expect(result.args).toEqual(["my-api"]);
  });

  test("should parse restart with all flag", () => {
    const result = parseCliArgs(["restart", "--all"]);
    expect(result.command).toBe("restart");
    expect(result.flags.all).toBe(true);
  });

  test("should parse logs command with lines flag", () => {
    const result = parseCliArgs(["logs", "my-api", "--lines", "50"]);
    expect(result.command).toBe("logs");
    expect(result.args).toEqual(["my-api"]);
    expect(result.flags.lines).toBe("50");
  });

  test("should default to help command when no args", () => {
    const result = parseCliArgs([]);
    expect(result.command).toBe("help");
  });

  test("should parse multiple positional args", () => {
    const result = parseCliArgs(["delete", "app1", "app2", "app3"]);
    expect(result.command).toBe("delete");
    expect(result.args).toEqual(["app1", "app2", "app3"]);
  });

  test("should parse complex command with mixed flags and args", () => {
    const result = parseCliArgs([
      "start",
      "app.ts",
      "--name",
      "api",
      "--instances",
      "4",
      "--watch",
      "--env",
      "production",
    ]);

    expect(result.command).toBe("start");
    expect(result.args).toEqual(["app.ts"]);
    expect(result.flags.name).toBe("api");
    expect(result.flags.instances).toBe("4");
    expect(result.flags.watch).toBe(true);
    expect(result.flags.env).toBe("production");
  });
});