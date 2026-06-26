import { spawn } from "node:child_process";

const child = spawn("node", ["dist/src/mcp/server.js"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "inherit"],
});

let output = "";

child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

child.stdin.write(`${JSON.stringify({ id: 1, method: "list_tools" })}\n`);
child.stdin.end();

child.on("close", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  const response = JSON.parse(output.trim());
  const names = response.result.map((item) => item.name);
  console.log(JSON.stringify(names, null, 2));
});
