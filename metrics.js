"use strict";

const counters = new Map();

function increment(name, labels = {}) {
  const normalizedLabels = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${String(value).replace(/["\\\n]/g, "_")}"`)
    .join(",");
  const key = normalizedLabels ? `${name}{${normalizedLabels}}` : name;
  counters.set(key, (counters.get(key) || 0) + 1);
}

function render() {
  return `${[...counters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key} ${value}`)
    .join("\n")}\n`;
}

module.exports = { increment, render };
