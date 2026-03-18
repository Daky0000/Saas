const fs = require("fs");
const path = require("path");

const dummyPatterns = [
  /1\.2[Kk]/,
  /2\.5[Kk]/,
  /\d+[Kk]\s*(followers|engagement)/i,
  /Lorem/,
  /dummy/i,
  /placeholder/i,
  /test\s*(data|post|metric)/i,
  /\{\s*engagement:\s*\d+\s*\}/,
];

const scanFile = (filePath) => {
  const content = fs.readFileSync(filePath, "utf-8");
  const found = [];

  dummyPatterns.forEach((pattern) => {
    if (pattern.test(content)) {
      const idx = content.search(pattern);
      const lineNumber = content.substring(0, idx).split("\n").length;
      found.push({
        file: filePath,
        pattern: pattern.toString(),
        lineNumber,
      });
    }
  });

  return found;
};

const walk = (dir, results) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") || fullPath.endsWith(".js")) {
      results.push(...scanFile(fullPath));
    }
  });
};

const results = [];
walk(path.resolve("."), results);

if (!results.length) {
  console.log("No dummy data patterns found.");
  process.exit(0);
}

console.log("Potential dummy data found:\n");
results.forEach((hit) => {
  console.log(`${hit.file}:${hit.lineNumber} -> ${hit.pattern}`);
});
process.exit(1);
