"use strict";

const requiredMajor = 24;
const actualMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

if (actualMajor !== requiredMajor) {
  console.error(
    `Node.js ${requiredMajor}.x is required; current runtime is ${process.version}.`,
  );
  process.exit(1);
}

console.log(`Node.js runtime check passed (${process.version}).`);
