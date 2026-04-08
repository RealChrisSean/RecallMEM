/**
 * Tiny zero-dependency CLI prompt helpers (yes/no, list picker).
 * Uses node:readline so we don't pull in inquirer/prompts as a dep.
 */

const readline = require("node:readline");

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question, defaultValue = true) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = await ask(question + suffix);
  if (!answer) return defaultValue;
  return /^y/i.test(answer);
}

async function pick(question, choices) {
  console.log(question);
  choices.forEach((c, i) => {
    console.log(`  ${i + 1}) ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  });
  while (true) {
    const answer = await ask("Pick a number: ");
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= choices.length) {
      return choices[n - 1];
    }
    console.log("  invalid choice, try again");
  }
}

module.exports = { ask, confirm, pick };
