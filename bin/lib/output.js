/**
 * Tiny zero-dependency terminal output helpers.
 * No external chalk/picocolors dependency to keep the npm package light.
 */

const isTTY = process.stdout.isTTY;
const noColor = process.env.NO_COLOR || !isTTY;

function wrap(start, end) {
  return (s) => (noColor ? s : `\x1b[${start}m${s}\x1b[${end}m`);
}

const color = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

const symbols = {
  check: color.green("✓"),
  cross: color.red("✗"),
  warn: color.yellow("⚠"),
  arrow: color.cyan("→"),
  bullet: color.dim("•"),
};

function printHeader() {
  console.log("");
  console.log(color.bold("RecallMEM") + color.dim(" - private local AI chatbot"));
  console.log("");
}

function step(msg) {
  console.log(`  ${symbols.arrow} ${msg}`);
}

function success(msg) {
  console.log(`  ${symbols.check} ${msg}`);
}

function warn(msg) {
  console.log(`  ${symbols.warn} ${color.yellow(msg)}`);
}

function fail(msg) {
  console.log(`  ${symbols.cross} ${color.red(msg)}`);
}

function info(msg) {
  console.log(`    ${color.dim(msg)}`);
}

function section(title) {
  console.log("");
  console.log(color.bold(title));
}

function blank() {
  console.log("");
}

module.exports = {
  color,
  symbols,
  printHeader,
  step,
  success,
  warn,
  fail,
  info,
  section,
  blank,
};
