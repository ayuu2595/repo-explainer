export function reciprocalRankFusion(vectorResults, keywordResults, k = 60) {
  const scores = new Map();

  vectorResults.forEach((row, index) => {
    const key = row.source_path + "::" + row.content;
    const existing = scores.get(key) || { row, score: 0 };
    existing.score += 1 / (k + index + 1);
    scores.set(key, existing);
  });

  keywordResults.forEach((row, index) => {
    const key = row.source_path + "::" + row.content;
    const existing = scores.get(key) || { row, score: 0 };
    existing.score += 1 / (k + index + 1);
    scores.set(key, existing);
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
}