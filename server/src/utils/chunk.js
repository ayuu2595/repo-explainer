import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const EXTENSION_TO_LANGUAGE = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js",
  py: "python", java: "java",
  c: "cpp", cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp",
  go: "go", rs: "rust", rb: "ruby", php: "php",
  scala: "scala", swift: "swift", sol: "sol", proto: "proto",
  rst: "rst", md: "markdown", markdown: "markdown",
  html: "html", htm: "html", tex: "latex",
};

function getLanguage(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

export async function chunkFile(path, content) {
  const language = getLanguage(path);

  const splitter = language
    ? RecursiveCharacterTextSplitter.fromLanguage(language, {
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
      })
    : new RecursiveCharacterTextSplitter({
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
      });

  return splitter.splitText(content);
}