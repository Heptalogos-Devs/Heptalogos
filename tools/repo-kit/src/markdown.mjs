// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Parses repository Markdown through mdast and exposes structural queries used
 * by documentation validators without maintaining a second Markdown parser.
 * @module markdown
 */

import { fromMarkdown } from "mdast-util-from-markdown";

function parseMarkdown(source) {
  if (typeof source !== "string")
    throw new TypeError("Markdown source must be a string");
  return fromMarkdown(source);
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function textContent(node) {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textContent).join("");
}

function normalizeIdentifier(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function definitions(tree) {
  const result = new Map();
  walk(tree, (node) => {
    if (node.type === "definition") {
      result.set(normalizeIdentifier(node.identifier), node.url);
    }
  });
  return result;
}

function isExternal(target) {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("#")
  );
}

function normalizeTarget(target) {
  if (typeof target !== "string" || target.length === 0 || isExternal(target)) {
    return undefined;
  }
  const path = target.split("#", 1)[0];
  return path.length > 0 ? path : undefined;
}

function collectLinks(nodes, definitionMap) {
  const links = [];
  const visit = (node) => {
    if (node.type === "link") {
      const target = normalizeTarget(node.url);
      if (target !== undefined) links.push({ target });
      return;
    }
    if (node.type === "linkReference") {
      const target = normalizeTarget(
        definitionMap.get(normalizeIdentifier(node.identifier)),
      );
      if (target !== undefined) links.push({ target });
      return;
    }
    if (node.type === "definition" || node.type === "code") return;
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return links;
}

function matchingHeading(tree, heading) {
  return tree.children.find(
    (node) => node.type === "heading" && textContent(node).trim() === heading,
  );
}

function sectionNodeRange(tree, heading) {
  const headingNode = matchingHeading(tree, heading);
  if (headingNode === undefined) return undefined;
  const start = tree.children.indexOf(headingNode) + 1;
  let end = tree.children.length;
  for (let index = start; index < tree.children.length; index += 1) {
    const node = tree.children[index];
    if (node.type === "heading" && node.depth <= headingNode.depth) {
      end = index;
      break;
    }
  }
  return { headingNode, start, end };
}

/** Return local Markdown links while ignoring code and external destinations. */
export function markdownLinks(source, _options = {}) {
  const tree = parseMarkdown(source);
  return collectLinks(tree.children, definitions(tree));
}

/** Return the local link targets extracted from Markdown source. */
export function markdownTargets(source, options) {
  return markdownLinks(source, options).map(({ target }) => target);
}

function sectionNodes(source, heading) {
  const tree = parseMarkdown(source);
  const range = sectionNodeRange(tree, heading);
  return range === undefined ? [] : tree.children.slice(range.start, range.end);
}

function sectionText(source, heading) {
  const tree = parseMarkdown(source);
  const range = sectionNodeRange(tree, heading);
  if (range === undefined) return "";
  const nextHeading = tree.children[range.end];
  const start = range.headingNode.position?.end.offset;
  const end = nextHeading?.position?.start.offset ?? source.length;
  if (start === undefined) return "";
  return source.slice(start, end);
}

/** Return the source text belonging to one exact Markdown heading section. */
export function section(source, heading) {
  return sectionText(source, heading);
}

function markdownLinksInSection(source, heading, options) {
  const tree = parseMarkdown(source);
  const range = sectionNodeRange(tree, heading);
  if (range === undefined) return [];
  return collectLinks(
    tree.children.slice(range.start, range.end),
    definitions(tree),
    options,
  );
}

/** Return local link targets from one exact Markdown heading section. */
export function markdownTargetsInSection(source, heading, options) {
  return markdownLinksInSection(source, heading, options).map(({ target }) => target);
}

/** Return fenced code block contents from one exact Markdown section. */
export function codeBlocksInSection(source, heading) {
  return sectionNodes(source, heading)
    .filter((node) => node.type === "code")
    .map((node) => node.value ?? "");
}

/** Return the first paragraph's plain text from one exact Markdown section. */
export function firstSectionParagraph(source, heading) {
  const paragraph = sectionNodes(source, heading).find(
    (node) => node.type === "paragraph",
  );
  return paragraph === undefined ? "" : textContent(paragraph);
}
